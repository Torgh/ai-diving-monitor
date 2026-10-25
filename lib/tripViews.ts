/**
 * What the Trips pages show: the saved TripDeck trips, and one trip's dive cards with the coach's
 * preparation, the numbers behind it (computed now, from the log as it is) and the logged dives.
 */

import { type DivePrep, prepareDive, recurringNote } from "./prep";
import { analyzeRecord, chronological, type DiveRecord, effectiveDive } from "./record";
import type { SavedText, TripDive, TripFlight, TripPlan } from "./trip";

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
  /** Days with at least one dive card. */
  diveDays: number;
  prepared: number;
  /** Cards whose verdict says something is still to sort out. */
  toCheck: number;
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

/** The rest before the trip: from the last logged dive, or the last dive of an earlier trip if that is later. */
export interface BreakBefore {
  days: number;
  after: { kind: "dive"; seq: number; date: string } | { kind: "trip"; id: string; name: string; date: string };
}

/** Time from the end of the last dive to the next flight, against DAN's guidance. */
export interface FlightCheck {
  flight: TripFlight;
  /** "YYYY-MM-DDTHH:MM", local time. */
  lastDiveEnd: string;
  hours: number;
  /** 12 h after a single no-deco dive, 18 h after repetitive or multi-day diving. */
  neededHours: 12 | 18;
  /** The last dive or the flight has no time on its card, so a cautious one was assumed. */
  timeAssumed: boolean;
}

export interface TripView extends TripRow {
  summary: SavedText | null;
  breakBefore: BreakBefore | null;
  flight: FlightCheck | null;
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
    diveDays: new Set(plan.dives.map((d) => d.date ?? `day ${d.day ?? d.itemId}`)).size,
    prepared: plan.dives.filter((d) => d.prep).length,
    toCheck: plan.dives.filter((d) => d.verdict?.status === "check").length,
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

const dated = (plan: TripPlan) => plan.dives.filter((d): d is TripDive & { date: string } => !!d.date);

export function breakBefore(plan: TripPlan, plans: TripPlan[], records: DiveRecord[]): BreakBefore | null {
  const first = dated(plan)[0]?.date ?? plan.startDate;
  if (!first) return null;
  const log = chronological(records);
  let after: BreakBefore["after"] | null = null;
  log.forEach((r, i) => {
    const date = effectiveDive(r).start?.slice(0, 10);
    if (date && date < first && (!after || date >= after.date)) after = { kind: "dive", seq: i + 1, date };
  });
  for (const other of plans) {
    if (other.id === plan.id) continue;
    const last = dated(other)
      .map((d) => d.date)
      .filter((d) => d < first)
      .pop();
    if (last && (!after || last > after.date)) after = { kind: "trip", id: other.id, name: other.name, date: last };
  }
  const found = after as BreakBefore["after"] | null;
  return found ? { days: daysBetween(found.date, first), after: found } : null;
}

const MINUTE_MS = 60_000;
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`);
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/**
 * The first flight after the trip's last dive, and the hours between. A dive without a time counts as
 * ending at 18:00, an outing as about 90 minutes per dive from its start, and a flight without a time
 * as leaving at the first moment of its day (or right after the dive, on the same day): when unsure,
 * the gap comes out shorter, never longer. Times are local, as on TripDeck's cards.
 */
export function flightAfterDiving(plan: TripPlan): FlightCheck | null {
  const cards = dated(plan);
  if (!cards.length || !plan.flights?.length) return null;
  const last = cards.reduce((a, b) => (`${b.date}${b.startTime ?? "99"}` > `${a.date}${a.startTime ?? "99"}` ? b : a));
  const end = last.startTime ? at(last.date, last.startTime) + (last.dives ?? 1) * 90 * MINUTE_MS : at(last.date, "18:00");
  // Flights are sorted; the first one from the last dive's day on is the one that counts.
  const flight = plan.flights.find((f) => f.date >= last.date);
  if (!flight) return null;
  const departs = flight.time ? at(flight.date, flight.time) : Math.max(at(flight.date, "00:00"), end);
  const repetitive = cards.some((d) => (d.dives ?? 1) > 1) || new Set(cards.map((d) => d.date)).size > 1;
  return {
    flight,
    lastDiveEnd: stamp(end),
    hours: Math.round(((departs - end) / 3_600_000) * 10) / 10,
    neededHours: repetitive ? 18 : 12,
    timeAssumed: !last.startTime || !flight.time,
  };
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
    breakBefore: breakBefore(plan, plans, records),
    flight: flightAfterDiving(plan),
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
