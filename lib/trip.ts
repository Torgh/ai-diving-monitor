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
  /** The verdict also saved on the TripDeck card (older files have none). */
  verdict?: CardVerdict;
  /** Logged dives this card turned into (record ids). */
  loggedDiveIds: string[];
}

/** Ready, or something still to sort out before the dive, in one line: the badge on the TripDeck card. */
export interface CardVerdict {
  status: "ready" | "check";
  summary: string;
  savedAt: string;
}

/** A flight of the trip, as TripDeck has it, in local time: what the no-fly time is counted to. */
export interface TripFlight {
  /** "YYYY-MM-DD". */
  date: string;
  /** "HH:MM", the departure. */
  time?: string;
  from?: string;
  to?: string;
}

/** The dive shop the trip dives from: what the sites are proposed around. */
export interface TripShop {
  name: string;
  lat?: number;
  lng?: number;
}

export type SiteStatus = "proposed" | "chosen" | "dropped";

/**
 * A dive site the companion proposed for the trip. The diver chooses; only a chosen site gets the
 * full profile (conditions, what it takes, sources), so the research goes where the dives will be.
 */
export interface TripSite {
  /** "osm-node-123" for a site from OpenStreetMap, else a slug of the name. */
  id: string;
  name: string;
  lat?: number;
  lng?: number;
  /** From the dive shop. */
  distanceKm?: number;
  minDepthM?: number;
  maxDepthM?: number;
  type?: string;
  entry?: string;
  /** Where the site's facts come from: its OpenStreetMap page, or a web page. */
  source?: string;
  /** Why it suits this diver, in one line. */
  why: string;
  status: SiteStatus;
  /** The companion's profile of a chosen site: conditions for the trip's dates, what it takes, sources. */
  profile: SavedText | null;
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
  /** The trip's flights, for the time between the last dive and flying (older files have none). */
  flights?: TripFlight[];
  dives: TripDive[];
  /** The dive shop and the sites proposed around it (older files have none). */
  shop?: TripShop;
  sites?: TripSite[];
  /** The companion's notes on the proposals as a whole: the shop's schedule, the season, the diver's log. */
  siteNotes?: SavedText;
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
  /** Omitted: keep the saved ones. [] removes them. */
  flights?: TripFlight[];
  dives: (Omit<TripDive, "prep" | "loggedDiveIds" | "verdict"> & {
    /** Omitted: keep the saved one. "": remove it. */
    prepMarkdown?: string;
    /** Omitted: keep the saved verdict. "": remove it. */
    verdict?: CardVerdict["status"] | "";
    /** The verdict's one line. */
    verdictSummary?: string;
    /** Omitted: keep the saved links. */
    loggedDiveIds?: string[];
  })[];
}

