import type { Area, Backend, StoredFile } from "./backends";
import { accessToken, googleAccount } from "./cloudAuth";
import { HttpError } from "./http";
import { CLOUD_FOLDER } from "./paths";

const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

interface DriveFile {
  id: string;
  name: string;
  md5Checksum?: string;
  modifiedTime?: string;
}

/**
 * How long a listing is trusted. The browser polls the log every 3 s and the MCP server reads it on
 * every tool call; without this each of those would list the folder on Drive again.
 */
const LISTING_MS = 5_000;
const FOLDERS_MS = 10 * 60_000;
const listings = new Map<string, { at: number; files: DriveFile[] }>();
const folderIds = new Map<string, { at: number; root: string; areas: Partial<Record<Area, string>> }>();

/** Forgets cached listings and folder ids (tests use a new fake Drive each time). */
export function forgetDriveCache() {
  listings.clear();
  folderIds.clear();
}

/** fetch() with the access token, turning failures into HttpErrors. A 404 is returned to the caller. */
async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new HttpError(401, "Google Drive is not connected.");
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    throw new HttpError(503, "Google Drive is unreachable. Are you online?");
  }
  if (!res.ok && res.status !== 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new HttpError(res.status === 401 || res.status === 403 ? 503 : 502, body.error?.message ?? `Google Drive error ${res.status}`);
  }
  return res;
}

const query = (params: Record<string, string>) => `${DRIVE}?${new URLSearchParams(params)}`;

/**
 * The dive log on Google Drive: a visible "AI Diving Monitor" folder in My Drive with the dive files
 * in `dives` and the original UDDF files in `originals`. The app can only see files it created there.
 */
export class GoogleDriveBackend implements Backend {
  readonly kind = "google" as const;
  readonly location = `My Drive › ${CLOUD_FOLDER}`;
  private account = googleAccount()?.email ?? "";

  /** A folder by name under `parent` (or in My Drive), created when missing. */
  private async folder(name: string, parent?: string): Promise<string> {
    const where = parent ? ` and '${parent}' in parents` : " and 'root' in parents";
    const res = await driveFetch(query({ q: `mimeType='${FOLDER_MIME}' and name='${name}' and trashed=false${where}`, fields: "files(id)", orderBy: "createdTime", pageSize: "1" }));
    const found = ((await res.json()) as { files?: { id: string }[] }).files?.[0];
    if (found) return found.id;
    const created = await driveFetch(`${DRIVE}?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
    });
    return ((await created.json()) as { id: string }).id;
  }

  private async areaFolder(area: Area): Promise<string> {
    let cached = folderIds.get(this.account);
    if (!cached || Date.now() - cached.at > FOLDERS_MS) {
      cached = { at: Date.now(), root: await this.folder(CLOUD_FOLDER), areas: {} };
      folderIds.set(this.account, cached);
    }
    cached.areas[area] ??= await this.folder(area, cached.root);
    return cached.areas[area]!;
  }

  private key = (area: Area) => `${this.account}|${area}`;

  private async files(area: Area, fresh = false): Promise<DriveFile[]> {
    const cached = listings.get(this.key(area));
    if (!fresh && cached && Date.now() - cached.at < LISTING_MS) return cached.files;
    const folder = await this.areaFolder(area);
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const res = await driveFetch(
        query({
          q: `'${folder}' in parents and trashed=false`,
          fields: "nextPageToken,files(id,name,md5Checksum,modifiedTime)",
          pageSize: "1000",
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      if (res.status === 404) {
        // The folder was deleted on Drive: look it up (or create it) again.
        folderIds.delete(this.account);
        return this.files(area, true);
      }
      const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    listings.set(this.key(area), { at: Date.now(), files });
    return files;
  }

  async list(area: Area): Promise<StoredFile[]> {
    return (await this.files(area)).map((f) => ({ name: f.name, version: f.md5Checksum ?? f.modifiedTime ?? f.id }));
  }

  private async find(area: Area, name: string): Promise<DriveFile | undefined> {
    return (await this.files(area)).find((f) => f.name === name) ?? (await this.files(area, true)).find((f) => f.name === name);
  }

  async read(area: Area, name: string): Promise<Uint8Array | undefined> {
    const file = await this.find(area, name);
    if (!file) return undefined;
    const res = await driveFetch(`${DRIVE}/${file.id}?alt=media`);
    if (res.status === 404) {
      listings.delete(this.key(area));
      return undefined;
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(area: Area, name: string, data: Uint8Array | string): Promise<void> {
    const existing = await this.find(area, name);
    const metadata = existing ? { name } : { name, parents: [await this.areaFolder(area)] };
    const boundary = `adm${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: ${typeof data === "string" ? "application/json" : "application/octet-stream"}\r\n\r\n`,
    );
    const content = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + content.length + tail.length);
    body.set(head);
    body.set(content, head.length);
    body.set(tail, head.length + content.length);
    const res = await driveFetch(existing ? `${UPLOAD}/${existing.id}?uploadType=multipart` : `${UPLOAD}?uploadType=multipart`, {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    listings.delete(this.key(area));
    // Deleted on Drive since it was listed: create it anew.
    if (res.status === 404 && existing) return this.write(area, name, data);
  }

  async remove(area: Area, name: string): Promise<void> {
    const file = await this.find(area, name);
    if (file) await driveFetch(`${DRIVE}/${file.id}`, { method: "DELETE" });
    listings.delete(this.key(area));
  }
}
