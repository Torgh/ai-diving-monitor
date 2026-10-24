import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { type Dive, fingerprint } from "../dive";
import { chronological, type DiveDetails, type DiveRecord, RECORD_FORMAT, RECORD_VERSION, recordFileName, type Review } from "../record";
import { PARSER_VERSION, parseUddf } from "../uddf";
import { readJson, withLock, writeFileAtomic } from "./files";
import { divesDir, originalsDir } from "./paths";

export interface ImportResult {
  fileName: string;
  added: string[];
  duplicates: string[];
}

export class DiveNotFoundError extends Error {}

const now = () => new Date().toISOString();
const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/**
 * The dive log on this computer: one `*.dive.json` file per dive in `<data folder>/dives`, and the
 * original UDDF files in `<data folder>/originals`. Shared by the MCP server and the web app.
 */
export class DiveStore {
  constructor(
    readonly dir = divesDir(),
    readonly originals = originalsDir(),
  ) {}

  private async fileOf(id: string): Promise<string | undefined> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    const name = names.find((n) => n.endsWith(`(${id}).dive.json`));
    return name && path.join(this.dir, name);
  }

  /** Every dive, oldest first. Dives read by an older parser are parsed again from their original file. */
  async list(): Promise<DiveRecord[]> {
    const names = (await fs.readdir(this.dir).catch(() => [] as string[])).filter((n) => n.endsWith(".dive.json"));
    const records = (await Promise.all(names.map((n) => readJson<DiveRecord>(path.join(this.dir, n))))).filter(
      (r): r is DiveRecord => r?.format === RECORD_FORMAT,
    );
    return chronological(await Promise.all(records.map((r) => this.upToDate(r))));
  }

  async get(id: string): Promise<DiveRecord | undefined> {
    const record = await this.read(id);
    return record ? this.upToDate(record) : undefined;
  }

  /** The stored record as it is on disk. */
  private async read(id: string): Promise<DiveRecord | undefined> {
    const file = await this.fileOf(id);
    const record = file && (await readJson<DiveRecord>(file));
    return record && record.format === RECORD_FORMAT ? record : undefined;
  }

  private async upToDate(record: DiveRecord): Promise<DiveRecord> {
    if (record.parserVersion >= PARSER_VERSION || !(await this.original(record))) return record;
    // Saving the record (with no other change) parses it again; see update().
    return this.update(record.id, () => {});
  }

  /** Writes the record under its current file name, removing the file it had before (the site may have changed). */
  private async write(record: DiveRecord): Promise<void> {
    const before = await this.fileOf(record.id);
    const file = path.join(this.dir, recordFileName(record));
    await writeFileAtomic(file, JSON.stringify(record, null, 1) + "\n");
    if (before && path.resolve(before) !== path.resolve(file)) await fs.rm(before, { force: true });
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

  /** Stores the original file and every dive in it that isn't in the log yet. */
  async importFile(fileName: string, data: Uint8Array, options: { legacyIds?: Map<string, number> } = {}): Promise<ImportResult> {
    const dives = parseUddf(data); // throws UddfParseError on bad input
    const hash = sha256(data);
    const result: ImportResult = { fileName, added: [], duplicates: [] };
    // The original goes first, so no dive is ever stored without the file it can be parsed again from.
    const original = path.join(this.originals, `${hash}.uddf`);
    const hadOriginal = await fs.stat(original).then(() => true, () => false);
    if (!hadOriginal) await writeFileAtomic(original, data);
    for (const dive of dives) {
      const id = fingerprint(dive);
      const added = await withLock(id, async () => {
        if (await this.fileOf(id)) return false;
        const record = this.newRecord(id, dive, fileName, hash);
        const legacyId = options.legacyIds?.get(id);
        if (legacyId !== undefined) record.legacyId = legacyId;
        await this.write(record);
        return true;
      });
      (added ? result.added : result.duplicates).push(id);
    }
    // Nothing new in this file: don't keep a redundant copy.
    if (!result.added.length && !hadOriginal) await fs.rm(original, { force: true });
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
  async original(record: DiveRecord): Promise<Uint8Array | undefined> {
    return fs.readFile(path.join(this.originals, `${record.source.sha256}.uddf`)).catch(() => undefined);
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
}
