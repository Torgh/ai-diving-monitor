/**
 * Dives imported on the phone, on their way to the PC. The phone keeps the original UDDF files it was
 * given and shows their dives next to the exported log until a newer export already holds them. "Send
 * to PC" puts the files in one `.divedeck.json` file, and the PC imports the originals as if they had
 * been dropped on its Import page, so a dive gets the same record on both.
 */

import { fingerprint } from "./dive";
import { ExportFileError } from "./exportFile";
import { chronological, type DiveRecord, newRecord } from "./record";
import { sha256Bytes } from "./sha256";
import { parseUddf } from "./uddf";

export const PHONE_DIVES_FORMAT = "divedeck/phone-dives";
export const PHONE_DIVES_VERSION = 1;

/** An original UDDF file imported on the phone. */
export interface PhoneFile {
  fileName: string;
  sha256: string;
  importedAt: string;
  /** The file's bytes, base64. */
  data: string;
}

export interface PhoneDives {
  format: typeof PHONE_DIVES_FORMAT;
  version: number;
  exportedAt: string;
  files: PhoneFile[];
}

// btoa/atob work on "binary strings"; in chunks, so a large file doesn't overflow the call stack.
export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(data: string): Uint8Array {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** The dives in one file, as the PC would store them; the same dive twice in a file counts once. */
function fileRecords(file: PhoneFile, bytes = fromBase64(file.data)): DiveRecord[] {
  const records = new Map<string, DiveRecord>();
  for (const dive of parseUddf(bytes)) {
    const id = fingerprint(dive);
    if (!records.has(id)) records.set(id, newRecord(id, dive, file.fileName, file.sha256, file.importedAt));
  }
  return [...records.values()];
}

/** Reads a UDDF file picked on the phone. Throws UddfParseError when it isn't one. */
export function phoneFile(fileName: string, bytes: Uint8Array, at: string): { file: PhoneFile; records: DiveRecord[] } {
  const file: PhoneFile = { fileName, sha256: sha256Bytes(bytes), importedAt: at, data: toBase64(bytes) };
  return { file, records: fileRecords(file, bytes) };
}

/** The log the phone shows: the exported dives, plus the phone's own dives the export doesn't have yet. */
export function withPhoneDives(exported: DiveRecord[], files: PhoneFile[]): { dives: DiveRecord[]; phoneOnly: Set<string> } {
  const known = new Set(exported.map((d) => d.id));
  const added = new Map<string, DiveRecord>();
  for (const file of files) {
    let records: DiveRecord[];
    try {
      records = fileRecords(file);
    } catch {
      continue; // read when it was imported; skip it rather than lose the whole log
    }
    for (const r of records) if (!known.has(r.id) && !added.has(r.id)) added.set(r.id, r);
  }
  return { dives: chronological([...exported, ...added.values()]), phoneOnly: new Set(added.keys()) };
}

/** The files with a dive the export doesn't hold yet: the rest have reached the PC and can go. */
export function stillOnPhone(files: PhoneFile[], exported: DiveRecord[]): PhoneFile[] {
  const known = new Set(exported.map((d) => d.id));
  return files.filter((file) => {
    try {
      return fileRecords(file).some((r) => !known.has(r.id));
    } catch {
      return false;
    }
  });
}

export function buildPhoneDives(files: PhoneFile[], now: string): PhoneDives {
  return { format: PHONE_DIVES_FORMAT, version: PHONE_DIVES_VERSION, exportedAt: now, files };
}

/** "DiveDeck from phone 2026-10-27.divedeck.json". */
export function phoneDivesFileName(now: string): string {
  return `DiveDeck from phone ${now.slice(0, 10)}.divedeck.json`;
}

export const isPhoneDives = (json: unknown): boolean => typeof json === "object" && json !== null && (json as { format?: unknown }).format === PHONE_DIVES_FORMAT;

/** Reads the file the phone sent, as the PC's original files: name and bytes. */
export function readPhoneDives(json: unknown): { fileName: string; data: Uint8Array }[] {
  if (!isPhoneDives(json)) throw new ExportFileError("This isn't a file from the DiveDeck phone app. On the phone, use Your file → Send to PC.");
  const { version, files } = json as { version?: unknown; files?: unknown };
  if (typeof version === "number" && version > PHONE_DIVES_VERSION) throw new ExportFileError("This file comes from a newer phone app. Update DiveDeck on the PC, then import it again.");
  if (!Array.isArray(files)) return [];
  return files
    .filter((f): f is PhoneFile => typeof f?.fileName === "string" && typeof f?.data === "string")
    .map((f) => ({ fileName: f.fileName, data: fromBase64(f.data) }));
}
