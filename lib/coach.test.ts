import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { diveAnalysis, DiveRefError, diveProfile, listDives, METRIC_NAMES, overview, progressTrend, resolveDive, snake, snakeKeys, tripCardUrl } from "./coach";
import { fingerprint } from "./dive";
import { type DiveRecord, RECORD_FORMAT } from "./record";
import { parseUddf } from "./uddf";

const ROOT = path.resolve(__dirname, "..");
const golden = JSON.parse(readFileSync(path.join(ROOT, "fixtures", "golden", "history.json"), "utf8"));

const records: DiveRecord[] = (golden.sources as string[]).flatMap((source, f) =>
  parseUddf(readFileSync(path.join(ROOT, source))).map((dive, i) => ({
    format: RECORD_FORMAT,
    version: 1,
    id: fingerprint(dive),
    importedAt: `2026-10-24T10:0${f}:0${i}.000Z`,
    updatedAt: "2026-10-24T10:00:00.000Z",
    source: { fileName: source, sha256: "0".repeat(64), uddfId: dive.uddfId },
    parserVersion: 2,
    dive,
    details: {},
    review: null,
  })),
);

describe("coach tool answers", () => {
  it("list dives with the Python version's names and values", () => {
    const listed = listDives(records);
    const keys = ["seq", "start", "site", "max_depth_m", "duration_min", "rmv_l_min", "sac_bar_min", "max_ascent_rate_m_min", "safety_stop_s", "had_deco", "gases", "score", "finding_titles"];
    const pick = (d: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, d[k]]));
    expect(listed.map(pick)).toEqual(golden.dives.map(pick));
    expect(listed.every((d) => d.has_review === false && /^[0-9a-f]{24}$/.test(d.id))).toBe(true);
  });

  it("gives the same trends under the Python version's metric names", () => {
    for (const [name, expected] of Object.entries(golden.trends)) {
      expect(progressTrend(records, name), name).toEqual(expected ?? { error: "Need at least 3 dives with this metric" });
    }
    expect(progressTrend(records, "nope")).toEqual({ error: expect.stringContaining("rmv_l_min") });
    expect(Object.keys(METRIC_NAMES)).toContain("max_ascent_rate_m_min");
  });

  it("finds dives by their number in the log or by their id", () => {
    const last = records.length;
    expect(resolveDive(records, 1).seq).toBe(1);
    expect(resolveDive(records, `#${last}`).seq).toBe(last);
    const { record } = resolveDive(records, 3);
    expect(resolveDive(records, record.id).seq).toBe(3);
    expect(resolveDive(records, record.id.slice(0, 8)).record.id).toBe(record.id);
    expect(() => resolveDive(records, 0)).toThrow(DiveRefError);
    expect(() => resolveDive(records, 99)).toThrow(/the log has 9 dives/);
    expect(() => resolveDive(records, "abc")).toThrow(/No dive with id/);
    const twins = [record, { ...record, id: `${record.id.slice(0, 8)}ffffffffffffffff` }];
    expect(() => resolveDive(twins, record.id.slice(0, 8))).toThrow(/More than one/);
  });

  it("describes one dive, with what the diver filled in", () => {
    const { record, seq } = resolveDive(records, 9);
    const answer = diveAnalysis({ ...record, details: { buddy: "Ola", tankVolumeL: 15 } }, seq);
    expect(answer).toMatchObject({ seq: 9, buddy: "Ola", filled_in_by_diver: ["buddy", "tank_volume_l"] });
    expect(answer.tanks[0].volume_l).toBe(15);
    expect(answer.metrics).toHaveProperty("rmv_l_min");
    expect(answer.findings[0]).toHaveProperty("severity");
  });

  it("downsamples the profile like the Python version", () => {
    const points = diveProfile(records[0], 60);
    expect(points[0]).toMatchObject({ t_min: 0, depth_m: 0 });
    expect(points.length).toBeGreaterThan(10);
    expect(points.every((p, i) => i === 0 || (p.t_min as number) > (points[i - 1].t_min as number))).toBe(true);
    expect(diveProfile(records[0], 1).length).toBeGreaterThan(points.length); // at least 10 s apart
  });

  it("sums up the log and what is still missing", () => {
    const text = overview(records, "/data");
    expect(text).toMatch(/^Dive log: 9 dives, from 2026-03-14 to /);
    expect(text).toContain("Gas consumption (RMV, L/min) improving");
    expect(text).toContain("No debrief yet.");
    expect(overview([], "/data")).toContain("The dive log is empty (data folder: /data)");
  });

  it("names keys like the Python version", () => {
    expect(["rmvLMin", "maxAscentRateMMin", "maxPpo2", "minNdlMin", "uddfId"].map(snake)).toEqual([
      "rmv_l_min", "max_ascent_rate_m_min", "max_ppo2", "min_ndl_min", "uddf_id",
    ]);
    expect(snakeKeys([{ earlyAvg: 1, nested: { slopePerDive: 2 } }])).toEqual([{ early_avg: 1, nested: { slope_per_dive: 2 } }]);
  });
});

describe("tripCardUrl", () => {
  it("opens a dive card's preparation in the app", () => {
    expect(tripCardUrl("dahab-2027", "c1")).toBe("http://localhost:3001/trips/dahab-2027#card-c1");
    expect(tripCardUrl("a b", "x#y")).toBe("http://localhost:3001/trips/a%20b#card-x%23y");
  });
});
