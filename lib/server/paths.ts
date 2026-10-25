import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * An environment variable by its DiveDeck name (`DIVEDECK_<name>`), else by the name it had when the
 * app was called AI Diving Monitor (`AI_DIVING_MONITOR_<name>`), so older setups keep working.
 */
export function envVar(name: string): string | undefined {
  return process.env[`DIVEDECK_${name}`]?.trim() || process.env[`AI_DIVING_MONITOR_${name}`]?.trim() || undefined;
}

/** The data folder of the AI Diving Monitor days, still used when nothing newer exists. */
const legacyHome = () => path.join(os.homedir(), ".ai-diving-monitor");

/**
 * The data folder shared by the MCP server and the web app: `DIVEDECK_HOME`, else the folder of the
 * Python version's database (`DIVEDECK_DB`), else `~/.divedeck` (or `~/.ai-diving-monitor` when only
 * that one exists). Read on every call, so tests can point it at a temporary folder.
 */
export function dataDir(): string {
  const home = envVar("HOME");
  if (home) return home;
  const db = envVar("DB");
  if (db) return path.dirname(db);
  const current = path.join(os.homedir(), ".divedeck");
  return !fs.existsSync(current) && fs.existsSync(legacyHome()) ? legacyHome() : current;
}

/** One `*.dive.json` file per dive. */
export const divesDir = () => path.join(dataDir(), "dives");
/** The original UDDF files, named by their SHA-256, so dives can be parsed again by a newer parser. */
export const originalsDir = () => path.join(dataDir(), "originals");
export const locksDir = () => path.join(dataDir(), "locks");

/** The Python version's SQLite database, for the one-time migration. */
export function pythonDbPath(): string {
  return envVar("DB") || path.join(legacyHome(), "dives.db");
}

/** The folder name people see in OneDrive and Google Drive. */
export const CLOUD_FOLDER = "DiveDeck";
/** Earlier names of that folder: an existing one is renamed to CLOUD_FOLDER. */
export const LEGACY_CLOUD_FOLDERS = ["AiDive"];
