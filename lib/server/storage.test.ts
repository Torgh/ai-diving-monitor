import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as storagePost, GET as storageGet } from "../../app/api/storage/route";
import { activeStorage, backendFor, FolderBackend, oneDriveFolder } from "./backends";
import { accessToken, authUrl, disconnect, exchangeCode, googleAccount, GOOGLE_DRIVE_FILE_SCOPE, pkcePair } from "./cloudAuth";
import { readSettings, updateSettings } from "./config";
import { copyLog, DiveStore } from "./diveStore";
import { forgetDriveCache, GoogleDriveBackend } from "./googleDrive";
import { switchStorage } from "./storage";
import { logVersion } from "./version";
import { restoreEnv } from "../../test-env";

const ROOT = path.resolve(__dirname, "..", "..");
const SHEARWATER = new Uint8Array(fs.readFileSync(path.join(ROOT, "fixtures", "uddf", "shearwater-style.uddf")));
const SPRING = new Uint8Array(fs.readFileSync(path.join(ROOT, "examples", "spring-2026.uddf")));
const saved = { ...process.env };
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-storage-"));
  for (const name of Object.keys(process.env)) {
    if (/^(AI_DIVING_MONITOR_|ONEDRIVE|GOOGLE_CLIENT_)/i.test(name)) delete process.env[name];
  }
  process.env.AI_DIVING_MONITOR_HOME = home;
  forgetDriveCache();
});

