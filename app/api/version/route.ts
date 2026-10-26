import { assertLocal, handle } from "@/lib/server/http";
import { logVersion } from "@/lib/server/version";

/** The log's version: changes whenever a dive, trip or the kit changes (also by the MCP server). Pages follow /api/events. */
export const GET = handle(async (req) => {
  assertLocal(req);
  return { version: await logVersion() };
});
