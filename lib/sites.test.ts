import { describe, expect, it } from "vitest";
import { distanceKm, forecastWindow, marineUrl, overpassQuery, parseMarine, parseOverpass } from "./sites";

const SHOP = { lat: 10.095, lng: 99.827 }; // Koh Tao, Mae Haad

/** Shaped like Overpass's answer for the Gulf of Thailand (tags as OpenStreetMap has them). */
const OVERPASS = {
  elements: [
    {
      type: "node",
      id: 2,
      lat: 9.958,
      lon: 99.958,
      tags: { name: "หินใบ", "name:en": "Sail Rock", "scuba_diving:maxdepth": "35", "scuba_diving:mindepth": "1", "scuba_diving:entry": "boat", "scuba_diving:type": "reef", "scuba_diving:difficulty": "2", sport: "scuba_diving" },
    },
    {
      type: "node",
      id: 1,
      lat: 10.158,
      lon: 99.785,
      tags: { name: "Chumphon Pinnacle", depth: "20", "scuba_diving:maxdepth": "35", "scuba_diving:descent_line": "yes", "scuba_diving:entry": "boat", type: "reef", sport: "scuba_diving" },
    },
    { type: "way", id: 3, center: { lat: 10.11, lon: 99.81 }, tags: { name: "Twins", depth: "18,5", sport: "scuba_diving" } },
    { type: "node", id: 4, lat: 10.1, lon: 99.8, tags: { sport: "scuba_diving" } }, // no name
    { type: "node", id: 5, tags: { name: "No position", sport: "scuba_diving" } },
    { type: "node", id: 6, lat: 10.1, lon: 99.8 }, // no tags
  ],
};

describe("dive sites from OpenStreetMap", () => {
  it("asks for dive sites, not shops, around a point", () => {
    expect(overpassQuery(10.095, 99.827, 30)).toBe('[out:json][timeout:25];nwr["sport"="scuba_diving"][!"shop"][!"amenity"](around:30000,10.095,99.827);out center tags;');
  });

  it("reads the named sites with their depths, entry and difficulty, the nearest first", () => {
    const sites = parseOverpass(OVERPASS, SHOP);
    expect(sites.map((s) => s.name)).toEqual(["Twins", "Chumphon Pinnacle", "Sail Rock"]);
    expect(sites[0]).toEqual({ id: "osm-way-3", name: "Twins", lat: 10.11, lng: 99.81, distanceKm: 2.5, maxDepthM: 18.5, url: "https://www.openstreetmap.org/way/3" });
    expect(sites[1]).toMatchObject({ maxDepthM: 35, type: "reef", entry: "boat", descentLine: true });
    expect(sites[2]).toMatchObject({ id: "osm-node-2", name: "Sail Rock", minDepthM: 1, maxDepthM: 35, difficulty: 2, type: "reef" });
    expect(sites[2].distanceKm).toBeGreaterThan(20);
    expect(parseOverpass({}, SHOP)).toEqual([]);
    expect(parseOverpass(null, SHOP)).toEqual([]);
  });

  it("measures distances on the globe", () => {
    expect(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
    expect(distanceKm(SHOP, SHOP)).toBe(0);
  });
});

describe("the sea at a site from Open-Meteo", () => {
  it("asks for the daily waves and the hourly water temperature and current, in local time", () => {
    const url = new URL(marineUrl(9.958, 99.958, "2026-11-02", "2026-11-04"));
    expect(url.origin + url.pathname).toBe("https://marine-api.open-meteo.com/v1/marine");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "9.958",
      longitude: "99.958",
      daily: "wave_height_max,wave_period_max",
      hourly: "sea_surface_temperature,ocean_current_velocity",
      timezone: "auto",
      start_date: "2026-11-02",
      end_date: "2026-11-04",
    });
  });

  it("gives one row a day: highest waves, mean water temperature, strongest current", () => {
    const days = parseMarine({
      daily: { time: ["2026-11-02", "2026-11-03"], wave_height_max: [0.84, null], wave_period_max: [5.26, 6] },
      hourly: {
        time: ["2026-11-02T00:00", "2026-11-02T12:00", "2026-11-03T00:00"],
        sea_surface_temperature: [29.1, 29.6, null],
        ocean_current_velocity: [0.7, 1.43, null],
      },
    });
    expect(days).toEqual([
      { date: "2026-11-02", waveMaxM: 0.8, wavePeriodMaxS: 5.3, waterTempC: 29.4, currentMaxKmh: 1.4 },
      { date: "2026-11-03", waveMaxM: null, wavePeriodMaxS: 6, waterTempC: null, currentMaxKmh: null },
    ]);
    expect(parseMarine({})).toEqual([]);
  });

  it("keeps to the 16 days the forecast reaches", () => {
    expect(forecastWindow("2026-10-28", 3, "2026-10-26")).toEqual({ start: "2026-10-28", end: "2026-10-30" });
    expect(forecastWindow("2026-11-08", 5, "2026-10-26")).toEqual({ start: "2026-11-08", end: "2026-11-10" });
    expect(forecastWindow("2026-12-01", 3, "2026-10-26")).toBeNull();
    expect(forecastWindow("2026-10-20", 10, "2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-10-29" });
    expect(forecastWindow("2026-10-26", 0, "2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-10-26" });
  });
});