afterEach(() => {
  restoreEnv(saved);
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("FolderBackend", () => {
  it("lists, reads, writes and removes files in its two areas", async () => {
    const b = new FolderBackend("local", home);
    expect(await b.list("dives")).toEqual([]);
    await b.write("dives", "a.dive.json", "{}");
    await b.write("originals", "x.uddf", new Uint8Array([1, 2, 3]));
    expect((await b.list("dives")).map((f) => f.name)).toEqual(["a.dive.json"]);
    expect(await b.read("originals", "x.uddf")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await b.read("dives", "missing.json")).toBeUndefined();
    await b.remove("dives", "a.dive.json");
    expect(await b.list("dives")).toEqual([]);
    await expect(b.write("dives", "../escape.json", "{}")).rejects.toThrow(/Invalid file name/);
  });
});

describe("choosing the storage", () => {
  it("finds OneDrive, and falls back to this PC when the chosen place isn't there", async () => {
    expect(oneDriveFolder()).toBeUndefined();
    await updateSettings({ storage: "onedrive" });
    expect(activeStorage()).toBe("local");
    const oneDrive = path.join(home, "OneDrive");
    fs.mkdirSync(oneDrive);
    process.env.OneDrive = oneDrive;
    expect(oneDriveFolder()).toBe(path.join(oneDrive, "AiDive"));
    expect(activeStorage()).toBe("onedrive");
    await updateSettings({ oneDriveFolder: path.join(home, "elsewhere") });
    expect(activeStorage()).toBe("local"); // a configured folder that doesn't exist
    await updateSettings({ oneDriveFolder: null, storage: "google" });
    expect(activeStorage()).toBe("local"); // Google not connected
    expect(backendFor("local").location).toBe(home);
  });

  it("copies the log when switching, and the newer dive wins", async () => {
    const oneDrive = path.join(home, "OneDrive");
    fs.mkdirSync(oneDrive);
    process.env.OneDrive = oneDrive;
    const local = new DiveStore();
    const [id] = (await local.importFile("sw.uddf", SHEARWATER)).added;
    expect(await switchStorage("onedrive")).toBe(1);
    const there = new DiveStore();
    expect(there.backend.kind).toBe("onedrive");
    expect((await there.list()).map((r) => r.id)).toEqual([id]);
    expect(fs.readdirSync(path.join(oneDrive, "AiDive", "originals"))).toHaveLength(1);

    await there.updateDetails(id, { site: "Koparki" });
    expect(await switchStorage("local")).toBe(1); // the OneDrive copy is newer
    expect((await new DiveStore().get(id))?.details.site).toBe("Koparki");
    expect(await switchStorage("local")).toBe(0);
    expect(await copyLog(new DiveStore(), new DiveStore())).toEqual({ dives: 0 });
  });

  it("keeps the newest copy when a file exists twice (a OneDrive conflict copy)", async () => {
    const store = new DiveStore();
    const [id] = (await store.importFile("sw.uddf", SHEARWATER)).added;
    const dir = path.join(home, "dives");
    const [name] = fs.readdirSync(dir);
    const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    fs.writeFileSync(path.join(dir, name.replace(".dive.json", "-MY-PC.dive.json")), JSON.stringify({ ...record, updatedAt: "2099-01-01T00:00:00.000Z", details: { site: "conflict" } }));
    expect(await store.list()).toHaveLength(1);
    expect((await store.get(id))?.details.site).toBe("conflict");
    await store.updateDetails(id, { buddy: "Ola" }); // the save replaces both copies
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });
});

/** An in-memory Google Drive: folders, files with parents, multipart uploads, downloads, deletes. */
function fakeDrive() {
  type File = { id: string; name: string; parents: string[]; mimeType?: string; content: Uint8Array; modifiedTime: string };
  const files = new Map<string, File>();
  let next = 1;
  let tick = 0;
  const requests: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  // One character per byte. (TextDecoder's "latin1" is windows-1252 and changes bytes 0x80-0x9F.)
  const binary = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer access-1");
    const id = url.pathname.match(/\/files\/([^/]+)$/)?.[1];
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const name = q.match(/name='([^']+)'/)?.[1];
      const folderOnly = q.includes("mimeType=");
      const found = [...files.values()].filter(
        (f) => f.parents.includes(parent!) && (!name || f.name === name) && (!folderOnly || f.mimeType?.includes("folder")),
      );
      return json({ files: found.map((f) => ({ id: f.id, name: f.name, md5Checksum: `${f.content.length}-${f.modifiedTime}`, modifiedTime: f.modifiedTime })) });
    }
    if (url.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(String(init.body));
      const file = { id: `f${next++}`, name: meta.name, parents: meta.parents ?? ["root"], mimeType: meta.mimeType, content: new Uint8Array(), modifiedTime: `t${tick++}` };
      files.set(file.id, file);
      return json({ id: file.id });
    }
    if (url.pathname.startsWith("/upload/drive/v3/files")) {
      const boundary = new Headers(init.headers).get("content-type")!.split("boundary=")[1];
      const parts = binary(init.body as Uint8Array).split(`--${boundary}`);
      // The metadata part is UTF-8 JSON (charset=UTF-8); the content part is taken byte for byte.
      const meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(parts[1].split("\r\n\r\n")[1], (c) => c.charCodeAt(0))));
      const content = Uint8Array.from(parts[2].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""), (c) => c.charCodeAt(0));
      if (id) {
        const file = files.get(id);
        if (!file) return json({}, 404);
        Object.assign(file, { name: meta.name, content, modifiedTime: `t${tick++}` });
      } else {
        const file = { id: `f${next++}`, name: meta.name, parents: meta.parents, content, modifiedTime: `t${tick++}` };
        files.set(file.id, file);
      }
      return json({});
    }
    if (id && method === "GET") {
      const file = files.get(id);
      return file ? new Response(file.content as BlobPart) : json({}, 404);
    }
    if (id && method === "DELETE") {
      files.delete(id);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  });
  return { fetch, files, requests };
}

function connectGoogle() {
  fs.writeFileSync(
    path.join(home, "google-token.json"),
    JSON.stringify({ refreshToken: "refresh-1", accessToken: "access-1", expiresAt: Date.now() + 3600_000, email: "diver@example.com", scope: GOOGLE_DRIVE_FILE_SCOPE }),
  );
}

