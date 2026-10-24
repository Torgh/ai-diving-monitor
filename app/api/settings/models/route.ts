import { z } from "zod";
import { describeApiError, listModels } from "@/lib/server/coachAgent";
import { assertLocal, handle, readBody } from "@/lib/server/http";

/** The models the provider offers to the saved key. */
export const POST = handle(async (req) => {
  assertLocal(req);
  const { provider } = await readBody(req, z.object({ provider: z.enum(["anthropic", "openai"]) }));
  try {
    return { models: await listModels(provider) };
  } catch (err) {
    throw describeApiError(err) ?? err;
  }
});
