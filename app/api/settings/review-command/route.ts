import { z } from "zod";
import { installReviewCommand } from "@/lib/server/agentApps";
import { assertLocal, handle, readBody } from "@/lib/server/http";

/** Installs the /dive-review slash command for all Claude Code sessions. */
export const POST = handle(async (req) => {
  assertLocal(req);
  await readBody(req, z.object({}));
  installReviewCommand();
  return { installed: true };
});
