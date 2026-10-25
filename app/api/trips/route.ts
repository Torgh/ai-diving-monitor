import { assertLocal, handle } from "@/lib/server/http";
import { TripStore } from "@/lib/server/tripStore";
import { logVersion } from "@/lib/server/version";
import { tripsView } from "@/lib/tripViews";

export const GET = handle(async (req) => {
  assertLocal(req);
  const version = await logVersion();
  return { version, ...tripsView(await new TripStore().list()) };
});
