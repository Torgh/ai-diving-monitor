/**
 * Restores the environment a test changed. Assigning a new object to `process.env` would detach it
 * from the real environment, so later changes (HOME, USERPROFILE) would no longer reach os.homedir()
 * and a test could touch the real home folder. This changes the existing object instead.
 */
export function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value;
}
