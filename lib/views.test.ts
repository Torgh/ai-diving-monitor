import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "./dive";
import { type DiveRecord, RECORD_FORMAT } from "./record";
import { parseUddf } from "./uddf";
import { diveView, logView } from "./views";

const ROOT = path.resolve(__dirname, "..");
const records = (...files: string[]): DiveRecord[] =>
  files.flatMap((file, f) =>
    parseUddf(readFileSync(path.join(ROOT, file))).map((dive, i) => ({
      format: RECORD_FORMAT,
      version: 1,
      id: fingerprint(dive),
      importedAt: `2026-10-24T10:0${f}:0${i}.000Z`,
      updatedAt: "2026-10-24T10:00:00.000Z",
      source: { fileName: file, sha256: "0".repeat(64), uddfId: dive.uddfId },
      parserVersion: 2,
      dive,
      details: {},
      review: null,
    })),
  );

const sample = records("examples/spring-2026.uddf", "examples/summer-2026.uddf");

describe("logView", () => {
  it("sums up the log", () => {
    const view = logView(sample);
    expect(view.dives.map((d) => d.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(view.totals.dives).toBe(9);
    expect(view.totals.deepestM).toBe(Math.max(...view.dives.map((d) => d.maxDepthM)));
    expect(view.totals.latestScore).toBe(view.dives[8].score);
    expect(view.todos.find((t) => t.kind === "review")?.seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("charts progress with a trend line", () => {
    const rmv = logView(sample).progress.find((p) => p.metric === "rmvLMin")!;
    expect(rmv.points).toHaveLength(9);
    expect(rmv.trend?.verdict).toBe("improving");
    expect(rmv.fit![1].value).toBeLessThan(rmv.fit![0].value);
  });

  it("handles an empty log", () => {
    const view = logView([]);
    expect(view.totals).toEqual({ dives: 0, minutes: 0, deepestM: null, latestScore: null });
    expect(view.progress.every((p) => p.points.length === 0 && p.fit === null)).toBe(true);
  });
});

describe("diveView", () => {
  it("shows a dive with its neighbours, averages and profile", () => {
    const log = logView(sample).dives;
    const view = diveView(sample, log[4].id)!;
    expect(view).toMatchObject({ seq: 5, total: 9, prevId: log[3].id, nextId: log[5].id });
    expect(view.profile.length).toBeGreaterThan(50);
    expect(view.profile[0]).toMatchObject({ tMin: 0 });
    expect(view.averages.maxDepthM).toBeGreaterThan(0);
    expect("samples" in view.dive).toBe(false);
    expect(diveView(sample, "nope")).toBeNull();
  });

  it("marks gas switches, deco stops and fast ascents", () => {
    const edge = records("fixtures/uddf/edge-cases.uddf");
    const deco = diveView(edge, edge[0].id)!;
    expect(deco.gasSwitches.map((g) => g.gas)).toEqual(["EAN50", "Oxygen"]);
    expect(deco.profile.some((p) => p.ceilingM === 21)).toBe(true);
    expect(deco.profile.some((p) => p.ppo2 !== null && p.ppo2 > 1.6)).toBe(true);
    const rocket = diveView(edge, edge[1].id)!;
    expect(rocket.fastAscents.length).toBeGreaterThan(0);
    expect(rocket.fastAscents.every((a) => a.toMin > a.fromMin)).toBe(true);
  });
});