describe("Google Drive", () => {
  it("keeps the log in My Drive › AiDive", async () => {
    const drive = fakeDrive();
    vi.stubGlobal("fetch", drive.fetch);
    connectGoogle();
    const store = new DiveStore(new GoogleDriveBackend());
    expect(store.backend.location).toBe("My Drive › AiDive");

    const [id] = (await store.importFile("sw.uddf", SHEARWATER)).added;
    const names = [...drive.files.values()].map((f) => f.name).sort();
    expect(names).toHaveLength(5);
    expect(names).toEqual(expect.arrayContaining(["AiDive", "dives", "originals", expect.stringMatching(/\.uddf$/), expect.stringMatching(/\.dive\.json$/)]));
    const before = await logVersion(store.backend);

    forgetDriveCache();
    const updated = await store.updateDetails(id, { site: "Zakrzówek", tankVolumeL: 12 });
    expect(updated.details.site).toBe("Zakrzówek");
    forgetDriveCache();
    const fresh = new DiveStore(new GoogleDriveBackend());
    expect((await fresh.get(id))?.details).toEqual({ site: "Zakrzówek", tankVolumeL: 12 });
    expect([...drive.files.values()].filter((f) => f.name.endsWith(".dive.json")).map((f) => f.name)).toEqual([expect.stringContaining("Zakrzówek")]);
    expect(await logVersion(fresh.backend)).not.toBe(before);
    expect(await fresh.original((await fresh.get(id))!)).toEqual(SHEARWATER);
  });

  it("reads parsed dives from its cache until a file changes", async () => {
    const drive = fakeDrive();
    vi.stubGlobal("fetch", drive.fetch);
    connectGoogle();
    const store = new DiveStore(new GoogleDriveBackend());
    await store.importFile("spring.uddf", SPRING);
    await store.list();
    forgetDriveCache();
    drive.requests.length = 0;
    await store.list();
    // One folder lookup chain and one listing, no downloads.
    expect(drive.requests.filter((r) => r.startsWith("GET /drive/v3/files/"))).toEqual([]);
  });

  it("finds the folders again when they were deleted on Drive, and removes files", async () => {
    const drive = fakeDrive();
    vi.stubGlobal("fetch", drive.fetch);
    connectGoogle();
    const backend = new GoogleDriveBackend();
    await backend.write("originals", "a.uddf", new Uint8Array([1]));
    expect(await backend.read("originals", "missing.uddf")).toBeUndefined();
    expect((await backend.list("originals")).map((f) => f.name)).toEqual(["a.uddf"]);
    await backend.remove("originals", "a.uddf");
    await backend.remove("originals", "never-there.uddf");
    expect(await backend.list("originals")).toEqual([]);

    // Someone deleted the app's folders on Drive: they are created again.
    for (const [id, f] of drive.files) if (f.mimeType?.includes("folder")) drive.files.delete(id);
    forgetDriveCache();
    await backend.write("dives", "b.dive.json", "{}");
    expect((await backend.list("dives")).map((f) => f.name)).toEqual(["b.dive.json"]);
  });

  it("explains when Drive isn't connected or can't be reached", async () => {
    await expect(new GoogleDriveBackend().list("dives")).rejects.toMatchObject({ status: 401 });
    connectGoogle();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await expect(new GoogleDriveBackend().list("dives")).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Quota exceeded" } }, { status: 500 })));
    await expect(new GoogleDriveBackend().list("dives")).rejects.toThrow("Quota exceeded");
  });

  it("is chosen only when connected, and the log moves there", async () => {
    const drive = fakeDrive();
    vi.stubGlobal("fetch", drive.fetch);
    await new DiveStore().importFile("sw.uddf", SHEARWATER);
    expect(googleAccount()).toBeUndefined();
    connectGoogle();
    expect(googleAccount()).toEqual({ email: "diver@example.com" });
    expect(await switchStorage("google")).toBe(1);
    expect(activeStorage()).toBe("google");
    expect(await new DiveStore().list()).toHaveLength(1);
  });
});

