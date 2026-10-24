import { createHash } from "node:crypto";
import { activeBackend, type Backend } from "./backends";

/**
 * A short tag that changes whenever a dive file is added, changed or removed, by the MCP server as
 * much as by the app, wherever the log is stored. The browser polls it and reloads the log only when
 * it changes.
 */
export async function logVersion(backend: Backend = activeBackend()): Promise<string> {
  const files = (await backend.list("dives")).filter((f) => f.name.endsWith(".dive.json"));
  const lines = files.map((f) => `${f.name}:${f.version}`).sort();
  return createHash("sha256").update(`${backend.kind}|${backend.location}\n${lines.join("\n")}`).digest("hex").slice(0, 16);
}
