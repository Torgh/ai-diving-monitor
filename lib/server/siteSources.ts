import { forecastWindow, marineUrl, type MarineDay, OVERPASS_URLS, overpassQuery, parseMarine, parseOverpass, type SiteCandidate } from "../sites";

/** Both services are free for personal use and ask to be told who is calling. */
const USER_AGENT = "DiveDeck (personal dive log; https://github.com/Torgh/divedeck)";
const TIMEOUT_MS = 20_000;
/** Dive sites hardly change; the forecast is redone every few hours. */
const SITES_TTL_MS = 24 * 3_600_000;
const MARINE_TTL_MS = 3 * 3_600_000;

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = cache.get(key);
  if (hit && now - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: now, value });
  return value;
}

/** Forgets the answers kept for a while (tests). */
export function clearSiteCache(): void {
  cache.clear();
}

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}${res.status === 429 ? " (too many requests: try again in a minute)" : ""}.`);
  return res.json();
}

/** The dive sites OpenStreetMap knows within `radiusKm` of the dive shop, the nearest first. */
export async function findDiveSites(lat: number, lng: number, radiusKm: number): Promise<SiteCandidate[]> {
  const key = `sites:${lat.toFixed(3)},${lng.toFixed(3)},${radiusKm}`;
  return cached(key, SITES_TTL_MS, async () => {
    const failures: string[] = [];
    for (const url of OVERPASS_URLS) {
      try {
        const json = await getJson(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: overpassQuery(lat, lng, radiusKm) }),
        });
        return parseOverpass(json, { lat, lng });
      } catch (err) {
        failures.push(err instanceof DOMException && err.name === "TimeoutError" ? `${new URL(url).hostname} didn't answer in time.` : (err as Error).message);
      }
    }
    throw new Error(`OpenStreetMap's servers are busy right now (${failures.join(" ")}) Try again in a few minutes, or propose the sites from the shop's website.`);
  });
}

export interface SiteConditions {
  /** The days asked for that the forecast reaches, local time at the site. */
  days: MarineDay[];
  /** Why there are fewer days than asked for, if there are. */
  note: string | null;
}

/** The sea at a site for `days` days from `start`, as far as the forecast reaches (16 days). */
export async function siteConditions(lat: number, lng: number, start: string, days: number, today: string): Promise<SiteConditions> {
  const window = forecastWindow(start, days, today);
  if (!window)
    return {
      days: [],
      note: `The forecast reaches 16 days ahead; ${start} is further. Use the season at the site for now and ask again in the last two weeks before the dive.`,
    };
  const key = `marine:${lat.toFixed(3)},${lng.toFixed(3)},${window.start},${window.end}`;
  const found = await cached(key, MARINE_TTL_MS, async () => parseMarine(await getJson(marineUrl(lat, lng, window.start, window.end))));
  const lastAsked = new Date(Date.parse(`${start}T00:00:00Z`) + (Math.max(1, days) - 1) * 86_400_000).toISOString().slice(0, 10);
  const cut = window.start !== start || window.end !== lastAsked;
  return {
    days: found,
    note: cut ? `Only ${window.start} to ${window.end}: the forecast covers the next 16 days.` : null,
  };
}
