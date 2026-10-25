/**
 * Getting ready for a planned dive (a dive card of a TripDeck trip) from the diver's own log: how
 * much comparable experience there is, how recent it is, what gas the dive will take, and which
 * problems keep coming back. Numbers only; the coach turns them into advice. Not a dive planner.
 */

import { ambientBar, PPO2_DECO_LIMIT, PPO2_WORK_LIMIT, type Severity, SEVERITY_ORDER, SURFACE_BAR } from "./analysis";
import { pyRound } from "./py";
import { analyzeRecord, chronological, type DiveRecord, effectiveDive, parseGas } from "./record";

/** A dive as TripDeck plans it; every field is optional, as on the card. */
export interface PlannedDive {
  site?: string;
  location?: string;
  maxDepthM?: number;
  /** "air", "nitrox", "trimix" (TripDeck's choices) or a mix: "EAN32", "Tx 18/45". */
  gas?: string;
  /** Dives in the outing, e.g. 2 for a two-tank boat trip. */
  dives?: number;
  /** "YYYY-MM-DD". */
  date?: string;
}

export type GasFamily = "air" | "nitrox" | "trimix" | "oxygen";

export interface PlannedGas {
  family: GasFamily;
  /** Fractions, when the mix is known ("EAN32"), not only its kind ("nitrox"). */
  o2: number | null;
  he: number | null;
}

/** A logged dive, as the preparation shows it. */
export interface LoggedDiveRow {
  seq: number;
  id: string;
  date: string | null;
  site: string | null;
  maxDepthM: number;
  durationMin: number;
  gases: string[];
  rmvLMin: number | null;
  maxAscentRateMMin: number;
  safetyStopS: number;
  score: number;
  issues: string[];
}

export interface DivePrep {
  plan: PlannedDive;
  gas: PlannedGas | null;
  /** Everything below counts the dives logged before the day of the planned dive (undated ones too). */
  experience: {
    dives: number;
    deepestM: number | null;
    /** Dives that went at least as deep as planned, less 3 m. */
    divesNearPlannedDepth: number;
    deeperThanEver: boolean;
    /** Dives on the same kind of gas (air, nitrox, trimix, oxygen). */
    divesWithThisGas: number;
    divesWithDeco: number;
    lastDive: { seq: number; date: string | null; site: string | null } | null;
    /** Days from the last logged dive to the planned date (or today). */
    daysSinceLastDive: number | null;
    divesInLast12Months: number;
  };
  /** Logged dives at a site of the same name. */
  atThisSite: LoggedDiveRow[];
  /** Up to 5: this site first, then the closest in depth, newest first. */
  comparable: LoggedDiveRow[];
  gasPlan: {
    /** Median surface RMV of the last 10 dives that have one. */
    rmvLMin: number | null;
    rmvDives: number;
    /** Litres a minute at the planned maximum depth, at that RMV. */
    consumptionAtMaxDepthLMin: number | null;
    ppo2AtMaxDepth: number | null;
    /** Maximum operating depth of the mix at ppO2 1.4 bar. */
    modM: number | null;
    /** The richest nitrox that stays at or under ppO2 1.4 bar at the planned depth (21–40 %). */
    bestNitroxPercent: number | null;
    /** Equivalent narcotic depth of a trimix at the planned depth (oxygen counted as narcotic). */
    endM: number | null;
  };
  /** Problems found on at least 2 of the last 10 dives. */
  recurringIssues: { title: string; severity: Severity; dives: number; of: number }[];
  /** Plain-language points worth raising, most important first. */
  notes: string[];
}

const DAY_MS = 86_400_000;
/** Many agencies suggest a refresher after this long without diving. */
export const REFRESHER_DAYS = 180;
/** Air below this depth: narcosis is worth a word. */
const NARCOSIS_DEPTH_M = 30;
const NEAR_DEPTH_M = 3;

