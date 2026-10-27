import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { type DiveDeckExport, readExport } from "@/lib/exportFile";
import type { PhoneFile } from "@/lib/phoneDives";

// The imported log, in the app's own storage: it survives restarts and works offline. In a desktop
// browser (bun run dev:mobile) Filesystem falls back to IndexedDB.
const FILE = "log.divedeck.json";
// The UDDF files imported on the phone, until an export from the PC holds their dives.
const PHONE_FILES = "phone-dives.json";
const at = (path: string) => ({ path, directory: Directory.Data, encoding: Encoding.UTF8 });

async function readJson(path: string): Promise<unknown> {
  const { data } = await Filesystem.readFile(at(path));
  return JSON.parse(typeof data === "string" ? data : await data.text());
}

export async function loadLog(): Promise<DiveDeckExport | null> {
  try {
    return readExport(await readJson(FILE));
  } catch {
    return null; // nothing imported yet
  }
}

export async function saveLog(log: DiveDeckExport): Promise<void> {
  await Filesystem.writeFile({ ...at(FILE), data: JSON.stringify(log) });
}

export async function loadPhoneFiles(): Promise<PhoneFile[]> {
  try {
    const files = await readJson(PHONE_FILES);
    return Array.isArray(files) ? files : [];
  } catch {
    return []; // none imported on the phone
  }
}

export async function savePhoneFiles(files: PhoneFile[]): Promise<void> {
  if (files.length) await Filesystem.writeFile({ ...at(PHONE_FILES), data: JSON.stringify(files) });
  else await Filesystem.deleteFile({ path: PHONE_FILES, directory: Directory.Data }).catch(() => undefined);
}

export async function forgetLog(): Promise<void> {
  await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }).catch(() => undefined);
  await savePhoneFiles([]);
}
