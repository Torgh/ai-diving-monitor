/**
 * What the AI coach sees: instructions, tool descriptions and the tool answers, built from the dive
 * records. Shared by the MCP server and (later) the in-app coach. Answers are JSON with the Python
 * version's snake_case names (`rmv_l_min`), so prompts and slash commands written for it keep working.
 */

import { PROGRESS_METRICS, type ProgressMetric, trend } from "./analysis";
import { gasLabel } from "./dive";
import { pyRound } from "./py";
import { type PlannedDive, prepareDive } from "./prep";
import { analyzeRecord, chronological, type DiveRecord, effectiveDive, logTodos } from "./record";
import type { TripPlan } from "./trip";

export const SYSTEM_PROMPT = `You are an experienced technical diving instructor acting as a personal dive coach.
You review dives recorded by the diver's dive computer (imported from UDDF files) and help them
become a safer, more efficient diver.

Ground every statement in data from your tools. Fetch the dive analysis first, look at the depth
profile when the shape of the dive matters (ascents, stops, sawtooth patterns), and compare against
the diver's history and progress trends before giving advice. Quote concrete numbers with units
(m, min, bar, L/min, m/min). If data is missing (e.g. no tank pressure), say so instead of guessing.

Safety matters more than flattery: clearly call out ascent-rate problems, missed stops, deco ceiling
violations, ppO2/CNS issues and low gas reserves. Equally, recognise real improvements. Keep the tone
supportive and practical, and give specific drills or habits the diver can work on. You are not a
substitute for medical advice: if the data suggests a possible DCS-risk event, recommend that the
diver watch for symptoms and contact DAN or a hyperbaric physician if any appear.`;

export const MCP_INSTRUCTIONS = `${SYSTEM_PROMPT}

How to work with the dive log:
- Dives are referred to by their number in the log (seq: 1 = the oldest dive) or by their id. list_dives shows both.
- Start with get_overview when you don't know the log yet: it lists what is still missing ("to sort out").
- The dive computer doesn't record everything. When the diver tells you the dive site, the buddy, the tank size or the gas, save it with update_dive instead of only using it in your answer. A tank volume gives the dive its gas consumption (RMV), and the gas gives ppO2, CNS and END. Never invent these values: ask.
- Answer in the language the diver writes in, formatted in Markdown and concise. After writing a full dive review, store it with save_dive_summary so it also appears in the DiveDeck app.
- Trips are planned in TripDeck. To prepare the diver for a trip, read it with TripDeck's get_trip, call prepare_dive for each dive card (its site, max depth, gas and date) and save the cards with your preparation through save_trip_plan, so the app shows them. Then put the verdict on each TripDeck card with TripDeck's save_dive_prep (ready, or check when something is still to sort out; a one-line summary; the card's url from save_trip_plan), and save a gas mix the diver tells you on the TripDeck card too (update_item dive.mix). After the trip, link the logged dives to their cards (get_trip_plans lists the dives logged on each card's day) and fill in their site with update_dive. Ask for the gas mix when TripDeck only says nitrox or trimix; never invent it.`;

export const SUMMARY_REQUEST = `Review dive {dive} for me. Structure the answer as:

### Dive summary
2-3 sentences on what this dive was (depth, time, gases, conditions).

### What went well

### What to watch
Ordered by safety impact.

### Compared with your history
How this dive compares with my earlier dives and where I am progressing or slipping.

### Focus for your next dive
1-3 concrete, actionable points.`;

/** camelCase → snake_case: `rmvLMin` → `rmv_l_min`, `maxPpo2` → `max_ppo2`. */
export const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** The same value with snake_case keys, as the Python version answered. */
export function snakeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [snake(k), snakeKeys(v)]));
}

/** The progress metrics by the names the coach uses: rmv_l_min, max_ascent_rate_m_min, score… */
export const METRIC_NAMES = Object.fromEntries(
  (Object.keys(PROGRESS_METRICS) as ProgressMetric[]).map((m) => [snake(m), m]),
) as Record<string, ProgressMetric>;

