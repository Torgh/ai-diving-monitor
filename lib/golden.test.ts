/**
 * The TypeScript port against the Python version: every test file must parse and analyse to the
 * same numbers and texts as in fixtures/golden/ (written by scripts/export_golden.py).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDive, type HistoryEntry, progressInsights, PROGRESS_METRICS, type ProgressMetric, trend } from "./analysis";
import { fingerprint } from "./dive";
import { parseUddf } from "./uddf";

const ROOT = path.resolve(__dirname, "..");
const GOLDEN = path.join(ROOT, "fixtures", "golden");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Python's snake_case field names as the port's camelCase; gas mixes stay keyed by their ids. */
function camelize(value: Json, parentKey = ""): Json {
  if (Array.isArray(value)) return value.map((v) => camelize(v));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [parentKey === "gas_mixes" ? k : camel(k), camelize(v, k)]),
  );
}

/** Python compares strings by code point, not by locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const read = (name: string) => JSON.parse(readFileSync(path.join(GOLDEN, name), "utf-8"));
const goldenFiles = readdirSync(GOLDEN).filter((f) => f.endsWith(".json") && f !== "history.json");

describe("golden fixtures from the Python version", () => {
  it("covers every input file", () => {
    expect(goldenFiles.sort()).toEqual(["edge-cases.json", "shearwater-style.json", "spring-2026.json", "summer-2026.json"]);
  });

  describe.each(goldenFiles)("%s", (file) => {
    const golden = read(file);
    const dives = parseUddf(readFileSync(path.join(ROOT, golden.source)));

    it("parses the same dives", () => {
      expect(dives).toHaveLength(golden.dives.length);
      dives.forEach((dive, i) => expect(dive).toEqual(camelize(golden.dives[i].dive)));
    });

    it("computes the same fingerprints", () => {
      expect(dives.map(fingerprint)).toEqual(golden.dives.map((d: { fingerprint: string }) => d.fingerprint));
    });

    it("computes the same metrics, findings and score", () => {
      dives.forEach((dive, i) => expect(analyzeDive(dive)).toEqual(camelize(golden.dives[i].analysis)));
    });
  });

  describe("the sample log as a whole", () => {
    const golden = read("history.json");
    // The dive log is ordered by start time, then by import order.
    const dives = (golden.sources as string[])
      .flatMap((source) => parseUddf(readFileSync(path.join(ROOT, source))))
      .map((dive, order) => ({ dive, order }))
      .sort((a, b) => compare(a.dive.start ?? "", b.dive.start ?? "") || a.order - b.order)
      .map(({ dive }) => dive);
    const history: HistoryEntry[] = dives.map((dive) => {
      const { metrics, findings } = analyzeDive(dive);
      return { ...metrics, findingTitles: findings.map((f) => f.title) };
    });

    it("lists the same dives in the same order", () => {
      // Without the fields the database adds (stage 3 of the roadmap).
      const expected = golden.dives.map((d: Record<string, Json>) => {
        const { id: _id, seq: _seq, start: _start, site: _site, worst_severity: _worst, has_summary: _summary, ...rest } = d;
        return camelize(rest);
      });
      expect(history).toEqual(expected);
      expect(dives.map((d) => d.start)).toEqual(golden.dives.map((d: { start: string }) => d.start));
    });

    it.each(Object.keys(golden.trends))("has the same trend for %s", (metric) => {
      const expected = golden.trends[metric] && { ...(camelize(golden.trends[metric]) as object), metric: camel(metric) };
      expect(trend(history, camel(metric) as ProgressMetric)).toEqual(expected);
    });

    it("covers every progress metric", () => {
      expect(Object.keys(golden.trends).map(camel).sort()).toEqual(Object.keys(PROGRESS_METRICS).sort());
    });

    it("writes the same progress insights", () => {
      expect(progressInsights(history)).toEqual(golden.insights);
    });
  });
});
