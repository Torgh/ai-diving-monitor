import { createHash } from "node:crypto";
import { activeBackend, type Backend } from "./backends";

/**
 * A short tag that changes whenever a dive, trip or kit file is added, changed or removed, by the MCP
 * server as much as by the app, wherever the log is stored. The open pages are told when it changes
 * (liveVersion) and reload the log only then.
 */
export async function logVersion(backend: Backend = activeBackend()): Promise<string> {
  const [dives, trips, kit] = await Promise.all([backend.list("dives"), backend.list("trips"), backend.list("kit")]);
  const lines = [
    ...dives.filter((f) => f.name.endsWith(".dive.json")),
    ...trips.filter((f) => f.name.endsWith(".trip.json")).map((f) => ({ ...f, name: `trips/${f.name}` })),
    ...kit.filter((f) => f.name === "kit.json").map((f) => ({ ...f, name: `kit/${f.name}` })),
  ]
    .map((f) => `${f.name}:${f.version}`)
    .sort();
  return createHash("sha256").update(`${backend.kind}|${backend.location}\n${lines.join("\n")}`).digest("hex").slice(0, 16);
}
