import { activeStorage, backendFor, type StorageKind } from "./backends";
import { updateSettings } from "./config";
import { copyLog, DiveStore } from "./diveStore";
import { copyTrips, TripStore } from "./tripStore";

/**
 * Makes `storage` the place of the log and copies the dives and the trips there; where they were stays
 * as it was. Returns how many dives were copied.
 */
export async function switchStorage(storage: StorageKind): Promise<number> {
  const before = backendFor(activeStorage());
  await updateSettings({ storage });
  const after = backendFor(activeStorage());
  if (before.kind === after.kind && before.location === after.location) return 0;
  const { dives } = await copyLog(new DiveStore(before), new DiveStore(after));
  await copyTrips(new TripStore(before), new TripStore(after));
  return dives;
}
