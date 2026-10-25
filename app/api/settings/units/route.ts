import { units } from "@/lib/server/config";
import { assertLocal, handle } from "@/lib/server/http";

/** Just the units, for every page: cheaper than the whole settings view. */
export const GET = handle(async (req) => {
  assertLocal(req);
  return { units: units() };
});
