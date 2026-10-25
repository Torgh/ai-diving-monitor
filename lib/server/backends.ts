import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { googleAccount } from "./cloudAuth";
import { readSettings } from "./config";
import { writeFileAtomic } from "./files";
import { GoogleDriveBackend } from "./googleDrive";
import { CLOUD_FOLDER, dataDir } from "./paths";

/**
 * Where the dive log lives. The dive files (`dives`), the original UDDF files (`originals`) and the
 * trips being prepared for (`trips`) are plain files in three areas; a backend lists, reads, writes
 * and removes them, nothing more, so the stores work the same on this PC, in the OneDrive folder and
 * on Google Drive.
 */
export type StorageKind = "local" | "onedrive" | "google";
export type Area = "dives" | "originals" | "trips";

export interface StoredFile {
  name: string;
  /** Changes whenever the file's content changes (size and time, or Drive's checksum). */
  version: string;
}

export interface Backend {
  kind: StorageKind;
  /** Where the files are, for people: a folder, or "My Drive › AI Diving Monitor". */
  location: string;
  list(area: Area): Promise<StoredFile[]>;
  read(area: Area, name: string): Promise<Uint8Array | undefined>;
  write(area: Area, name: string, data: Uint8Array | string): Promise<void>;
  remove(area: Area, name: string): Promise<void>;
}

export const STORAGE_LABEL: Record<StorageKind, string> = { local: "This PC", onedrive: "OneDrive", google: "Google Drive" };

/** Files in a folder: the data folder on this PC, or AI Diving Monitor in the folder OneDrive syncs. */
export class FolderBackend implements Backend {
  constructor(
    readonly kind: "local" | "onedrive",
    readonly location: string,
  ) {}

  private dir = (area: Area) => path.join(this.location, area);
  /** File names come from the store, never from outside, but a name must still stay inside its folder. */
  private file(area: Area, name: string) {
    if (name !== path.basename(name) || name.startsWith(".")) throw new Error(`Invalid file name: ${name}`);
    return path.join(this.dir(area), name);
  }

  async list(area: Area): Promise<StoredFile[]> {
    const names = await fs.readdir(this.dir(area)).catch(() => [] as string[]);
    const out: StoredFile[] = [];
    for (const name of names) {
      if (name.endsWith(".tmp")) continue; // a write in progress
      const stat = await fs.stat(path.join(this.dir(area), name)).catch(() => undefined);
      if (stat?.isFile()) out.push({ name, version: `${stat.size}:${stat.mtimeMs}` });
    }
    return out;
  }

  async read(area: Area, name: string) {
    return fs.readFile(this.file(area, name)).then((b) => new Uint8Array(b), () => undefined);
  }

  async write(area: Area, name: string, data: Uint8Array | string) {
    await writeFileAtomic(this.file(area, name), data);
  }

  async remove(area: Area, name: string) {
    await fs.rm(this.file(area, name), { force: true });
  }
}

/**
 * The OneDrive folder on this PC: from Settings, else the folder the OneDrive app announces (Windows
 * sets %OneDrive%), else OneDrive under ~/Library/CloudStorage on macOS.
 */
export function oneDriveRoot(): string | undefined {
  const configured = readSettings().oneDriveFolder?.trim() || process.env.AI_DIVING_MONITOR_ONEDRIVE_FOLDER?.trim();
  if (configured) return existsSync(configured) ? configured : undefined;
  for (const name of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) {
    const dir = process.env[name];
    if (dir && existsSync(dir)) return dir;
  }
  const cloudStorage = path.join(os.homedir(), "Library", "CloudStorage");
  if (existsSync(cloudStorage)) {
    const found = readdirSync(cloudStorage).find((d) => d.startsWith("OneDrive"));
    if (found) return path.join(cloudStorage, found);
  }
  return undefined;
}

/** AI Diving Monitor inside OneDrive, if OneDrive was found on this PC. */
export function oneDriveFolder(): string | undefined {
  const root = oneDriveRoot();
  return root && path.join(root, CLOUD_FOLDER);
}

/** The storage chosen in Settings; this PC when OneDrive is missing or Google isn't connected. */
export function activeStorage(): StorageKind {
  const { storage } = readSettings();
  if (storage === "onedrive" && oneDriveFolder()) return "onedrive";
  if (storage === "google" && googleAccount()) return "google";
  return "local";
}

export function backendFor(kind: StorageKind): Backend {
  if (kind === "google") return new GoogleDriveBackend();
  const oneDrive = kind === "onedrive" && oneDriveFolder();
  if (oneDrive) return new FolderBackend("onedrive", oneDrive);
  return new FolderBackend("local", dataDir());
}

export function activeBackend(): Backend {
  return backendFor(activeStorage());
}
