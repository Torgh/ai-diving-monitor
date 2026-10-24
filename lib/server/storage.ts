import { activeStorage, backendFor, type StorageKind } from "./backends";
import { updateSettings } from "./config";
import { copyLog, DiveStore } from "./diveStore";

/** Makes `storage` the place of the log and copies the dives there; where they were stays as it was. */
export async function switchStorage(storage: StorageKind): Promise<number> {
  const before = backendFor(activeStorage());
  await updateSettings({ storage });
  const after = backendFor(activeStorage());
  if (before.kind === after.kind && before.location === after.location) return 0;
  const { dives } = await copyLog(new DiveStore(before), new DiveStore(after));
  return dives;
}
