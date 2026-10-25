/**
 * What the web app shows, computed from the dive records: the log with its totals, trends and
 * "to sort out" list, and one dive with its profile. Pure, so the phone app can reuse it later.
 */

import {
  ASCENT_WARN_M_MIN,
  ascentRateSeries,
  type DiveMetrics,
  type Finding,
  ppo2Series,
  progressInsights,
  PROGRESS_METRICS,
  type ProgressMetric,
  type Severity,
  trend,
  type Trend,
} from "./analysis";
import { history } from "./coach";
import { type Dive, gasLabel } from "./dive";
import { analyzeRecord, chronological, type DiveDetails, type DiveRecord, effectiveDive, logTodos, type Review, type Todo } from "./record";

export interface DiveRow {
  id: string;
  seq: number;
  start: string | null;
  site: string | null;
  maxDepthM: number;
  durationMin: number;
  rmvLMin: number | null;
  maxAscentRateMMin: number;
  safetyStopS: number;
  score: number;
  gases: string[];
  findingTitles: string[];
  worstSeverity: Severity;
  hasReview: boolean;
  /** The depth profile in a few points, for a thumbnail. */
  sparkline: number[];
}

/** A metric over the dives in the log, for a progress chart. */
export interface ProgressSeries {
  metric: ProgressMetric;
  label: string;
  better: "lower" | "higher" | "neutral";
  points: { seq: number; start: string | null; value: number }[];
  trend: Trend | null;
  /** The least-squares line through the points, at the first and the last point. */
  fit: [{ seq: number; value: number }, { seq: number; value: number }] | null;
}

export interface LogView {
  dives: DiveRow[];
  totals: { dives: number; minutes: number; deepestM: number | null; latestScore: number | null };
  todos: (Todo & { seqs: number[] })[];
  insights: Finding[];
  progress: ProgressSeries[];
}

/**
 * The profile squeezed into `points` equal stretches of time, keeping the deepest depth of each, so a
 * thumbnail still shows the bottom and the stops. Starts and ends at the surface.
 */
export function sparkline(samples: { timeS: number; depthM: number }[], points = 40): number[] {
  if (!samples.length) return [];
  const end = samples[samples.length - 1].timeS || 1;
  const deepest = new Array<number>(points).fill(-1);
  for (const s of samples) {
    const i = Math.min(points - 1, Math.floor((s.timeS / end) * points));
    deepest[i] = Math.max(deepest[i], s.depthM);
  }
  // A stretch without samples takes the depth before it.
  for (let i = 0; i < points; i++) if (deepest[i] < 0) deepest[i] = i ? deepest[i - 1] : 0;
  return [0, ...deepest.map((d) => Math.round(d * 10) / 10), 0];
}

const CHARTED: ProgressMetric[] = ["rmvLMin", "maxAscentRateMMin", "safetyStopS", "score"];

function leastSquares(points: { seq: number; value: number }[]): ProgressSeries["fit"] {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.seq, 0) / n;
  const my = points.reduce((s, p) => s + p.value, 0) / n;
  const den = points.reduce((s, p) => s + (p.seq - mx) ** 2, 0);
  const slope = den ? points.reduce((s, p) => s + (p.seq - mx) * (p.value - my), 0) / den : 0;
  const at = (seq: number) => ({ seq, value: my + slope * (seq - mx) });
  return [at(points[0].seq), at(points[n - 1].seq)];
}

export function logView(records: DiveRecord[]): LogView {
  const log = chronological(records);
  const analyses = log.map(analyzeRecord);
  const dives: DiveRow[] = log.map((r, i) => {
    const dive = effectiveDive(r);
    const { metrics: m, findings } = analyses[i];
    return {
      id: r.id,
      seq: i + 1,
      start: dive.start,
      site: dive.site,
      maxDepthM: m.maxDepthM,
      durationMin: m.durationMin,
      rmvLMin: m.rmvLMin,
      maxAscentRateMMin: m.maxAscentRateMMin,
      safetyStopS: m.safetyStopS,
      score: m.score,
      gases: m.gases,
      findingTitles: findings.map((f) => f.title),
      worstSeverity: findings[0]?.severity ?? "good",
      hasReview: r.review !== null,
      sparkline: sparkline(dive.samples),
    };
  });
  const seqOf = new Map(dives.map((d) => [d.id, d.seq]));
  const h = history(log);
  const progress = CHARTED.map((metric): ProgressSeries => {
    const points = dives.flatMap((d, i) => {
      const value = analyses[i].metrics[metric];
      return value === null ? [] : [{ seq: d.seq, start: d.start, value }];
    });
    const { label, better } = PROGRESS_METRICS[metric];
    return { metric, label, better, points, trend: trend(h, metric), fit: leastSquares(points) };
  });
  return {
    dives,
    totals: {
      dives: dives.length,
      minutes: dives.reduce((s, d) => s + d.durationMin, 0),
      deepestM: dives.length ? Math.max(...dives.map((d) => d.maxDepthM)) : null,
      latestScore: dives.length ? dives[dives.length - 1].score : null,
    },
    todos: logTodos(log).map((t) => ({ ...t, seqs: t.dives.map((id) => seqOf.get(id)!) })),
    insights: progressInsights(h),
    progress,
  };
}