export const DESCRIPTIONS = {
  list_dives:
    "List every dive in the diver's log in chronological order with headline metrics " +
    "(number, id, date, site, max depth, duration, RMV gas consumption, peak ascent rate, quality score, issues, whether it has a review).",
  get_overview:
    'The dive log at a glance: how many dives, the latest one, progress trends, and what is still missing ("to sort out"): dives without a tank volume, gas, site or review.',
  get_dive_analysis:
    "Get full metrics and rule-based findings for one dive: gas consumption, ascent/descent rates, ppO2, CNS%, OTU, " +
    "END, safety stop / deco compliance, sawtooth count, computer alarms, plus the details filled in by the diver.",
  get_dive_profile:
    "Get the depth profile of a dive, downsampled to one point per interval: time (min), depth (m), temperature (C), " +
    "tank pressure (bar), deco stop depth and gas switches.",
  get_progress_trend:
    "Compare the diver's early vs recent dives for one metric and say whether it is improving. Metrics: " +
    `${Object.keys(METRIC_NAMES).join(", ")}.`,
  import_uddf:
    "Import a UDDF dive computer export (a .uddf file, or a folder of them) into the dive log. Duplicate dives are skipped.",
  save_dive_summary: "Save a coaching summary (Markdown) for a dive so it shows up in the app.",
  update_dive:
    "Fill in what the dive computer doesn't record: dive site, location, buddy, notes, the main tank's volume (litres) " +
    "and gas (e.g. air, EAN32, Tx 18/45). Only the fields given change; an empty text or null removes one. Returns the dive's new headline metrics.",
  prepare_dive:
    "Get ready for a planned dive (e.g. a dive card of a TripDeck trip) from the diver's own log: comparable experience (depth, gas, the same site), " +
    "time since the last dive, gas consumption at the planned depth, ppO2 / MOD / best nitrox mix, recurring problems, and notes worth raising. Read-only.",
  save_trip_plan:
    "Save a TripDeck trip's dive cards in the dive log with your preparation for each card (Markdown) and optional notes for the whole trip, so the app shows them. " +
    "Send every dive card of the trip as it is now: cards not sent are removed; a card's preparation and logged dives are kept unless new ones are sent (\"\" removes a text).",
  get_trip_plans:
    "The trips saved with save_trip_plan. Without trip_id: each trip with its dates and how many cards are prepared. With trip_id: its cards, preparation, " +
    "linked logged dives, and the dives logged on each card's day that aren't linked yet.",
  migrate_from_python:
    "Copy the dive log of the Python version (AI Diving Monitor, its SQLite database) into this one: every dive and saved review. " +
    "Safe to run again; nothing is added twice and the database is only read.",
} as const;

export class DiveRefError extends Error {}

/**
 * The dive a reference means: a number is its place in the log (1 = oldest), anything else its id or
 * the start of its id.
 */