/** "Blue Hole, Dahab" and "blue hole" are the same site; accents and punctuation don't count. */
export function normalizeSite(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function sameSite(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const [x, y] = [normalizeSite(a), normalizeSite(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  // "Blue Hole" matches "Blue Hole Dahab"; short names must match whole.
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

export function plannedGas(text: string | undefined): PlannedGas | null {
  const t = text?.trim().toLowerCase();
  if (!t) return null;
  if (t === "nitrox" || t === "ean" || t === "eanx") return { family: "nitrox", o2: null, he: null };
  if (t === "trimix" || t === "tx") return { family: "trimix", o2: null, he: null };
  const mix = parseGas(t);
  if (!mix) return null;
  const family: GasFamily = mix.he > 0 ? "trimix" : mix.o2 >= 0.99 ? "oxygen" : mix.o2 > 0.22 ? "nitrox" : "air";
  return { family, o2: mix.o2, he: mix.he };
}

/** The family of a gas label written by gasLabel(): "Air", "EAN32", "Tx 18/45", "Oxygen". */
function familyOfLabel(label: string): GasFamily | null {
  if (/^air$/i.test(label)) return "air";
  if (/^ean/i.test(label)) return "nitrox";
  if (/^tx|^trimix|^heliox/i.test(label)) return "trimix";
  if (/^oxygen$/i.test(label)) return "oxygen";
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const isProblem = (f: { severity: Severity }) => f.severity === "critical" || f.severity === "warning";
const isDate = (text: string | undefined): text is string => !!text && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));
const dateOf = (start: string | null) => (start ? start.slice(0, 10) : null);

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / DAY_MS);
}

/** The note on the problems that keep coming back (the same for every dive of a trip). */
export function recurringNote(recurring: DivePrep["recurringIssues"]): string {
  return `Keeps coming back: ${recurring.map((r) => `${r.title} (${r.dives} of the last ${r.of} dives)`).join("; ")}.`;
}

export function prepareDive(records: DiveRecord[], plan: PlannedDive, today = new Date()): DivePrep {
  const on = isDate(plan.date) ? plan.date : today.toISOString().slice(0, 10);
  // What the diver had done before the day of the dive, also when the plan is read after the trip.
  const all = chronological(records).map((record, i) => {
    const dive = effectiveDive(record);
    const { metrics, findings } = analyzeRecord(record);
    const row: LoggedDiveRow = {
      seq: i + 1,
      id: record.id,
      date: dateOf(dive.start),
      site: dive.site,
      maxDepthM: metrics.maxDepthM,
      durationMin: metrics.durationMin,
      gases: metrics.gases,
      rmvLMin: metrics.rmvLMin,
      maxAscentRateMMin: metrics.maxAscentRateMMin,
      safetyStopS: metrics.safetyStopS,
      score: metrics.score,
      issues: findings.filter(isProblem).map((f) => f.title),
    };
    return { row, metrics, findings };
  });
  const log = all.filter((d) => d.row.date === null || d.row.date < on);

  const depth = plan.maxDepthM && plan.maxDepthM > 0 ? plan.maxDepthM : null;
  const gas = plannedGas(plan.gas);

  const deepest = log.length ? Math.max(...log.map((d) => d.metrics.maxDepthM)) : null;
  const last = log.at(-1);
  const lastDate = last?.row.date ?? null;
  const daysSince = lastDate ? daysBetween(lastDate, on) : null;
  const yearAgo = new Date(Date.parse(`${on}T00:00:00Z`) - 365 * DAY_MS).toISOString().slice(0, 10);

  const atSite = plan.site ? log.filter((d) => sameSite(d.row.site, plan.site)) : [];
  const atSiteIds = new Set(atSite.map((d) => d.row.id));
  const comparable = [...log]
    .sort(
      (a, b) =>
        Number(atSiteIds.has(b.row.id)) - Number(atSiteIds.has(a.row.id)) ||
        (depth === null ? 0 : Math.abs(a.metrics.maxDepthM - depth) - Math.abs(b.metrics.maxDepthM - depth)) ||
        b.row.seq - a.row.seq,
    )
    .slice(0, 5);

  const withRmv = log.filter((d) => d.metrics.rmvLMin !== null).slice(-10);
  const rmv = median(withRmv.map((d) => d.metrics.rmvLMin!));
  const bar = depth === null ? null : ambientBar(depth);
  const rawPpo2 = bar !== null && gas?.o2 != null ? gas.o2 * bar : null;
  const ppo2 = rawPpo2 === null ? null : pyRound(rawPpo2, 2);
  const mod = gas?.o2 ? pyRound((PPO2_WORK_LIMIT / gas.o2 - 1) * 10, 1) : null;
  const bestNitrox = bar === null ? null : Math.min(40, Math.floor((PPO2_WORK_LIMIT / bar) * 100));
  const end = bar !== null && gas?.he ? pyRound(Math.max(0, (bar * (1 - gas.he) - 1) * 10), 1) : null;

  const recent = log.slice(-10);
  const counts = new Map<string, { severity: Severity; dives: number }>();
  for (const d of recent) {
    for (const f of d.findings) {
      if (!isProblem(f)) continue;
      const seen = counts.get(f.title);
      counts.set(f.title, { severity: seen?.severity ?? f.severity, dives: (seen?.dives ?? 0) + 1 });
    }
  }
  const recurring = [...counts.entries()]
    .filter(([, c]) => c.dives >= 2)
    .map(([title, c]) => ({ title, severity: c.severity, dives: c.dives, of: recent.length }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.dives - a.dives);

  const withGas = gas ? log.filter((d) => d.metrics.gases.some((g) => familyOfLabel(g) === gas.family)).length : 0;
  const nearDepth = depth === null ? 0 : log.filter((d) => d.metrics.maxDepthM >= depth - NEAR_DEPTH_M).length;

  const notes: string[] = [];
  if (!log.length) notes.push("The dive log is empty: there is no history to prepare from. Import the diver's dives first.");
  if (rawPpo2 !== null && rawPpo2 > PPO2_DECO_LIMIT)
    notes.push(`ppO2 ${ppo2} bar at ${depth} m is over ${PPO2_DECO_LIMIT} bar: this gas is not safe at that depth (MOD ${mod} m at ${PPO2_WORK_LIMIT} bar).`);
  else if (rawPpo2 !== null && rawPpo2 > PPO2_WORK_LIMIT)
    notes.push(`ppO2 ${ppo2} bar at ${depth} m is over ${PPO2_WORK_LIMIT} bar for the bottom phase (MOD ${mod} m).`);
  if (depth !== null && deepest !== null && depth > deepest)
    notes.push(`Deeper than the diver has logged: ${depth} m planned, deepest so far ${deepest} m.`);
  if (daysSince !== null && daysSince > REFRESHER_DAYS)
    notes.push(`${daysSince} days since the last logged dive: worth a refresher or an easy check-out dive first.`);
  if (gas && gas.o2 === null)
    notes.push(`The ${gas.family} mix isn't known yet: ask which mix, to check ppO2 and MOD${gas.family === "nitrox" && bestNitrox !== null ? ` (EAN${bestNitrox} is the richest nitrox for ${depth} m)` : ""}.`);
  if (gas && log.length && withGas === 0) notes.push(`No logged dives on ${gas.family} yet.`);
  if (gas?.family === "air" && depth !== null && depth > NARCOSIS_DEPTH_M)
    notes.push(`Air at ${depth} m: expect narcosis (END ${pyRound(depth, 1)} m).`);
  if (end !== null && end > NARCOSIS_DEPTH_M) notes.push(`END ${end} m at ${depth} m: narcosis is worth planning for.`);
  if (log.length && rmv === null) notes.push("No gas consumption in the log: fill in tank volumes (update_dive) to plan gas from the diver's RMV.");
  if ((plan.dives ?? 1) >= 2) notes.push(`${plan.dives} dives in this outing: plan the surface interval and the second dive shallower than the first.`);
  if (recurring.length) notes.push(recurringNote(recurring));
  if (plan.site && log.length && !atSite.length) notes.push(`First dive at ${plan.site} in the log.`);

  return {
    plan,
    gas,
    experience: {
      dives: log.length,
      deepestM: deepest,
      divesNearPlannedDepth: nearDepth,
      deeperThanEver: depth !== null && deepest !== null && depth > deepest,
      divesWithThisGas: withGas,
      divesWithDeco: log.filter((d) => d.metrics.hadDeco).length,
      lastDive: last ? { seq: last.row.seq, date: lastDate, site: last.row.site } : null,
      daysSinceLastDive: daysSince,
      divesInLast12Months: log.filter((d) => d.row.date !== null && d.row.date > yearAgo).length,
    },
    atThisSite: atSite.map((d) => d.row),
    comparable: comparable.map((d) => d.row),
    gasPlan: {
      rmvLMin: rmv === null ? null : pyRound(rmv, 1),
      rmvDives: withRmv.length,
      consumptionAtMaxDepthLMin: rmv !== null && bar !== null ? pyRound((rmv * bar) / SURFACE_BAR, 1) : null,
      ppo2AtMaxDepth: ppo2,
      modM: mod,
      bestNitroxPercent: bestNitrox === null ? null : Math.max(21, bestNitrox),
      endM: end,
    },
    recurringIssues: recurring,
    notes,
  };
}
