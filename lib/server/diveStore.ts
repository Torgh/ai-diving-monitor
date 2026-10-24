import { createHash } from "node:crypto";
import { type Dive, fingerprint } from "../dive";
import { chronological, type DiveDetails, type DiveRecord, RECORD_FORMAT, RECORD_VERSION, recordFileName, type Review } from "../record";
import { PARSER_VERSION, parseUddf } from "../uddf";
import { activeBackend, type Backend, type StoredFile } from "./backends";
import { withLock } from "./files";

export interface ImportResult {
  fileName: string;
  added: string[];
  duplicates: string[];
}

export class DiveNotFoundError extends Error {}

const now = () => new Date().toISOString();
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const originalName = (hash: string) => `${hash}.uddf`;

/** Parsed dive files, read again only when a file changes (the browser polls the log every few seconds). */
const parsed = new Map<string, { version: string; record: DiveRecord | null }>();

/** The newest record of each dive: a file can exist twice (a rename in progress, a OneDrive conflict copy). */
function newestPerDive(records: DiveRecord[]): DiveRecord[] {
  const newest = new Map<string, DiveRecord>();
  for (const r of records) {
    const seen = newest.get(r.id);
    if (!seen || r.updatedAt > seen.updatedAt) newest.set(r.id, r);
  }
  return [...newest.values()];
}

/**
 * The dive log: one `*.dive.json` file per dive and the original UDDF files, wherever the diver keeps
 * them (this PC, OneDrive, Google Drive). Shared by the MCP server and the web app.
 */
export class DiveStore {
  constructor(readonly backend: Backend = activeBackend()) {}

  private async readFile(file: StoredFile): Promise<DiveRecord | null> {
    const key = `${this.backend.kind}|${this.backend.location}|${file.name}`;
    const cached = parsed.get(key);
    if (cached && cached.version === file.version) return cached.record ? structuredClone(cached.record) : null;
    let record: DiveRecord | null = null;
    try {
      const data = await this.backend.read("dives", file.name);
      const json = data && JSON.parse(new TextDecoder().decode(data));
      record = json?.format === RECORD_FORMAT ? (json as DiveRecord) : null;
    } catch {
      record = null; // not a dive file, or half-written by another program
    }
    parsed.set(key, { version: file.version, record });
    return record ? structuredClone(record) : null;
  }

  private async records(): Promise<{ file: StoredFile; record: DiveRecord }[]> {
    const files = (await this.backend.list("dives")).filter((f) => f.name.endsWith(".dive.json"));
    const out = await Promise.all(files.map(async (file) => ({ file, record: await this.readFile(file) })));
    return out.filter((e): e is { file: StoredFile; record: DiveRecord } => e.record !== null);
  }

  /** Every dive, oldest first. Dives read by an older parser are parsed again from their original file. */
  async list(): Promise<DiveRecord[]> {
    const records = newestPerDive((await this.records()).map((e) => e.record));
    return chronological(await Promise.all(records.map((r) => this.upToDate(r))));
  }

  async get(id: string): Promise<DiveRecord | undefined> {
    const record = await this.read(id);
    return record ? this.upToDate(record) : undefined;
  }

  /** The stored record, newest copy. */
  private async read(id: string): Promise<DiveRecord | undefined> {
    return newestPerDive((await this.records()).filter((e) => e.record.id === id).map((e) => e.record))[0];
  }

  private async upToDate(record: DiveRecord): Promise<DiveRecord> {
    if (record.parserVersion >= PARSER_VERSION || !(await this.original(record))) return record;
    // Saving the record (with no other change) parses it again; see update().
    return this.update(record.id, () => {});
  }

  /**
   * Writes the record under its current name, then removes its other files: the old name after the
   * site changed, or a OneDrive conflict copy. The record was made from the newest copy (under the
   * dive's lock), so nothing newer is lost.
   */
  private async write(record: DiveRecord): Promise<void> {
    const name = recordFileName(record);
    const others = (await this.records()).filter((e) => e.record.id === record.id && e.file.name !== name);
    await this.backend.write("dives", name, JSON.stringify(record, null, 1) + "\n");
    for (const e of others) await this.backend.remove("dives", e.file.name);
  }

  /**
   * Changes a stored dive under its lock, so a concurrent save from another process isn't lost. A dive
   * read by an older parser is parsed again from its original file first.
   */
  async update(id: string, change: (record: DiveRecord) => void): Promise<DiveRecord> {
    return withLock(id, async () => {
      const record = await this.read(id);
      if (!record) throw new DiveNotFoundError(`No dive with id ${id}.`);
      await this.reparse(record);
      change(record);
      record.updatedAt = now();
      await this.write(record);
      return record;
    });
  }