/** One point of the profile charts, per sample. */
export interface ProfilePoint {
  tMin: number;
  depthM: number;
  /** The required deco stop depth, when the computer reports one. */
  ceilingM: number | null;
  tankBar: number | null;
  ppo2: number | null;
  tempC: number | null;
  /** Ascent rate over the trailing 30 s, m/min (positive = up). */
  ascentMMin: number;
}

export interface DiveView {
  id: string;
  seq: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
  dive: Omit<Dive, "samples">;
  details: DiveDetails;
  review: Review | null;
  metrics: DiveMetrics;
  findings: Finding[];
  /** The diver's average over the other dives, for comparison. */
  averages: Partial<Record<keyof DiveMetrics, number>>;
  tanks: { volumeL: number | null; startBar: number | null; endBar: number | null; gas: string | null }[];
  profile: ProfilePoint[];
  gasSwitches: { tMin: number; gas: string }[];
  /** Stretches ascending faster than the recommended rate. */
  fastAscents: { fromMin: number; toMin: number }[];
  source: DiveRecord["source"];
  importedAt: string;
}

const COMPARED: (keyof DiveMetrics)[] = ["maxDepthM", "durationMin", "rmvLMin", "maxAscentRateMMin", "safetyStopS", "endPressureBar", "cnsPercent", "score"];

export function diveView(records: DiveRecord[], id: string): DiveView | null {
  const log = chronological(records);
  const index = log.findIndex((r) => r.id === id);
  if (index < 0) return null;
  const record = log[index];
  const dive = effectiveDive(record);
  const { metrics, findings } = analyzeRecord(record);

  const others = log.filter((r) => r.id !== id).map((r) => analyzeRecord(r).metrics);
  const averages: DiveView["averages"] = {};
  for (const key of COMPARED) {
    const values = others.map((m) => m[key]).filter((v): v is number => typeof v === "number");
    if (values.length) averages[key] = values.reduce((s, v) => s + v, 0) / values.length;
  }

  const ppo2 = ppo2Series(dive);
  const rates = ascentRateSeries(dive);
  const profile = dive.samples.map((s, i) => ({
    tMin: s.timeS / 60,
    depthM: s.depthM,
    ceilingM: s.decoDepthM || null,
    tankBar: s.pressureBar,
    ppo2: ppo2[i],
    tempC: s.tempC,
    ascentMMin: rates[i][2],
  }));

  const fastAscents: DiveView["fastAscents"] = [];
  profile.forEach((p, i) => {
    if (i === 0 || p.ascentMMin <= ASCENT_WARN_M_MIN || p.depthM <= 0.5) return;
    const last = fastAscents[fastAscents.length - 1];
    if (last && last.toMin === profile[i - 1].tMin) last.toMin = p.tMin;
    else fastAscents.push({ fromMin: profile[i - 1].tMin, toMin: p.tMin });
  });

  const { samples, ...rest } = dive;
  const gasSwitches = samples.flatMap((s, i) =>
    i > 0 && s.mixRef && Object.hasOwn(dive.gasMixes, s.mixRef) ? [{ tMin: s.timeS / 60, gas: gasLabel(dive.gasMixes[s.mixRef]) }] : [],
  );
  return {
    id,
    seq: index + 1,
    total: log.length,
    prevId: index > 0 ? log[index - 1].id : null,
    nextId: index < log.length - 1 ? log[index + 1].id : null,
    dive: rest,
    details: record.details,
    review: record.review,
    metrics,
    findings,
    averages,
    tanks: dive.tanks.map((t) => ({
      volumeL: t.volumeL,
      startBar: t.startBar,
      endBar: t.endBar,
      gas: t.mixId && Object.hasOwn(dive.gasMixes, t.mixId) ? gasLabel(dive.gasMixes[t.mixId]) : null,
    })),
    profile,
    gasSwitches,
    fastAscents,
    source: record.source,
    importedAt: record.importedAt,
  };
}
