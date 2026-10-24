import { describe, expect, it } from "vitest";
import { analyzeDive, ascentRateSeries, cnsRatePerMin, countSawtooth, type HistoryEntry, progressInsights, trend } from "./analysis";
import type { Dive } from "./dive";

const ramp = (t0: number, t1: number, d0: number, d1: number, step = 10): [number, number][] => {
  const out: [number, number][] = [];
  for (let t = t0; t <= t1; t += step) out.push([t, d0 + ((d1 - d0) * (t - t0)) / (t1 - t0)]);
  return out;
};

function makeDive(points: [number, number][], o2 = 0.21): Dive {
  return {
    uddfId: "x",
    number: 1,
    start: null,
    site: null,
    location: null,
    maxDepthM: Math.max(...points.map(([, d]) => d)),
    durationS: points[points.length - 1][0],
    minTempC: null,
    notes: null,
    computer: null,
    gasMixes: { m: { id: "m", name: "gas", o2, he: 0 } },
    tanks: [{ id: "t", mixId: "m", volumeL: 12, startBar: 200, endBar: 80 }],
    samples: points.map(([timeS, depthM]) => ({
      timeS, depthM, tempC: null, pressureBar: null, tankRef: null, mixRef: null,
      ppo2: null, cns: null, ndlS: null, decoDepthM: null, alarms: [],
    })),
  };
}

describe("analyzeDive", () => {
  it("finds no problems on a calm dive with a safety stop", () => {
    const pts = [...ramp(0, 120, 0, 20), ...ramp(130, 1800, 20, 20), ...ramp(1810, 1900, 20, 5), ...ramp(1910, 2100, 5, 5), ...ramp(2110, 2140, 5, 0)];
    const { metrics, findings } = analyzeDive(makeDive(pts));
    expect(metrics.maxAscentRateMMin).toBeLessThanOrEqual(10.5);
    expect(metrics.safetyStopS).toBeGreaterThanOrEqual(180);
    expect(findings.filter((f) => f.severity === "critical" || f.severity === "warning")).toEqual([]);
    expect(metrics.score).toBe(100);
  });

  it("handles a dive without samples", () => {
    const dive = { ...makeDive([[0, 0]]), samples: [], maxDepthM: 2, durationS: 60 };
    const { metrics } = analyzeDive(dive);
    expect(metrics.avgDepthM).toBe(1);
    expect(metrics.maxAscentRateMMin).toBe(0);
    expect(metrics.gases).toEqual(["Air"]);
    expect(ascentRateSeries(dive)).toEqual([]);
  });

  it("uses the CNS clock of the NOAA table", () => {
    expect(cnsRatePerMin(0.4)).toBe(0);
    expect(cnsRatePerMin(0.55)).toBeCloseTo(100 / 720);
    expect(cnsRatePerMin(1.4)).toBeCloseTo(100 / 150);
    expect(cnsRatePerMin(1.8)).toBeCloseTo(100 / 5);
  });

  it("counts sawtooth re-descents", () => {
    expect(countSawtooth([])).toBe(0);
    expect(countSawtooth([0, 20, 15, 20, 15, 20, 0])).toBe(2);
  });
});

describe("progress", () => {
  it("sees improving gas consumption", () => {
    const history: HistoryEntry[] = [24, 23, 21, 19, 17, 16].map((rmvLMin) => ({ rmvLMin, findingTitles: [] }));
    expect(trend(history, "rmvLMin")?.verdict).toBe("improving");
    expect(progressInsights(history).some((f) => f.title.startsWith("Gas consumption") && f.severity === "good")).toBe(true);
  });

  it("needs at least three dives", () => {
    expect(progressInsights([{}])[0].title).toBe("Not enough history yet");
    expect(trend([{ score: 90 }, { score: 80 }], "score")).toBeNull();
  });

  it("prints whole-number averages like Python and flags recurring issues", () => {
    const history: HistoryEntry[] = [100, 100, 80, 70].map((score) => ({ score, findingTitles: ["Sawtooth profile"] }));
    const [scoreNote, recurring] = progressInsights(history);
    expect(scoreNote.detail).toBe("Average went from 100 to 75 (-25.0%) across 4 logged dives.");
    expect(recurring.title).toBe("Recurring issue: Sawtooth profile");
  });

  it("calls a log without changes consistent", () => {
    const history: HistoryEntry[] = [1, 2, 3].map(() => ({ rmvLMin: 18, score: 90, findingTitles: ["Safety stop done"] }));
    expect(progressInsights(history)).toEqual([
      { severity: "info", title: "Consistent performance", detail: "Your key metrics are stable across your logged dives." },
    ]);
  });
});