const ID_RE = /^[\w-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

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
  for (const d of [input.startDate, input.endDate, ...input.dives.map((c) => c.date), ...(input.flights ?? []).map((f) => f.date)])
    if (d !== undefined && !DATE_RE.test(d)) throw new TripInputError(`Dates are written YYYY-MM-DD, not "${d}".`);
  for (const f of input.flights ?? [])
    if (f.time !== undefined && !TIME_RE.test(f.time)) throw new TripInputError(`Flight times are written HH:MM, not "${f.time}".`);
  const ids = input.dives.map((c) => c.itemId);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new TripInputError(`The card ${dup} is sent twice.`);

  const before = new Map(saved?.dives.map((c) => [c.itemId, c]));
  const dives: TripDive[] = input.dives.map(({ prepMarkdown, loggedDiveIds, verdict, verdictSummary, ...card }) => {
    const old = before.get(card.itemId);
    const clean = Object.fromEntries(Object.entries(card).filter(([, v]) => v !== undefined && v !== "")) as unknown as Omit<TripDive, "prep" | "loggedDiveIds" | "verdict">;
    const kept = verdict === undefined ? old?.verdict : verdict === "" ? undefined : { status: verdict, summary: verdictSummary?.trim() ?? "", savedAt: now };
    return {
      ...clean,
      title: card.title.trim() || card.site?.trim() || "Dive",
      prep: text(old?.prep ?? null, prepMarkdown, now),
      ...(kept ? { verdict: kept } : {}),
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
  if (saved?.shop) plan.shop = saved.shop;
  if (saved?.sites) plan.sites = saved.sites;
  if (saved?.siteNotes) plan.siteNotes = saved.siteNotes;
  if (input.destination?.trim()) plan.destination = input.destination.trim();
  if (input.startDate) plan.startDate = input.startDate;
  if (input.endDate) plan.endDate = input.endDate;
  const flights = (input.flights ?? saved?.flights ?? [])
    .map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")) as unknown as TripFlight)
    .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
  if (flights.length) plan.flights = flights;
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

/** A proposal as the agent sends it. */
export type SiteProposal = Omit<TripSite, "id" | "status" | "profile"> & { id?: string };

/** "Chumphon Pinnacle" → "chumphon-pinnacle": the id of a site that isn't from OpenStreetMap. */
export function siteSlug(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // é → e; the marks of other scripts (Thai vowels) stay
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "site"
  );
}

const SITE_ID_RE = /^[\p{L}\p{M}\p{N}_-]{1,80}$/u;

/**
 * Proposes the sites around the dive shop, with notes on the proposals as a whole (left out: the saved
 * ones stay; "": removed). A site proposed again keeps what the diver chose and its profile; a chosen
 * site that isn't proposed any more stays, so a choice is never lost.
 */
export function proposeSites(plan: TripPlan, shop: TripShop, proposals: SiteProposal[], notes?: { markdown: string; now: string }): void {
  if (!shop.name.trim()) throw new TripInputError("The dive shop needs a name.");
  const before = new Map((plan.sites ?? []).map((s) => [s.id, s]));
  const sites: TripSite[] = [];
  for (const p of proposals) {
    if (!p.name.trim()) throw new TripInputError("Every site needs a name.");
    const id = p.id?.trim() || siteSlug(p.name);
    if (!SITE_ID_RE.test(id)) throw new TripInputError(`Invalid site id "${id}": letters, digits, - and _.`);
    if (sites.some((s) => s.id === id)) throw new TripInputError(`The site ${id} is proposed twice.`);
    const old = before.get(id);
    const clean = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) as SiteProposal;
    sites.push({ ...clean, id, name: p.name.trim(), why: p.why.trim(), status: old?.status ?? "proposed", profile: old?.profile ?? null });
  }
  for (const old of before.values()) if (old.status === "chosen" && !sites.some((s) => s.id === old.id)) sites.push(old);
  const cleanShop = Object.fromEntries(Object.entries(shop).filter(([, v]) => v !== undefined && v !== "")) as unknown as TripShop;
  plan.shop = { ...cleanShop, name: shop.name.trim() };
  plan.sites = sites;
  if (notes) {
    const kept = text(plan.siteNotes ?? null, notes.markdown, notes.now);
    if (kept) plan.siteNotes = kept;
    else delete plan.siteNotes;
  }
}

/** Marks sites chosen or dropped (or proposed again); an unknown id is an error, so a typo doesn't pass silently. */
export function chooseSites(plan: TripPlan, change: Partial<Record<SiteStatus, string[]>>): void {
  const sites = plan.sites ?? [];
  for (const [status, ids] of Object.entries(change) as [SiteStatus, string[]][]) {
    for (const id of ids ?? []) {
      const site = sites.find((s) => s.id === id);
      if (!site) throw new TripInputError(`The trip has no proposed site "${id}". Its sites: ${sites.map((s) => s.id).join(", ") || "none yet"}.`);
      site.status = status;
    }
  }
}

/** Saves the profile of a chosen site; "" removes it. */
export function saveSiteProfile(plan: TripPlan, siteId: string, markdown: string, now: string): TripSite {
  const site = (plan.sites ?? []).find((s) => s.id === siteId);
  if (!site) throw new TripInputError(`The trip has no proposed site "${siteId}".`);
  if (site.status !== "chosen" && markdown.trim()) throw new TripInputError(`${site.name} isn't chosen: profiles are written for the sites the diver chose.`);
  site.profile = text(site.profile, markdown, now);
  return site;
}

const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** A site's names: "Twin Rocks (Twins)" is also "Twin Rocks" and "Twins". */
function siteNames(site: TripSite): string[] {
  const alias = /\(([^)]+)\)/.exec(site.name)?.[1];
  return [site.name, site.name.replace(/\([^)]*\)/g, ""), alias].filter((n): n is string => !!n?.trim()).map(plain);
}

/**
 * The proposed site a dive card is about, by its site or title ("Sail Rock full-day trip" is Sail
 * Rock): a chosen site first, never a dropped one.
 */
export function siteForCard(sites: TripSite[] | undefined, card: Pick<TripDive, "site" | "title">): TripSite | null {
  const texts = [card.site, card.title].filter((t): t is string => !!t?.trim()).map(plain);
  const matches = (site: TripSite) => siteNames(site).some((name) => texts.some((t) => t === name || ` ${t} `.includes(` ${name} `)));
  const open = (sites ?? []).filter((s) => s.status !== "dropped");
  return open.find((s) => s.status === "chosen" && matches(s)) ?? open.find(matches) ?? null;
}
