/**
 * Copies the Python version's dive log (its SQLite database) into the dive files of the TypeScript
 * version: every dive and saved review. The database is only read; running it again adds nothing twice.
 *
 *   bun run migrate                 # AI_DIVING_MONITOR_DB, or ~/.ai-diving-monitor/dives.db
 *   bun run migrate path/to/dives.db
 */
import fs from "node:fs";
import { DiveStore } from "../lib/server/diveStore";
import { migrateFromPython } from "../lib/server/migrate";
import { dataDir, pythonDbPath } from "../lib/server/paths";

const database = process.argv[2] || pythonDbPath();
if (!fs.existsSync(database)) {
  console.error(`No database at ${database}.`);
  process.exit(1);
}
const report = await migrateFromPython(new DiveStore(), database);
console.log(`From ${report.database} to ${dataDir()}:`);
console.log(`  ${report.files} files, ${report.added} dives added, ${report.alreadyThere} already there, ${report.reviews} reviews moved`);
for (const f of report.failed) console.log(`  not read: ${f.fileName} (${f.error})`);
