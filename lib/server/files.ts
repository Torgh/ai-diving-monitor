import fs from "node:fs/promises";
import path from "node:path";
import { locksDir } from "./paths";

/** Writes atomically (temp file + rename), so a crash never leaves half a file. */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** A lock older than this was left behind by a crashed process. */
const STALE_MS = 30_000;
const WAIT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LockTimeoutError extends Error {}

/**
 * Runs `fn` while holding this computer's lock on `name`. The MCP server and the web app are separate
 * processes that both read a dive, change it and write it back; without the lock the later write
 * would silently drop the other's change.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(locksDir(), { recursive: true });
  const file = path.join(locksDir(), `${name}.lock`);
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      await fs.writeFile(file, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const stat = await fs.stat(file).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > STALE_MS) {
        await fs.rm(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new LockTimeoutError("Another save of this dive is taking too long. Try again.");
      await sleep(20 + Math.random() * 40);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(file, { force: true });
  }
}
