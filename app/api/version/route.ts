import { assertLocal, handle } from "@/lib/server/http";
import { logVersion } from "@/lib/server/version";

/** Polled by the browser: changes whenever a dive is added or changed (also by the MCP server). */
export const GET = handle(async (req) => {
  assertLocal(req);
  return { version: await logVersion() };
});
