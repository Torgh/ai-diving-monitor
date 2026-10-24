import { DatabaseSync } from "node:sqlite";
import { fingerprint } from "../dive";
import { parseUddf, UddfParseError } from "../uddf";
import type { DiveStore } from "./diveStore";

export interface MigrationReport {
  database: string;
  files: number;
  added: number;
  alreadyThere: number;
  reviews: number;
  /** Files the TypeScript parser couldn't read (kept in the Python database). */
  failed: { fileName: string; error: string }[];
}

interface FileRow {
  id: number;
  filename: string;
  content: Uint8Array;
}

interface DiveRow {
  id: number;
  fingerprint: string;
  ai_summary: string | null;
}

/**
 * Copies the Python version's log into the dive files: every stored original UDDF file is imported
 * again (the TypeScript parser gives the same dives and fingerprints), and each saved review moves to
 * its dive. The database is only read, and running it again adds nothing twice.
 */
export async function migrateFromPython(store: DiveStore, database: string): Promise<MigrationReport> {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const files = db.prepare("SELECT id, filename, content FROM files ORDER BY id").all() as unknown as FileRow[];
    const dives = db.prepare("SELECT id, fingerprint, ai_summary FROM dives").all() as unknown as DiveRow[];
    const legacyIds = new Map(dives.map((d) => [d.fingerprint, d.id]));
    const report: MigrationReport = { database, files: files.length, added: 0, alreadyThere: 0, reviews: 0, failed: [] };

    for (const file of files) {
      const data = new Uint8Array(file.content);
      try {
        parseUddf(data).map(fingerprint); // fail early, before anything is written
        const result = await store.importFile(file.filename, data, { legacyIds });
        report.added += result.added.length;
        report.alreadyThere += result.duplicates.length;
      } catch (error) {
        if (!(error instanceof UddfParseError)) throw error;
        report.failed.push({ fileName: file.filename, error: error.message });
      }
    }

    for (const dive of dives) {
      if (!dive.ai_summary) continue;
      const record = await store.get(dive.fingerprint);
      if (!record || record.review) continue; // a review written since then wins
      await store.saveReview(dive.fingerprint, dive.ai_summary);
      report.reviews++;
    }
    return report;
  } finally {
    db.close();
  }
}
