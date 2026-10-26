import { WATERS } from "@/lib/kit";
import { kitChangeSchema, parseKitChange } from "@/lib/kitSchema";
import { effectiveDive } from "@/lib/record";
import { DiveStore } from "@/lib/server/diveStore";
import { assertLocal, handle, readBody } from "@/lib/server/http";
import { KitStore } from "@/lib/server/kitStore";
import { TripStore } from "@/lib/server/tripStore";
import { logVersion } from "@/lib/server/version";
import { estimateWeighting, RENTAL_TANK_IDS } from "@/lib/weighting";

/**
 * The kit, the dive sites of the log and the trips (for giving each its water), and the lead each set
 * needs in each water, corrected by the dives logged with it: with its own tank, and with each rental tank.
 */
export const GET = handle(async (req) => {
  assertLocal(req);
  const [kit, records, trips, version] = await Promise.all([new KitStore().get(), new DiveStore().list(), new TripStore().list(), logVersion()]);
  const names = [...records.map((r) => effectiveDive(r).site), ...trips.flatMap((t) => t.dives.map((d) => d.site))];
  const siteNames = [...new Map(names.filter((n): n is string => !!n?.trim()).map((n) => [n.trim().toLowerCase(), n.trim()])).values()].sort();
  const estimates = Object.fromEntries(kit.sets.map((set) => [set.id, Object.fromEntries(WATERS.map((w) => [w, estimateWeighting(kit, records, set, w)]))]));
  // The same with a tank rented from the dive centre, for trips where the diver doesn't bring theirs.
  const rentalEstimates = Object.fromEntries(
    kit.sets.map((set) => [
      set.id,
      Object.fromEntries(RENTAL_TANK_IDS.map((tank) => [tank, Object.fromEntries(WATERS.map((w) => [w, estimateWeighting(kit, records, set, w, undefined, tank)]))])),
    ]),
  );
  return { ...kit, version, siteNames, estimates, rentalEstimates };
});

/** Changes the kit: the diver, gear, sets and sites given; the rest stays. */
export const PUT = handle(async (req) => {
  assertLocal(req);
  const change = parseKitChange(await readBody(req, kitChangeSchema));
  return new KitStore().update(change);
});
