import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "./dive";
import {
  analyzeRecord,
  chronological,
  DIVER_GAS_ID,
  type DiveRecord,
  effectiveDive,
  logTodos,
  parseGas,
  RECORD_FORMAT,
  recordFileName,
} from "./record";
import { parseUddf } from "./uddf";

const ROOT = path.resolve(__dirname, "..");
const [shearwater] = parseUddf(readFileSync(path.join(ROOT, "fixtures", "uddf", "shearwater-style.uddf")));

function record(dive = shearwater, extra: Partial<DiveRecord> = {}): DiveRecord {
  return {
    format: RECORD_FORMAT,
    version: 1,
    id: fingerprint(dive),
    importedAt: "2026-10-24T10:00:00.000Z",
    updatedAt: "2026-10-24T10:00:00.000Z",
    source: { fileName: "x.uddf", sha256: "0".repeat(64), uddfId: dive.uddfId },
    parserVersion: 2,
    dive,
    details: {},
    review: null,
    ...extra,
  };
}

describe("dive records", () => {
  it("gives a dive its gas consumption once the tank volume is filled in", () => {
    const before = analyzeRecord(record());
    expect(before.metrics.rmvLMin).toBeNull();
    const after = analyzeRecord(record(shearwater, { details: { tankVolumeL: 12 } }));
    expect(after.metrics.gasUsedL).toBe(1680); // (200 - 60) bar × 12 L
    expect(after.metrics.rmvLMin).toBeGreaterThan(10);
  });

  it("applies the gas the diver names, without touching the stored dive", () => {
    const r = record(shearwater, { details: { gas: { o2: 0.32, he: 0 }, site: "Zakrzówek", buddy: "Ola" } });
    const dive = effectiveDive(r);
    expect(dive.gasMixes[DIVER_GAS_ID].name).toBe("EAN32");
    expect(dive.tanks[0].mixId).toBe(DIVER_GAS_ID);
    expect(dive.samples[0].mixRef).toBe(DIVER_GAS_ID);
    expect(dive.site).toBe("Zakrzówek");
    expect(analyzeRecord(r).metrics.gases).toEqual(["EAN32"]);
    expect(r.dive.gasMixes[DIVER_GAS_ID]).toBeUndefined();
  });

  it("adds a tank when the computer recorded none", () => {
    const noTanks = { ...shearwater, tanks: [] };
    expect(effectiveDive(record(noTanks, { details: { tankVolumeL: 15 } })).tanks).toEqual([
      { id: "tank1", mixId: null, volumeL: 15, startBar: null, endBar: null },
    ]);
  });

  it("names files by date, site and id", () => {
    const r = record(shearwater, { details: { site: "Koparki / Jaworzno?" } });
    expect(recordFileName(r)).toBe(`2026-09-12 1015 Koparki Jaworzno (${r.id}).dive.json`);
    const undated = record({ ...shearwater, start: null });
    expect(recordFileName(undated)).toBe(`undated (${undated.id}).dive.json`);
  });

  it("orders dives by start time, then by import", () => {
    const a = record({ ...shearwater, start: "2026-01-01T10:00:00" }, { id: "a" });
    const b = record({ ...shearwater, start: null }, { id: "b" });
    const c = record({ ...shearwater, start: "2026-01-01T10:00:00" }, { id: "c", importedAt: "2026-10-25T00:00:00.000Z" });
    expect(chronological([c, a, b]).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("lists what is still missing in the log", () => {
    const bare = record({ ...shearwater, gasMixes: {} });
    const done = record(shearwater, {
      id: "done",
      details: { site: "Koparki", tankVolumeL: 12, gas: { o2: 0.21, he: 0 } },
      review: { markdown: "ok", savedAt: "2026-10-24T11:00:00.000Z" },
    });
    expect(logTodos([bare, done]).map((t) => [t.kind, t.dives])).toEqual([
      ["tank-volume", [bare.id]],
      ["gas", [bare.id]],
      ["site", [bare.id]],
      ["review", [bare.id]],
    ]);
    expect(logTodos([done])).toEqual([]);
  });

  it("reads gases the way divers write them", () => {
    const cases: [string, { o2: number; he: number } | null][] = [
      ["Air", { o2: 0.21, he: 0 }],
      ["powietrze", { o2: 0.21, he: 0 }],
      ["EAN32", { o2: 0.32, he: 0 }],
      ["nitrox 36", { o2: 0.36, he: 0 }],
      ["50%", { o2: 0.5, he: 0 }],
      ["oxygen", { o2: 1, he: 0 }],
      ["Tx 18/45", { o2: 0.18, he: 0.45 }],
      ["trimix 21/35", { o2: 0.21, he: 0.35 }],
      ["10/70", { o2: 0.1, he: 0.7 }],
      ["21,5", { o2: 0.215, he: 0 }],
      ["banana", null],
      ["80/30", null],
      ["2", null],
    ];
    for (const [text, gas] of cases) expect(parseGas(text), text).toEqual(gas);
  });
});