export function resolveDive(records: DiveRecord[], ref: string | number): { record: DiveRecord; seq: number } {
  const log = chronological(records);
  const text = String(ref).trim().replace(/^#/, "");
  if (/^\d+$/.test(text)) {
    const seq = Number(text);
    if (seq >= 1 && seq <= log.length) return { record: log[seq - 1], seq };
    throw new DiveRefError(`There is no dive ${seq}: the log has ${log.length} dives (1 = the oldest). Use list_dives.`);
  }
  const matches = log.flatMap((record, i) => (record.id.startsWith(text) && text.length >= 6 ? [{ record, seq: i + 1 }] : []));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new DiveRefError(`More than one dive id starts with "${text}". Use the full id.`);
  throw new DiveRefError(`No dive with id "${text}". Use list_dives.`);
}

/** The log entries the trends and progress insights are computed from. */
export function history(records: DiveRecord[]) {
  return chronological(records).map((r) => {
    const { metrics, findings } = analyzeRecord(r);
    return { ...metrics, findingTitles: findings.map((f) => f.title) };
  });
}

export function listDives(records: DiveRecord[]) {
  return chronological(records).map((r, i) => {
    const dive = effectiveDive(r);
    const { metrics, findings } = analyzeRecord(r);
    return {
      id: r.id,
      seq: i + 1,
      start: dive.start,
      site: dive.site,
      max_depth_m: metrics.maxDepthM,
      duration_min: metrics.durationMin,
      rmv_l_min: metrics.rmvLMin,
      sac_bar_min: metrics.sacBarMin,
      max_ascent_rate_m_min: metrics.maxAscentRateMMin,
      safety_stop_s: metrics.safetyStopS,
      had_deco: metrics.hadDeco,
      gases: metrics.gases,
      score: metrics.score,
      finding_titles: findings.map((f) => f.title),
      has_review: r.review !== null,
    };
  });
}

export function diveAnalysis(record: DiveRecord, seq: number) {
  const dive = effectiveDive(record);
  const analysis = analyzeRecord(record);
  return {
    id: record.id,
    seq,
    start: dive.start,
    site: dive.site,
    location: dive.location,
    buddy: record.details.buddy ?? null,
    computer: dive.computer,
    notes: dive.notes,
    tanks: dive.tanks.map((t) => ({
      volume_l: t.volumeL,
      start_bar: t.startBar,
      end_bar: t.endBar,
      gas: t.mixId && Object.hasOwn(dive.gasMixes, t.mixId) ? gasLabel(dive.gasMixes[t.mixId]) : null,
    })),
    filled_in_by_diver: Object.keys(record.details).map(snake),
    metrics: snakeKeys(analysis.metrics) as Record<string, unknown>,
    findings: analysis.findings,
  };
}

/** One point per interval (and every gas switch), as the Python version returned it. */
export function diveProfile(record: DiveRecord, intervalS = 30) {
  const dive = effectiveDive(record);
  const step = Math.max(10, intervalS);
  const points: Record<string, number | string>[] = [];
  let next = 0;
  for (const s of dive.samples) {
    if (s.timeS < next && !s.mixRef) continue;
    const p: Record<string, number | string> = { t_min: pyRound(s.timeS / 60, 1), depth_m: pyRound(s.depthM, 1) };
    if (s.tempC !== null) p.temp_c = pyRound(s.tempC, 1);
    if (s.pressureBar !== null) p.tank_bar = pyRound(s.pressureBar);
    if (s.decoDepthM) p.deco_stop_m = s.decoDepthM;
    if (s.mixRef && Object.hasOwn(dive.gasMixes, s.mixRef)) p.gas = gasLabel(dive.gasMixes[s.mixRef]);
    points.push(p);
    next = s.timeS + step;
  }
  return points;
}

export function progressTrend(records: DiveRecord[], metricName: string) {
  const metric = METRIC_NAMES[metricName];
  if (!metric) return { error: `Unknown metric. Use one of: ${Object.keys(METRIC_NAMES).join(", ")}` };
  const t = trend(history(records), metric);
  return t ? { ...(snakeKeys(t) as object), metric: metricName } : { error: "Need at least 3 dives with this metric" };
}

const label = (r: DiveRecord, seq: number) => {
  const dive = effectiveDive(r);
  return `#${seq} ${dive.start ? dive.start.slice(0, 10) : "undated"}${dive.site ? ` ${dive.site}` : ""}`;
};

/** The log at a glance, with what is still missing: the answer of get_overview. */
export function overview(records: DiveRecord[], dataFolder: string): string {
  const log = chronological(records);
  if (!log.length) return `The dive log is empty (data folder: ${dataFolder}). Import UDDF files with import_uddf, or migrate the Python version's log with migrate_from_python.`;
  const seqOf = new Map(log.map((r, i) => [r.id, i + 1]));
  const first = log[0].dive.start?.slice(0, 10) ?? "undated";
  const last = log[log.length - 1];
  const lines = [
    `Dive log: ${log.length} dives, from ${first} to ${last.dive.start?.slice(0, 10) ?? "undated"}. Latest: ${label(last, log.length)} [${last.id}]. Data folder: ${dataFolder}.`,
  ];
  const h = history(log);
  const trends = (Object.keys(PROGRESS_METRICS) as ProgressMetric[])
    .map((m) => trend(h, m))
    .filter((t) => t !== null && t.verdict !== "stable");
  lines.push(
    trends.length
      ? `Trends: ${trends.map((t) => `${t!.label} ${t!.verdict} (${t!.earlyAvg} → ${t!.recentAvg})`).join("; ")}.`
      : "Trends: none yet (at least 3 dives with a metric are needed, and changes under 5 % count as stable).",
  );
  const todos = logTodos(log);
  lines.push(todos.length ? "To sort out:" : "To sort out: nothing, every dive has its details and a review.");
  for (const todo of todos) {
    const shown = todo.dives.slice(0, 10).map((id) => label(log[seqOf.get(id)! - 1], seqOf.get(id)!));
    const more = todo.dives.length > 10 ? ` and ${todo.dives.length - 10} more` : "";
    lines.push(`- ${todo.text} Dives: ${shown.join(", ")}${more}.`);
  }
  return lines.join("\n");
}

/** The answer of prepare_dive. */
export function divePrep(records: DiveRecord[], plan: PlannedDive, today = new Date()) {
  return snakeKeys(prepareDive(records, plan, today));
}

const shortDive = (records: DiveRecord[]) => {
  const log = chronological(records);
  const seqOf = new Map(log.map((r, i) => [r.id, i + 1]));
  return (id: string) => {
    const seq = seqOf.get(id);
    if (!seq) return { id, missing: true };
    const dive = effectiveDive(log[seq - 1]);
    return { id, seq, start: dive.start, site: dive.site };
  };
};

/** The answer of get_trip_plans: every trip in brief, or one trip in full. */
export function tripPlans(plans: TripPlan[], records: DiveRecord[], tripId?: string) {
  if (!tripId) {
    if (!plans.length) return "No trips saved yet. Read a trip with TripDeck's get_trip and save its dive cards with save_trip_plan.";
    return plans.map((p) => ({
      trip_id: p.id,
      name: p.name,
      destination: p.destination ?? null,
      start_date: p.startDate ?? null,
      end_date: p.endDate ?? null,
      dive_cards: p.dives.length,
      prepared: p.dives.filter((d) => d.prep).length,
      logged_dives: p.dives.reduce((n, d) => n + d.loggedDiveIds.length, 0),
      updated_at: p.updatedAt,
    }));
  }
  const plan = plans.find((p) => p.id === tripId);
  if (!plan) throw new DiveRefError(`No saved trip with id "${tripId}". Use get_trip_plans without trip_id to list them.`);
  const dive = shortDive(records);
  const linked = new Set(plan.dives.flatMap((d) => d.loggedDiveIds));
  const log = chronological(records);
  return {
    trip_id: plan.id,
    name: plan.name,
    destination: plan.destination ?? null,
    start_date: plan.startDate ?? null,
    end_date: plan.endDate ?? null,
    summary: plan.summary?.markdown ?? null,
    cards: plan.dives.map(({ prep, loggedDiveIds, ...card }) => ({
      ...(snakeKeys(card) as object),
      prep: prep?.markdown ?? null,
      prep_saved_at: prep?.savedAt ?? null,
      logged_dives: loggedDiveIds.map(dive),
      logged_that_day: card.date
        ? log.filter((r) => r.dive.start?.slice(0, 10) === card.date && !linked.has(r.id)).map((r) => dive(r.id))
        : [],
    })),
  };
}

export const TRIP_PREP_REQUEST = `Prepare me for the dives of my TripDeck trip {trip}.

1. Read the trip with TripDeck's get_trip (list_trips if you need its id). Note its no-fly and altitude warnings.
2. For every dive card, call prepare_dive with its site, location, max depth, gas, number of dives and date. If a card says only nitrox or trimix, or has no depth, ask me.
3. For each card write a short preparation: how ready I am from my log (comparable dives, time since my last dive), the gas plan (my RMV at that depth, ppO2 and MOD), what keeps going wrong in my dives and one or two drills for it, and what to check or ask the dive centre.
4. Write notes for the whole trip: what to practise before it, the order of the dives, gear, and the no-fly time before the flight home.
5. Save everything with save_trip_plan (all the dive cards, with your preparation).
6. On each TripDeck dive card, save the verdict with TripDeck's save_dive_prep: ready, or check when something is still to sort out, a one-line summary, and the card's url from save_trip_plan. Save any gas mix I told you on the card too (update_item with dive.mix).
7. Give me the trip notes and the cards that need my attention.`;

/** The web app (package.json runs it on this port). */
export const APP_URL = "http://localhost:3001";

/** A dive card's preparation in the app, for TripDeck to link to. */
export function tripCardUrl(tripId: string, itemId: string): string {
  return `${APP_URL}/trips/${encodeURIComponent(tripId)}#card-${encodeURIComponent(itemId)}`;
}
