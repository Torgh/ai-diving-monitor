import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "./dive";
import { buildExport, EXPORT_FORMAT, EXPORT_VERSION, ExportFileError, exportFileName, readExport } from "./exportFile";
import { emptyKit, updateKit } from "./kit";
import { type DiveRecord, RECORD_FORMAT } from "./record";
import { mergeTripPlan } from "./trip";
import { tripView } from "./tripViews";
import { parseUddf } from "./uddf";
import { diveView, logView } from "./views";

const ROOT = path.resolve(__dirname, "..");
const records: DiveRecord[] = parseUddf(fs.readFileSync(path.join(ROOT, "examples", "summer-2026.uddf"))).map((dive, i) => ({
  format: RECORD_FORMAT,
  version: 1,
  id: fingerprint(dive),
  importedAt: `2026-10-24T10:00:0${i}.000Z`,
  updatedAt: "2026-10-24T10:00:00.000Z",
  source: { fileName: "summer.uddf", sha256: "0".repeat(64), uddfId: dive.uddfId },
  parserVersion: 2,
  dive,
  details: i === 0 ? { site: "Canyon", tankVolumeL: 12 } : {},
  review: i === 0 ? { markdown: "## Good dive", savedAt: "2026-10-24T11:00:00.000Z" } : null,
}));
const trip = mergeTripPlan(undefined, { id: "t", name: "Dahab", dives: [{ itemId: "c1", title: "Canyon", date: "2026-11-02", prepMarkdown: "## Ready" }] }, "2026-10-01T00:00:00.000Z");
const kit = updateKit(emptyKit(), { diver: { massKg: 74 } }, "2026-10-01T00:00:00.000Z");
const NOW = "2026-10-26T18:00:00.000Z";

/** Through JSON, as the file travels to the phone. */
const roundTrip = (value: unknown) => readExport(JSON.parse(JSON.stringify(value)));

describe("the export for the phone", () => {
  it("carries the dives, trips, kit and units, and the phone shows the same pages from it", () => {
    const file = buildExport({ dives: [...records].reverse(), trips: [trip], kit, units: "imperial" }, NOW);
    expect(file).toMatchObject({ format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: NOW, units: "imperial" });
    expect(file.dives.map((d) => d.id)).toEqual(records.map((d) => d.id)); // oldest first
    const back = roundTrip(file);
    expect(back).toEqual(file);
    expect(logView(back.dives)).toEqual(logView(records));
    expect(diveView(back.dives, records[0].id)).toEqual(diveView(records, records[0].id));
    const today = new Date("2026-10-25T09:00:00Z");
    expect(tripView(back.trips, back.dives, "t", today)).toEqual(tripView([trip], records, "t", today));
    expect(back.kit.diver.massKg).toBe(74);
  });

  it("is named after the day it was made", () => {
    expect(exportFileName(NOW)).toBe("DiveDeck 2026-10-26.divedeck.json");
  });

  it("refuses other files and exports from a newer DiveDeck", () => {
    for (const bad of [null, [], "x", { format: "ai-diving-monitor/dive" }]) expect(() => readExport(bad)).toThrow(ExportFileError);
    expect(() => readExport({ format: EXPORT_FORMAT, version: EXPORT_VERSION + 1 })).toThrow(/newer DiveDeck/);
  });

  it("skips the dives and trips it can't read, and falls back to an empty kit and metric", () => {
    const back = readExport({ format: EXPORT_FORMAT, version: 1, dives: [records[1], { format: RECORD_FORMAT }, 5], trips: [trip, { id: "x" }], kit: { format: "other" }, units: "furlongs" });
    expect(back.dives.map((d) => d.id)).toEqual([records[1].id]);
    expect(back.trips.map((t) => t.id)).toEqual(["t"]);
    expect(back.kit).toEqual(emptyKit());
    expect(back.units).toBe("metric");
    expect(readExport({ format: EXPORT_FORMAT })).toMatchObject({ version: 0, exportedAt: "", dives: [], trips: [] });
  });
});
