import { kitChangeSchema, parseKitChange } from "@/lib/kitSchema";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, readBody } from "@/lib/server/http";
import { KitStore } from "@/lib/server/kitStore";
import { TripStore } from "@/lib/server/tripStore";
import { logVersion } from "@/lib/server/version";
import { effectiveDive } from "@/lib/record";

/** The kit, and the dive sites of the log and the trips, for giving each its water. */
export const GET = handle(async (req) => {
  assertLocal(req);
  const [kit, records, trips, version] = await Promise.all([new KitStore().get(), new DiveStore().list(), new TripStore().list(), logVersion()]);
  const names = [...records.map((r) => effectiveDive(r).site), ...trips.flatMap((t) => t.dives.map((d) => d.site))];
  const siteNames = [...new Map(names.filter((n): n is string => !!n?.trim()).map((n) => [n.trim().toLowerCase(), n.trim()])).values()].sort();
  return { ...kit, version, siteNames };
});

/** Changes the kit: the diver, gear, sets and sites given; the rest stays. */
export const PUT = handle(async (req) => {
  assertLocal(req);
  const change = parseKitChange(await readBody(req, kitChangeSchema));
  return new KitStore().update(change);
});
