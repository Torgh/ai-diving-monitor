import os from "node:os";
import path from "node:path";

/**
 * The data folder shared by the MCP server and (later) the web app:
 * `AI_DIVING_MONITOR_HOME`, else the folder of the Python version's database (`AI_DIVING_MONITOR_DB`),
 * else `~/.ai-diving-monitor`. Read on every call, so tests can point it at a temporary folder.
 */
export function dataDir(): string {
  const home = process.env.AI_DIVING_MONITOR_HOME?.trim();
  if (home) return home;
  const db = process.env.AI_DIVING_MONITOR_DB?.trim();
  if (db) return path.dirname(db);
  return path.join(os.homedir(), ".ai-diving-monitor");
}

/** One `*.dive.json` file per dive. */
export const divesDir = () => path.join(dataDir(), "dives");
/** The original UDDF files, named by their SHA-256, so dives can be parsed again by a newer parser. */
export const originalsDir = () => path.join(dataDir(), "originals");
export const locksDir = () => path.join(dataDir(), "locks");

/** The Python version's SQLite database, for the one-time migration. */
export function pythonDbPath(): string {
  return process.env.AI_DIVING_MONITOR_DB?.trim() || path.join(os.homedir(), ".ai-diving-monitor", "dives.db");
}