  /** Fills in or changes details; `null` or an empty string removes one. */
  updateDetails(id: string, patch: { [K in keyof DiveDetails]?: DiveDetails[K] | null }): Promise<DiveRecord> {
    return this.update(id, (record) => {
      const details: Record<string, unknown> = { ...record.details };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (value === null || value === "") delete details[key];
        else details[key] = typeof value === "string" ? value.trim() : value;
      }
      record.details = details as DiveDetails;
    });
  }

  saveReview(id: string, markdown: string): Promise<DiveRecord> {
    const review: Review = { markdown, savedAt: now() };
    return this.update(id, (record) => {
      record.review = review;
    });
  }

  private async hasOriginal(hash: string): Promise<boolean> {
    return (await this.backend.list("originals")).some((f) => f.name === originalName(hash));
  }

  /** Stores the original file and every dive in it that isn't in the log yet. */
  async importFile(fileName: string, data: Uint8Array, options: { legacyIds?: Map<string, number> } = {}): Promise<ImportResult> {
    const dives = parseUddf(data); // throws UddfParseError on bad input
    const hash = sha256(data);
    const result: ImportResult = { fileName, added: [], duplicates: [] };
    // The original goes first, so no dive is ever stored without the file it can be parsed again from.
    const hadOriginal = await this.hasOriginal(hash);
    if (!hadOriginal) await this.backend.write("originals", originalName(hash), data);
    for (const dive of dives) {
      const id = fingerprint(dive);
      const added = await withLock(id, async () => {
        if (await this.read(id)) return false;
        const record = this.newRecord(id, dive, fileName, hash);
        const legacyId = options.legacyIds?.get(id);
        if (legacyId !== undefined) record.legacyId = legacyId;
        await this.write(record);
        return true;
      });
      (added ? result.added : result.duplicates).push(id);
    }
    // Nothing new in this file: don't keep a redundant copy.
    if (!result.added.length && !hadOriginal) await this.backend.remove("originals", originalName(hash));
    return result;
  }

  private newRecord(id: string, dive: Dive, fileName: string, hash: string): DiveRecord {
    const at = now();
    return {
      format: RECORD_FORMAT,
      version: RECORD_VERSION,
      id,
      importedAt: at,
      updatedAt: at,
      source: { fileName, sha256: hash, uddfId: dive.uddfId },
      parserVersion: PARSER_VERSION,
      dive,
      details: {},
      review: null,
    };
  }

  /** The original UDDF file a dive came from. */
  original(record: DiveRecord): Promise<Uint8Array | undefined> {
    return this.backend.read("originals", originalName(record.source.sha256));
  }

  /** Parses the dive again from its original file when a newer parser is installed. Keeps details and review. */
  private async reparse(record: DiveRecord): Promise<void> {
    if (record.parserVersion >= PARSER_VERSION) return;
    const data = await this.original(record);
    let dive: Dive | undefined;
    try {
      dive = data && parseUddf(data).find((d) => fingerprint(d) === record.id);
    } catch {
      dive = undefined; // keep what was parsed before
    }
    if (dive) {
      record.dive = dive;
      record.parserVersion = PARSER_VERSION;
    }
  }

  /** Copies a record as it is (another store's copy), without changing it. */
  async put(record: DiveRecord): Promise<void> {
    await withLock(record.id, () => this.write(record));
  }

  /** Copies an original file as it is. */
  async putOriginal(hash: string, data: Uint8Array): Promise<void> {
    if (!(await this.hasOriginal(hash))) await this.backend.write("originals", originalName(hash), data);
  }
}

/**
 * Copies the log to another place: every dive it doesn't have yet or has in an older version, with its
 * original file. Nothing is removed from where it came from.
 */
export async function copyLog(from: DiveStore, to: DiveStore): Promise<{ dives: number }> {
  const theirs = new Map((await to.list()).map((r) => [r.id, r.updatedAt]));
  let dives = 0;
  for (const record of await from.list()) {
    const seen = theirs.get(record.id);
    if (seen && seen >= record.updatedAt) continue;
    const original = await from.original(record);
    if (original) await to.putOriginal(record.source.sha256, original);
    await to.put(record);
    dives++;
  }
  return { dives };
}
