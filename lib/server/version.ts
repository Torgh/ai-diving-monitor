import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { divesDir } from "./paths";

/**
 * A short tag that changes whenever a dive file is added, changed or removed, by the MCP server as
 * much as by the app. The browser polls it and reloads the log only when it changes.
 */
export async function logVersion(dir = divesDir()): Promise<string> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".dive.json")).sort();
  const stats = await Promise.all(
    names.map(async (n) => {
      const s = await fs.stat(path.join(dir, n)).catch(() => undefined);
      return s ? `${n}:${s.size}:${s.mtimeMs}` : "";
    }),
  );
  return createHash("sha256").update(stats.join("\n")).digest("hex").slice(0, 16);
}
