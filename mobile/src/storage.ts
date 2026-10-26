import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { type DiveDeckExport, readExport } from "@/lib/exportFile";

// The imported log, in the app's own storage: it survives restarts and works offline. In a desktop
// browser (bun run dev:mobile) Filesystem falls back to IndexedDB.
const FILE = "log.divedeck.json";
const where = { path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 };

export async function loadLog(): Promise<DiveDeckExport | null> {
  try {
    const { data } = await Filesystem.readFile(where);
    return readExport(JSON.parse(typeof data === "string" ? data : await data.text()));
  } catch {
    return null; // nothing imported yet
  }
}

export async function saveLog(log: DiveDeckExport): Promise<void> {
  await Filesystem.writeFile({ ...where, data: JSON.stringify(log) });
}

export async function forgetLog(): Promise<void> {
  await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }).catch(() => undefined);
}
