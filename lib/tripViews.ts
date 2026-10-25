/**
 * What the Trips pages show: the saved TripDeck trips, and one trip's dive cards with the coach's
 * preparation, the numbers behind it (computed now, from the log as it is) and the logged dives.
 */

import { type DivePrep, prepareDive, recurringNote } from "./prep";
import { analyzeRecord, chronological, type DiveRecord, effectiveDive } from "./record";
import type { SavedText, TripDive, TripPlan } from "./trip";

/** Upcoming, under way (today is between its first and last day), past, or without dates. */
export type TripWhen = "upcoming" | "now" | "past" | "undated";

export interface TripRow {
  id: string;
  name: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  when: TripWhen;
  /** Days until the trip starts; negative once it has. */
  daysUntil: number | null;
  cards: number;
  prepared: number;
  loggedDives: number;
  updatedAt: string;
}

export interface LoggedDiveLink {
  id: string;
  /** Null when the dive is no longer in the log. */
  seq: number | null;
  start: string | null;
  site: string | null;
  maxDepthM: number | null;
  durationMin: number | null;
  score: number | null;
}

export interface TripCardView extends Omit<TripDive, "prep" | "loggedDiveIds"> {
  prep: SavedText | null;
  /** The numbers the preparation is built on, from the dives logged before the card's day. */
  facts: DivePrep;
  /** The notes for this dive; the problems that keep coming back are on the trip, once. */
  notes: string[];
  logged: LoggedDiveLink[];
  /** Dives logged on the card's day that no card of the trip is linked to yet. */
  loggedThatDay: LoggedDiveLink[];
}

export interface TripView extends TripRow {
  summary: SavedText | null;
  /** Problems on at least 2 of the last 10 dives before the trip. */
  recurringIssues: DivePrep["recurringIssues"];
  dives: TripCardView[];
}

const DAY_MS = 86_400_000;
const day = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** The trip's first and last day: its own dates, else its cards' dates. */
function span(plan: TripPlan): [string | null, string | null] {
  const dates = plan.dives.flatMap((d) => (d.date ? [d.date] : [])).sort();
  const start = plan.startDate ?? dates[0] ?? null;
  const end = plan.endDate ?? (dates.length ? dates[dates.length - 1] : start);
  return [start, end && start && end < start ? start : end];
}

export function tripRow(plan: TripPlan, today: Date = new Date()): TripRow {
  const [start, end] = span(plan);
  const now = day(today);
  const when: TripWhen = !start ? "undated" : now < start ? "upcoming" : end && now > end ? "past" : "now";
  return {
    id: plan.id,
    name: plan.name,
    destination: plan.destination ?? null,
    startDate: start,
    endDate: end,
    when,
    daysUntil: start ? daysBetween(now, start) : null,
    cards: plan.dives.length,
    prepared: plan.dives.filter((d) => d.prep).length,
    loggedDives: plan.dives.reduce((n, d) => n + d.loggedDiveIds.length, 0),
    updatedAt: plan.updatedAt,
  };
}

const ORDER: Record<TripWhen, number> = { now: 0, upcoming: 1, undated: 2, past: 3 };

/** Under way first, then the next ones by date, the undated, and the past ones newest first. */
export function tripsView(plans: TripPlan[], today: Date = new Date()): { trips: TripRow[]; next: TripRow | null } {
  const trips = plans
    .map((p) => tripRow(p, today))
    .sort((a, b) => {
      if (a.when !== b.when) return ORDER[a.when] - ORDER[b.when];
      const byDate = (a.startDate ?? "").localeCompare(b.startDate ?? "");
      return (a.when === "past" ? -byDate : byDate) || a.name.localeCompare(b.name);
    });
  return { trips, next: trips.find((t) => t.when === "now" || t.when === "upcoming") ?? null };
}

export function tripView(plans: TripPlan[], records: DiveRecord[], id: string, today: Date = new Date()): TripView | null {
  const plan = plans.find((p) => p.id === id);
  if (!plan) return null;
  const log = chronological(records);
  const links = new Map<string, LoggedDiveLink>(
    log.map((r, i) => {
      const dive = effectiveDive(r);
      const { metrics } = analyzeRecord(r);
      return [r.id, { id: r.id, seq: i + 1, start: dive.start, site: dive.site, maxDepthM: metrics.maxDepthM, durationMin: metrics.durationMin, score: metrics.score }];
    }),
  );
  const link = (id: string): LoggedDiveLink =>
    links.get(id) ?? { id, seq: null, start: null, site: null, maxDepthM: null, durationMin: null, score: null };
  const linked = new Set(plan.dives.flatMap((d) => d.loggedDiveIds));
  const row = tripRow(plan, today);

  return {
    ...row,
    summary: plan.summary,
    recurringIssues: prepareDive(records, { date: row.startDate ?? undefined }, today).recurringIssues,
    dives: plan.dives.map(({ prep, loggedDiveIds, ...card }) => {
      const facts = prepareDive(records, { site: card.site, maxDepthM: card.maxDepthM, gas: card.gas, dives: card.dives, date: card.date }, today);
      const shared = recurringNote(facts.recurringIssues);
      return {
        ...card,
        prep,
        facts,
        notes: facts.notes.filter((n) => n !== shared),
        logged: loggedDiveIds.map(link),
        loggedThatDay: card.date ? log.filter((r) => r.dive.start?.slice(0, 10) === card.date && !linked.has(r.id)).map((r) => link(r.id)) : [],
      };
    }),
  };
}
