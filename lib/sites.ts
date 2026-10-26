/**
 * Dive sites around a trip's dive shop, from OpenStreetMap, and the sea's forecast at a site, from
 * Open-Meteo's marine API. Both are free and need no key; lib/server/siteSources.ts fetches them,
 * this file builds the requests and reads the answers.
 */

/** A dive site OpenStreetMap knows near the dive shop. */
export interface SiteCandidate {
  /** "osm-node-123": the same site keeps its id when it is proposed again. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** As the crow flies from the dive shop. */
  distanceKm: number;
  minDepthM?: number;
  maxDepthM?: number;
  /** "reef", "wreck", "wall"… */
  type?: string;
  /** "boat", "shore". */
  entry?: string;
  /** OSM's scale, 0 (easy) to 3 (hard). */
  difficulty?: number;
  descentLine?: boolean;
  /** The site on openstreetmap.org, for the source. */
  url: string;
}

/** The sea at a site on one day. */
export interface MarineDay {
  /** "YYYY-MM-DD". */
  date: string;
  waveMaxM: number | null;
  wavePeriodMaxS: number | null;
  waterTempC: number | null;
  /** The surface current, the strongest of the day. */
  currentMaxKmh: number | null;
}

/** Public Overpass instances, tried in turn: each is often busy on its own. */
export const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
export const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
/** Open-Meteo's marine forecast reaches this many days ahead. */
export const FORECAST_DAYS = 16;

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Dive sites (not dive shops) within `radiusKm` of a point. */
export function overpassQuery(lat: number, lng: number, radiusKm: number): string {
  const around = `around:${Math.round(radiusKm * 1000)},${lat},${lng}`;
  return `[out:json][timeout:25];nwr["sport"="scuba_diving"][!"shop"][!"amenity"](${around});out center tags;`;
}

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const number = (text: string | undefined) => {
  const n = text === undefined ? NaN : Number.parseFloat(text.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

/** The named dive sites of an Overpass answer, the nearest first. */
export function parseOverpass(json: unknown, from: { lat: number; lng: number }): SiteCandidate[] {
  const elements = ((json as { elements?: OsmElement[] })?.elements ?? []).filter((e) => e.tags);
  const sites: SiteCandidate[] = [];
  for (const e of elements) {
    const t = e.tags!;
    const name = t["name:en"] ?? t.name;
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!name || lat === undefined || lng === undefined) continue;
    const site: SiteCandidate = {
      id: `osm-${e.type}-${e.id}`,
      name,
      lat,
      lng,
      distanceKm: Math.round(distanceKm(from, { lat, lng }) * 10) / 10,
      url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    };
    const minDepth = number(t["scuba_diving:mindepth"]);
    const maxDepth = number(t["scuba_diving:maxdepth"]) ?? number(t.depth);
    const difficulty = number(t["scuba_diving:difficulty"]);
    const type = t["scuba_diving:type"] ?? t.type;
    if (minDepth !== undefined) site.minDepthM = minDepth;
    if (maxDepth !== undefined) site.maxDepthM = maxDepth;
    if (type) site.type = type;
    if (t["scuba_diving:entry"]) site.entry = t["scuba_diving:entry"];
    if (difficulty !== undefined) site.difficulty = difficulty;
    if (t["scuba_diving:descent_line"] === "yes") site.descentLine = true;
    sites.push(site);
  }
  return sites.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
}

/** The daily marine forecast for a point, local time. */
export function marineUrl(lat: number, lng: number, start: string, end: string): string {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: "wave_height_max,wave_period_max",
    hourly: "sea_surface_temperature,ocean_current_velocity",
    timezone: "auto",
    start_date: start,
    end_date: end,
  });
  return `${MARINE_URL}?${params}`;
}

const round = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits);

/** One row a day: the waves from the daily figures, the water's mean temperature and the strongest current from the hourly ones. */
export function parseMarine(json: unknown): MarineDay[] {
  const j = json as {
    daily?: { time?: string[]; wave_height_max?: (number | null)[]; wave_period_max?: (number | null)[] };
    hourly?: { time?: string[]; sea_surface_temperature?: (number | null)[]; ocean_current_velocity?: (number | null)[] };
  };
  const hours = new Map<string, { temps: number[]; currents: number[] }>();
  (j.hourly?.time ?? []).forEach((time, i) => {
    const day = hours.get(time.slice(0, 10)) ?? { temps: [], currents: [] };
    const temp = j.hourly?.sea_surface_temperature?.[i];
    const current = j.hourly?.ocean_current_velocity?.[i];
    if (typeof temp === "number") day.temps.push(temp);
    if (typeof current === "number") day.currents.push(current);
    hours.set(time.slice(0, 10), day);
  });
  return (j.daily?.time ?? []).map((date, i) => {
    const h = hours.get(date);
    return {
      date,
      waveMaxM: round(j.daily?.wave_height_max?.[i]),
      wavePeriodMaxS: round(j.daily?.wave_period_max?.[i]),
      waterTempC: h?.temps.length ? round(h.temps.reduce((s, t) => s + t, 0) / h.temps.length) : null,
      currentMaxKmh: h?.currents.length ? round(Math.max(...h.currents)) : null,
    };
  });
}

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The part of [start, start + days) the forecast reaches from `today`: null when it starts later.
 * Before that, only the season (from what the companion found on the web) says what to expect.
 */
export function forecastWindow(start: string, days: number, today: string): { start: string; end: string } | null {
  const last = isoDay(Date.parse(`${today}T00:00:00Z`) + (FORECAST_DAYS - 1) * DAY_MS);
  const from = start < today ? today : start;
  const to = isoDay(Date.parse(`${start}T00:00:00Z`) + (Math.max(1, days) - 1) * DAY_MS);
  const end = to > last ? last : to;
  return from > end ? null : { start: from, end };
}
