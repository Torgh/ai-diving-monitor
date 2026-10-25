/**
 * A TripDeck trip as the dive log keeps it: one file per trip with its dive cards, the coach's
 * preparation for each and, after the trip, the logged dives each card turned into. The agent copies
 * the cards from TripDeck (through TripDeck's MCP server); TripDeck stays the place the trip is planned.
 */

export const TRIP_FORMAT = "ai-diving-monitor/trip";
export const TRIP_VERSION = 1;

export interface SavedText {
  markdown: string;
  savedAt: string;
}

/** A dive card of the trip, as TripDeck has it, plus what the dive log adds. */
export interface TripDive {
  /** The card's id in TripDeck. */
  itemId: string;
  title: string;
  /** The trip day, 1 = the first. */
  day?: number;
  /** "YYYY-MM-DD". */
  date?: string;
  /** "HH:MM". */
  startTime?: string;
  site?: string;
  center?: string;
  lat?: number;
  lng?: number;
  maxDepthM?: number;
  /** "air", "nitrox", "trimix", or a mix: "EAN32", "Tx 18/45". */
  gas?: string;
  /** Dives in the outing. */
  dives?: number;
  /** The coach's preparation for this dive. */
  prep: SavedText | null;
  /** Logged dives this card turned into (record ids). */
  loggedDiveIds: string[];
}

export interface TripPlan {
  format: typeof TRIP_FORMAT;
  version: number;
  /** The trip's id in TripDeck. */
  id: string;
  name: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
  /** The coach's notes for the whole trip: what to practise before it, gear, the order of the dives. */
  summary: SavedText | null;
  dives: TripDive[];
}

/** What the agent sends: the trip's dive cards as they are now, with optional preparation texts. */
export interface TripPlanInput {
  id: string;
  name: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
  /** Omitted: keep the saved one. "": remove it. */
  summaryMarkdown?: string;
  dives: (Omit<TripDive, "prep" | "loggedDiveIds"> & {
    /** Omitted: keep the saved one. "": remove it. */
    prepMarkdown?: string;
    /** Omitted: keep the saved links. */
    loggedDiveIds?: string[];
  })[];
}

const ID_RE = /^[\w-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class TripInputError extends Error {}

export function assertTripId(id: string): void {
  if (!ID_RE.test(id)) throw new TripInputError(`Invalid trip id "${id}": use TripDeck's trip id (letters, digits, - and _).`);
}

function text(saved: SavedText | null, markdown: string | undefined, now: string): SavedText | null {
  if (markdown === undefined) return saved;
  const trimmed = markdown.trim();
  return trimmed ? { markdown: trimmed, savedAt: now } : null;
}

/**
 * The saved plan updated with what TripDeck has now: the cards are replaced by the ones sent (a card
 * removed in TripDeck leaves), but a card's preparation and logged dives stay unless new ones are sent.
 */
export function mergeTripPlan(saved: TripPlan | undefined, input: TripPlanInput, now: string): TripPlan {
  assertTripId(input.id);
  if (!input.name.trim()) throw new TripInputError("The trip needs a name.");
  for (const d of [input.startDate, input.endDate, ...input.dives.map((c) => c.date)])
    if (d !== undefined && !DATE_RE.test(d)) throw new TripInputError(`Dates are written YYYY-MM-DD, not "${d}".`);
  const ids = input.dives.map((c) => c.itemId);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new TripInputError(`The card ${dup} is sent twice.`);

  const before = new Map(saved?.dives.map((c) => [c.itemId, c]));
  const dives: TripDive[] = input.dives.map(({ prepMarkdown, loggedDiveIds, ...card }) => {
    const old = before.get(card.itemId);
    const clean = Object.fromEntries(Object.entries(card).filter(([, v]) => v !== undefined && v !== "")) as Omit<TripDive, "prep" | "loggedDiveIds">;
    return {
      ...clean,
      title: card.title.trim() || card.site?.trim() || "Dive",
      prep: text(old?.prep ?? null, prepMarkdown, now),
      loggedDiveIds: loggedDiveIds ? [...new Set(loggedDiveIds)] : (old?.loggedDiveIds ?? []),
    };
  });
  dives.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || (a.day ?? 0) - (b.day ?? 0) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));

  const plan: TripPlan = {
    format: TRIP_FORMAT,
    version: TRIP_VERSION,
    id: input.id,
    name: input.name.trim(),
    createdAt: saved?.createdAt ?? now,
    updatedAt: now,
    summary: text(saved?.summary ?? null, input.summaryMarkdown, now),
    dives,
  };
  if (input.destination?.trim()) plan.destination = input.destination.trim();
  if (input.startDate) plan.startDate = input.startDate;
  if (input.endDate) plan.endDate = input.endDate;
  return plan;
}

/** "Malta 2027 (abc123).trip.json": readable in a file browser, found again by the trip's id. */
export function tripFileName(plan: Pick<TripPlan, "id" | "name">): string {
  const name = plan.name
    .replace(/[^\p{L}\p{N} ._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${name ? `${name} ` : ""}(${plan.id}).trip.json`;
}
