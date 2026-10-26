/**
 * The whole log in one file, for the phone app: the dives as stored (the phone runs the same analysis
 * and views from this `lib/`), the trips with their preparation, the kit and the chosen units. The
 * original UDDF files stay behind: the stored dives already hold what was parsed from them.
 */

import { type Kit, readKit } from "./kit";
import { isUnitSystem, type UnitSystem } from "./measure";
import { chronological, type DiveRecord, RECORD_FORMAT } from "./record";
import { TRIP_FORMAT, type TripPlan } from "./trip";

export const EXPORT_FORMAT = "divedeck/export";
export const EXPORT_VERSION = 1;
export const EXPORT_EXTENSION = ".divedeck.json";

export interface DiveDeckExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  units: UnitSystem;
  dives: DiveRecord[];
  trips: TripPlan[];
  kit: Kit;
}

export class ExportFileError extends Error {}

export function buildExport(content: { dives: DiveRecord[]; trips: TripPlan[]; kit: Kit; units: UnitSystem }, now: string): DiveDeckExport {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, units: content.units, dives: chronological(content.dives), trips: content.trips, kit: content.kit };
}

/** "DiveDeck 2026-10-26.divedeck.json": the day of the export, so a newer file is easy to pick. */
export function exportFileName(now: string): string {
  return `DiveDeck ${now.slice(0, 10)}${EXPORT_EXTENSION}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads an export file's JSON. Refuses other files and exports from a newer DiveDeck (the phone app
 * would show them wrong); skips single dives or trips it can't read instead of losing the whole file.
 */
export function readExport(json: unknown): DiveDeckExport {
  if (!isObject(json) || json.format !== EXPORT_FORMAT) throw new ExportFileError("This isn't a DiveDeck export. On the PC, use Settings → Export for phone.");
  const version = typeof json.version === "number" ? json.version : 0;
  if (version > EXPORT_VERSION) throw new ExportFileError("This export comes from a newer DiveDeck. Update the phone app, then import it again.");
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObject) : []);
  const dives = list(json.dives).filter((d) => d.format === RECORD_FORMAT && typeof d.id === "string" && isObject(d.dive)) as unknown as DiveRecord[];
  const trips = list(json.trips).filter((t) => t.format === TRIP_FORMAT && typeof t.id === "string" && Array.isArray(t.dives)) as unknown as TripPlan[];
  return {
    format: EXPORT_FORMAT,
    version,
    exportedAt: typeof json.exportedAt === "string" ? json.exportedAt : "",
    units: isUnitSystem(json.units) ? json.units : "metric",
    dives: chronological(dives),
    trips,
    kit: readKit(json.kit),
  };
}
