import { WATERS } from "@/lib/kit";
import { kitChangeSchema, parseKitChange } from "@/lib/kitSchema";
import { effectiveDive } from "@/lib/record";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, readBody } from "@/lib/server/http";
import { KitStore } from "@/lib/server/kitStore";
import { TripStore } from "@/lib/server/tripStore";
import { logVersion } from "@/lib/server/version";
import { estimateWeighting } from "@/lib/weighting";

/**
 * The kit, the dive sites of the log and the trips (for giving each its water), and the lead each set
 * needs in each water, corrected by the dives logged with it.
 */
export const GET = handle(async (req) => {
  assertLocal(req);
  const [kit, records, trips, version] = await Promise.all([new KitStore().get(), new DiveStore().list(), new TripStore().list(), logVersion()]);
  const names = [...records.map((r) => effectiveDive(r).site), ...trips.flatMap((t) => t.dives.map((d) => d.site))];
  const siteNames = [...new Map(names.filter((n): n is string => !!n?.trim()).map((n) => [n.trim().toLowerCase(), n.trim()])).values()].sort();
  const estimates = Object.fromEntries(kit.sets.map((set) => [set.id, Object.fromEntries(WATERS.map((w) => [w, estimateWeighting(kit, records, set, w)]))]));
  return { ...kit, version, siteNames, estimates };
});

/** Changes the kit: the diver, gear, sets and sites given; the rest stays. */
export const PUT = handle(async (req) => {
  assertLocal(req);
  const change = parseKitChange(await readBody(req, kitChangeSchema));
  return new KitStore().update(change);
});
