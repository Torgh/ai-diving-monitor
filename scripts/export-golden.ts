/**
 * Rewrites fixtures/golden/ from the TypeScript version: what it parses and computes for every test
 * file. The files were written by the Python version (tag v0.1-python) and lib/golden.test.ts holds
 * the port to them; run this only after changing parsing or analysis on purpose, and check the diff.
 *
 *   bun run golden                          # rewrite fixtures/golden/
 *   bun scripts/export-golden.ts some/dir   # write somewhere else, to compare
 */
import fs from "node:fs";
import path from "node:path";
import { analyzeDive, type HistoryEntry, progressInsights, PROGRESS_METRICS, type ProgressMetric, trend } from "../lib/analysis";
import { fingerprint } from "../lib/dive";
import { PARSER_VERSION, parseUddf } from "../lib/uddf";

const ROOT = path.resolve(import.meta.dirname, "..");
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "fixtures", "golden"));

const uddfIn = (dir: string) =>
  fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".uddf")).sort().map((f) => `${dir}/${f}`);
const examples = uddfIn("examples");
const inputs = [...examples, ...uddfIn("fixtures/uddf")];

/** The files keep the Python version's snake_case names; gas mixes stay keyed by their ids. */
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function snakeize(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => snakeize(v));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [parentKey === "gasMixes" ? k : snake(k), snakeize(v, k)]),
  );
}

const parse = (source: string) => parseUddf(fs.readFileSync(path.join(ROOT, source)));
const files: Record<string, unknown> = {};

for (const source of inputs) {
  files[`${path.basename(source, ".uddf")}.json`] = {
    source,
    parser_version: PARSER_VERSION,
    dives: parse(source).map((dive) => ({ fingerprint: fingerprint(dive), dive: snakeize(dive), analysis: snakeize(analyzeDive(dive)) })),
  };
}

// The sample log as a whole, ordered by start time (by code point), then by import order.
const log = examples
  .flatMap(parse)
  .map((dive, order) => ({ dive, order }))
  .sort((a, b) => {
    const [x, y] = [a.dive.start ?? "", b.dive.start ?? ""];
    return (x < y ? -1 : x > y ? 1 : 0) || a.order - b.order;
  })
  .map(({ dive }) => dive);
const history: HistoryEntry[] = log.map((dive) => {
  const { metrics, findings } = analyzeDive(dive);
  return { ...metrics, findingTitles: findings.map((f) => f.title) };
});
files["history.json"] = {
  sources: examples,
  dives: history.map((entry, i) => snakeize({ start: log[i].start, ...entry })),
  trends: Object.fromEntries(
    (Object.keys(PROGRESS_METRICS) as ProgressMetric[]).map((metric) => {
      const t = trend(history, metric);
      return [snake(metric), t && snakeize({ ...t, metric: snake(metric) })];
    }),
  ),
  insights: progressInsights(history),
};

fs.mkdirSync(out, { recursive: true });
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(out, name), `${JSON.stringify(data, null, 1)}\n`);
  console.log(path.relative(ROOT, path.join(out, name)).replaceAll("\\", "/"));
}
