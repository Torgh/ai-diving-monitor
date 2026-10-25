import path from "node:path";

/**
 * Restores the environment a test changed. Assigning a new object to `process.env` would detach it
 * from the real environment, so later changes (HOME, USERPROFILE) would no longer reach os.homedir()
 * and a test could touch the real home folder. This changes the existing object instead.
 */
export function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
}

/**
 * Points the app at a temporary data folder: removes every DIVEDECK_* and (older) AI_DIVING_MONITOR_*
 * variable first, so a test never reaches the real dive log or settings of the computer it runs on.
 */
export function isolateEnv(home: string): void {
  for (const key of Object.keys(process.env)) if (/^(DIVEDECK|AI_DIVING_MONITOR)_/i.test(key)) delete process.env[key];
  process.env.DIVEDECK_HOME = home;
  process.env.DIVEDECK_DB = path.join(home, "no-such.db");
}