describe("Google sign-in", () => {
  const tokenResponse = (extra: object) =>
    new Response(JSON.stringify({ access_token: "access-2", expires_in: 3600, ...extra }), { headers: { "content-type": "application/json" } });
  const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

  it("asks only for the files the app creates, with PKCE", async () => {
    expect(() => authUrl({ redirectUri: "http://localhost:3001/cb", state: "s", challenge: "c" })).toThrow(/OAuth client/);
    await updateSettings({ googleClientId: "id-1", googleClientSecret: "secret-1" });
    const { verifier, challenge } = pkcePair();
    expect(verifier).not.toBe(challenge);
    const url = new URL(authUrl({ redirectUri: "http://localhost:3001/cb", state: "s1", challenge }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "id-1",
      scope: `openid email ${GOOGLE_DRIVE_FILE_SCOPE}`,
      state: "s1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
    });
  });

  it("stores the token, refreshes it, and forgets it on disconnect", async () => {
    await updateSettings({ googleClientId: "id-1", googleClientSecret: "secret-1" });
    const fetch = vi.fn(async () => tokenResponse({ refresh_token: "refresh-2", id_token: idToken("diver@example.com"), scope: `openid ${GOOGLE_DRIVE_FILE_SCOPE}` }));
    vi.stubGlobal("fetch", fetch);
    expect(await exchangeCode({ code: "c", verifier: "v", redirectUri: "http://localhost:3001/cb" })).toBe("diver@example.com");
    expect(await accessToken()).toBe("access-2");

    const file = path.join(home, "google-token.json");
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), expiresAt: 0 }));
    fetch.mockImplementationOnce(async () => tokenResponse({ access_token: "access-3" }));
    expect(await accessToken()).toBe("access-3");

    await disconnect();
    expect(googleAccount()).toBeUndefined();
    expect(await accessToken()).toBeUndefined();
  });

  it("refuses a sign-in without Drive access or a refresh token", async () => {
    await updateSettings({ googleClientId: "id-1", googleClientSecret: "secret-1" });
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse({ refresh_token: "r", scope: "openid email" })));
    await expect(exchangeCode({ code: "c", verifier: "v", redirectUri: "x" })).rejects.toMatchObject({ status: 403 });
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse({ scope: GOOGLE_DRIVE_FILE_SCOPE })));
    await expect(exchangeCode({ code: "c", verifier: "v", redirectUri: "x" })).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    await expect(exchangeCode({ code: "c", verifier: "v", redirectUri: "x" })).rejects.toMatchObject({ status: 401 });
  });
});

describe("storage API", () => {
  const req = (method: string, body?: object) =>
    new Request("http://localhost:3001/api/storage", {
      method,
      headers: { host: "localhost:3001", "content-type": "application/json", origin: "http://localhost:3001" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  it("shows the choices and switches, refusing places that aren't there", async () => {
    const [, view] = [0, await (await storageGet(req("GET"), {})).json()];
    expect(view).toMatchObject({ active: "local", location: home, onedrive: { folder: null }, google: { clientConfigured: false, account: null } });
    expect((await storagePost(req("POST", { storage: "onedrive" }), {})).status).toBe(400);
    expect((await storagePost(req("POST", { storage: "google" }), {})).status).toBe(400);

    const oneDrive = path.join(home, "MyOneDrive");
    fs.mkdirSync(oneDrive);
    const saved = await (await storagePost(req("POST", { oneDriveFolder: oneDrive }), {})).json();
    expect(saved.onedrive.folder).toBe(path.join(oneDrive, "AiDive"));
    await new DiveStore().importFile("sw.uddf", SHEARWATER);
    const switched = await (await storagePost(req("POST", { storage: "onedrive" }), {})).json();
    expect(switched).toMatchObject({ active: "onedrive", copied: 1 });
    expect(readSettings()).toMatchObject({ storage: "onedrive", oneDriveFolder: oneDrive });

    const client = await (await storagePost(req("POST", { googleClientId: "id", googleClientSecret: "secret" }), {})).json();
    expect(client.google).toEqual({ clientConfigured: true, clientId: "id", account: null });
    expect(JSON.stringify(client)).not.toContain("secret\"");
  });
});
