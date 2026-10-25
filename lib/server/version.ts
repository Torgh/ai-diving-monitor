import { createHash } from "node:crypto";
import { activeBackend, type Backend } from "./backends";

/**
 * A short tag that changes whenever a dive or trip file is added, changed or removed, by the MCP
 * server as much as by the app, wherever the log is stored. The browser polls it and reloads the log
 * only when it changes.
 */
export async function logVersion(backend: Backend = activeBackend()): Promise<string> {
  const [dives, trips] = await Promise.all([backend.list("dives"), backend.list("trips")]);
  const lines = [
    ...dives.filter((f) => f.name.endsWith(".dive.json")),
    ...trips.filter((f) => f.name.endsWith(".trip.json")).map((f) => ({ ...f, name: `trips/${f.name}` })),
  ]
    .map((f) => `${f.name}:${f.version}`)
    .sort();
  return createHash("sha256").update(`${backend.kind}|${backend.location}\n${lines.join("\n")}`).digest("hex").slice(0, 16);
}
