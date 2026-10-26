import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSiteCache, findDiveSites, siteConditions } from "./siteSources";

/** OpenStreetMap and Open-Meteo stand-ins: the tests never go to the internet. */
let calls: { url: string; init?: RequestInit }[];
let answer: () => Response;

beforeEach(() => {
  calls = [];
  clearSiteCache();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answer();
  });
});

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

describe("findDiveSites", () => {
  it("asks Overpass once a day for the same place, saying who asks", async () => {
    answer = json({ elements: [{ type: "node", id: 1, lat: 10.158, lon: 99.785, tags: { name: "Chumphon Pinnacle", sport: "scuba_diving" } }] });
    const sites = await findDiveSites(10.095, 99.827, 30);
    expect(sites.map((s) => s.name)).toEqual(["Chumphon Pinnacle"]);
    expect(calls[0].url).toBe("https://overpass-api.de/api/interpreter");
    expect(calls[0].init?.method).toBe("POST");
    expect(new URLSearchParams(String(calls[0].init?.body)).get("data")).toContain("around:30000,10.095,99.827");
    expect((calls[0].init?.headers as Record<string, string>)["User-Agent"]).toMatch(/^DiveDeck/);
    await findDiveSites(10.095, 99.827, 30);
    expect(calls).toHaveLength(1);
  });

  it("tries the next instance when one is busy, and says so when all are", async () => {
    const answers = [json({}, 502), json({ elements: [] })];
    answer = () => answers.shift()!();
    expect(await findDiveSites(1, 2, 10)).toEqual([]);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["overpass-api.de", "overpass.private.coffee"]);

    answer = json({}, 429);
    await expect(findDiveSites(1, 2, 11)).rejects.toThrow(
      "OpenStreetMap's servers are busy right now (overpass-api.de answered 429 (too many requests: try again in a minute). overpass.private.coffee answered 429",
    );
    answer = () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    await expect(findDiveSites(1, 2, 12)).rejects.toThrow("overpass-api.de didn't answer in time.");
  });
});

describe("siteConditions", () => {
  const marine = json({
    daily: { time: ["2026-10-28"], wave_height_max: [0.6], wave_period_max: [4.1] },
    hourly: { time: ["2026-10-28T00:00"], sea_surface_temperature: [29.2], ocean_current_velocity: [0.9] },
  });

  it("gives the forecast for the days asked", async () => {
    answer = marine;
    const found = await siteConditions(9.958, 99.958, "2026-10-28", 1, "2026-10-26");
    expect(found).toEqual({ days: [{ date: "2026-10-28", waveMaxM: 0.6, wavePeriodMaxS: 4.1, waterTempC: 29.2, currentMaxKmh: 0.9 }], note: null });
    expect(calls[0].url).toContain("start_date=2026-10-28&end_date=2026-10-28");
  });

  it("says when the days go past the forecast, and doesn't ask for a date it doesn't reach", async () => {
    answer = marine;
    const cut = await siteConditions(9.958, 99.958, "2026-11-09", 5, "2026-10-26");
    expect(calls[0].url).toContain("start_date=2026-11-09&end_date=2026-11-10");
    expect(cut.note).toBe("Only 2026-11-09 to 2026-11-10: the forecast covers the next 16 days.");
    const later = await siteConditions(9.958, 99.958, "2026-12-20", 3, "2026-10-26");
    expect(later.days).toEqual([]);
    expect(later.note).toContain("2026-12-20 is further");
    expect(calls).toHaveLength(1);
  });
});
