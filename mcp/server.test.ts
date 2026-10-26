import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs the real MCP server the way Claude Code does (Bun over stdio) against a temporary data folder,
 * never the diver's own log.
 */

function findBun(): string | undefined {
  const candidates = [
    process.env.BUN_PATH,
    path.join(os.homedir(), ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"),
    "bun",
  ];
  return candidates.find((c) => c && spawnSync(c, ["--version"]).status === 0);
}

const ROOT = path.resolve(__dirname, "..");
const bun = findBun();
const home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-mcp-test-"));
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: res.content.map((c) => c.text).join("\n"), isError: !!res.isError };
};
const ok = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await call(name, args);
  if (res.isError) throw new Error(`${name} failed: ${res.text}`);
  return res.text;
};
const json = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(await ok(name, args));

describe.skipIf(!bun)("MCP server", () => {
  beforeAll(async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
    client = new Client({ name: "divedeck-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: bun!,
        args: [path.join(ROOT, "mcp", "server.ts")],
        env: { ...Object.fromEntries(Object.entries(env).filter(([k]) => !/^(DIVEDECK|AI_DIVING_MONITOR)_/i.test(k))), DIVEDECK_HOME: home, DIVEDECK_DB: path.join(home, "no-such.db") },
        stderr: "pipe",
      }),
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("offers the coach tools and prompts", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      "choose_dive_sites", "estimate_weighting", "find_dive_sites", "get_dive_analysis", "get_dive_profile", "get_kit", "get_overview", "get_progress_trend",
      "get_site_conditions", "get_trip_plans", "import_uddf", "list_dives", "migrate_from_python", "prepare_dive", "propose_dive_sites", "save_dive_summary",
      "save_site_profile", "save_trip_plan", "update_dive", "update_kit",
    ]);
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["dive-review", "site-scout", "sort-out", "trip-prep"]);
    expect(client.getInstructions()).toContain("save it with update_dive");
    expect(client.getInstructions()).toContain("TripDeck's get_trip");
  });

  it("starts with an empty log", async () => {
    expect(await json("list_dives")).toEqual([]);
    expect(await ok("get_overview")).toContain("The dive log is empty");
    const prompt = await client.getPrompt({ name: "dive-review", arguments: {} });
    expect(JSON.stringify(prompt.messages)).toContain("import_uddf");
  });

  it("imports a folder of UDDF files, skipping duplicates", async () => {
    const first = await json("import_uddf", { path: path.join(ROOT, "examples") });
    expect(first.map((r: { added: number }) => r.added)).toEqual([5, 4]);
    const again = await json("import_uddf", { path: path.join(ROOT, "examples", "spring-2026.uddf") });
    expect(again).toEqual([{ file: path.join(ROOT, "examples", "spring-2026.uddf"), added: 0, duplicates: 5 }]);
    expect((await call("import_uddf", { path: path.join(home, "missing") })).isError).toBe(true);
    const notUddf = path.join(home, "notes.uddf");
    fs.writeFileSync(notUddf, "<html/>");
    expect((await json("import_uddf", { path: notUddf }))[0].error).toContain("expected <uddf>");
  });

  it("lists, analyses and profiles dives by their number in the log", async () => {
    const dives = await json("list_dives");
    expect(dives).toHaveLength(9);
    expect(dives[0]).toMatchObject({ seq: 1, site: "Koparki", has_review: false });
    const analysis = await json("get_dive_analysis", { dive_id: 1 });
    expect(analysis).toMatchObject({ id: dives[0].id, seq: 1, metrics: { max_depth_m: 18 } });
    expect(await json("get_dive_analysis", { dive_id: dives[0].id })).toEqual(analysis);
    const profile = await json("get_dive_profile", { dive_id: "1", interval_s: 120 });
    expect(profile[0]).toMatchObject({ t_min: 0, depth_m: 0 });
    expect(await json("get_progress_trend", { metric: "rmv_l_min" })).toMatchObject({ verdict: "improving", metric: "rmv_l_min" });
    const missing = await call("get_dive_analysis", { dive_id: 42 });
    expect(missing).toEqual({ isError: true, text: expect.stringContaining("the log has 9 dives") });
  });

  it("fills in what the computer didn't record, and the gas consumption appears", async () => {
    await ok("import_uddf", { path: path.join(ROOT, "fixtures", "uddf", "shearwater-style.uddf") });
    const sw = (await json("list_dives")).find((d: { start: string }) => d.start === "2026-09-12T10:15:00");
    expect(sw.rmv_l_min).toBeNull();
    expect(await ok("get_overview")).toContain("Tank volume missing");

    const updated = await json("update_dive", { dive_id: sw.id, tank_volume_l: 12, gas: "EAN32", site: "Zakrzówek", buddy: "Ola" });
    expect(updated.details).toEqual({ site: "Zakrzówek", buddy: "Ola", tankVolumeL: 12, gas: { o2: 0.32, he: 0 } });
    expect(updated.metrics.rmv_l_min).toBeGreaterThan(0);
    expect(updated.metrics.gases).toEqual(["EAN32"]);
    expect(await ok("get_overview")).not.toContain("Tank volume missing");

    const cleared = await json("update_dive", { dive_id: sw.id, buddy: null, gas: null });
    expect(cleared.details).toEqual({ site: "Zakrzówek", tankVolumeL: 12 });
    const bad = await call("update_dive", { dive_id: sw.id, gas: "banana" });
    expect(bad).toEqual({ isError: true, text: expect.stringContaining("Can't read the gas") });
  });

  it("saves reviews for the app", async () => {
    expect(await json("save_dive_summary", { dive_id: 2, summary_markdown: "## Good dive" })).toMatchObject({ saved: true, seq: 2 });
    expect((await json("list_dives"))[1].has_review).toBe(true);
    const prompt = await client.getPrompt({ name: "dive-review", arguments: {} });
    expect(JSON.stringify(prompt.messages)).toContain("Review dive #10");
  });

  it("keeps the kit and puts the gear, lead, water and weighting on a dive", async () => {
    expect(await json("get_kit")).toMatchObject({ format: "divedeck/kit", diver: {}, items: [], sets: [] });
    const kit = await json("update_kit", {
      diver: { mass_kg: 82, height_cm: 183 },
      items: [
        { name: "Pianka 7 mm", kind: "suit", suit_type: "wetsuit", thickness_mm: 7 },
        { name: "Stal 12 L", kind: "tank", material: "steel", volume_l: 12, working_pressure_bar: 232, empty_buoyancy_kg: -1.4 },
      ],
      sets: [{ name: "Jezioro", items: ["Pianka 7 mm", "Stal 12 L"], ballast_kg: 8 }],
      sites: [{ name: "Koparki", water: "fresh" }],
    });
    expect(kit.diver).toEqual({ mass_kg: 82, height_cm: 183 });
    expect(kit.items[1]).toMatchObject({ id: "stal-12-l", volume_l: 12, working_pressure_bar: 232, empty_buoyancy_kg: -1.4 });
    expect(kit.sets[0]).toMatchObject({ id: "jezioro", item_ids: ["pianka-7-mm", "stal-12-l"], ballast_kg: 8 });

    const updated = await json("update_dive", { dive_id: 1, gear_set: "jezioro", ballast_kg: 8, weighting: "heavy" });
    expect(updated.gear).toEqual({
      gear_set: { id: "jezioro", name: "Jezioro", items: ["Pianka 7 mm", "Stal 12 L"] },
      ballast_kg: 8,
      water: { water: "fresh", density_kg_l: 1, from: "site" },
      weighting: "heavy",
    });
    expect((await json("get_dive_analysis", { dive_id: 1 })).gear.gear_set.name).toBe("Jezioro");
    expect((await json("get_kit")).sets[0].dives_with_it).toBe(1);
    expect((await call("update_dive", { dive_id: 1, gear_set: "Morze" })).text).toContain('No gear set "Morze"');
    expect((await call("update_kit", { items: [{ name: "Thing" }] })).text).toContain("needs a kind");
    expect(client.getInstructions()).toContain("update_kit");

    const estimate = await json("estimate_weighting", { gear_set: "Jezioro", site: "Koparki" });
    expect(estimate).toMatchObject({ set: { id: "jezioro" }, water: "fresh", density: 1 });
    expect(estimate.parts.map((p: { label: string }) => p.label)).toEqual(["You", "Pianka 7 mm", "Stal 12 L"]);
    expect(estimate.calibration).toEqual({ dives: 1, offset_kg: expect.any(Number) });
    expect(estimate.how_to_check).toContain("hover");
    expect((await json("estimate_weighting", { gear_set: "jezioro", water: "salt" })).density).toBe(1.025);
    const rented = await json("estimate_weighting", { gear_set: "Jezioro", water: "salt", rental_tank: "aluminium-11" });
    expect(rented.rental_tank).toBe("aluminium-11");
    expect(rented.parts.map((p: { label: string }) => p.label)).toEqual(["You", "Pianka 7 mm", "Rental aluminium 11.1 L (AL80)"]);
    expect((await call("estimate_weighting", { water: "salt", rental_tank: "steel-12" })).text).toContain("give the gear set too");
    expect((await call("estimate_weighting", { gear_set: "Morze", water: "salt" })).text).toContain('No gear set "Morze"');
    expect((await call("estimate_weighting", { gear_set: "Jezioro", site: "Dahab" })).text).toContain("isn't known");
    expect((await call("estimate_weighting", {})).text).toContain("Say the water");
    expect(client.getInstructions()).toContain("estimate_weighting");
  });

  it("prepares for a planned dive from the log", async () => {
    const prep = await json("prepare_dive", { site: "Koparki", max_depth_m: 40, gas: "EAN32", dives: 2, date: "2027-05-10" });
    expect(prep.experience).toMatchObject({ dives: 10, deepest_m: 52, deeper_than_ever: false });
    expect(prep.at_this_site.map((d: { site: string }) => d.site)).toEqual(["Koparki", "Koparki"]);
    expect(prep.gas_plan).toMatchObject({ ppo2_at_max_depth: 1.6, mod_m: 33.8, best_nitrox_percent: 27 });
    expect(prep.notes[0]).toContain("not safe at that depth");
    expect((await call("prepare_dive", { date: "10.05.2027" })).isError).toBe(true);
  });

  it("saves a trip's dive cards with the preparation, and links logged dives after the trip", async () => {
    const card = { item_id: "c1", title: "Blue Hole", day: 2, date: "2026-07-11", site: "Blue Hole", max_depth_m: 30, gas: "nitrox" };
    expect(await ok("get_trip_plans")).toContain("No trips saved yet");
    const saved = await json("save_trip_plan", {
      trip_id: "dahab-2026",
      trip_name: "Dahab",
      start_date: "2026-07-10",
      summary_markdown: "Practise stops.",
      flights: [{ date: "2026-07-14", time: "13:35", from: "SSH", to: "WAW" }],
      dives: [{ ...card, prep_markdown: "## Ready", verdict: "check", verdict_summary: "Ask for the mix." }, { item_id: "c2", title: "Canyon", date: "2026-07-12" }],
    });
    expect(saved).toMatchObject({ saved: true, dive_cards: 2, prepared: 1, to_check: ["c1"], without_prep: ["c2"] });
    expect(saved.urls).toEqual({ c1: "http://localhost:3001/trips/dahab-2026#card-c1", c2: "http://localhost:3001/trips/dahab-2026#card-c2" });
    expect(client.getInstructions()).toContain("save_dive_prep");

    // The cards again, as TripDeck has them now: c2 was removed; c1 keeps its preparation.
    const dives = await json("list_dives");
    const sameDay = dives.filter((d: { start: string }) => d.start?.startsWith("2026-07-11"));
    await ok("save_trip_plan", { trip_id: "dahab-2026", trip_name: "Dahab", dives: [card] });
    const plan = await json("get_trip_plans", { trip_id: "dahab-2026" });
    expect(plan).toMatchObject({ name: "Dahab", summary: "Practise stops.", start_date: null, flights: [{ date: "2026-07-14", time: "13:35", from: "SSH", to: "WAW" }] });
    expect(plan.cards).toHaveLength(1);
    expect(plan.cards[0]).toMatchObject({ item_id: "c1", prep: "## Ready", verdict: "check", verdict_summary: "Ask for the mix.", logged_dives: [] });
    expect(plan.cards[0].logged_that_day.map((d: { id: string }) => d.id)).toEqual(sameDay.map((d: { id: string }) => d.id));

    await ok("save_trip_plan", { trip_id: "dahab-2026", trip_name: "Dahab", dives: [{ ...card, logged_dives: [sameDay[0].seq] }] });
    const linked = (await json("get_trip_plans", { trip_id: "dahab-2026" })).cards[0];
    expect(linked.logged_dives).toEqual([{ id: sameDay[0].id, seq: sameDay[0].seq, start: sameDay[0].start, site: sameDay[0].site }]);
    expect(linked.logged_that_day).toHaveLength(sameDay.length - 1);
    expect(await json("get_trip_plans")).toEqual([expect.objectContaining({ trip_id: "dahab-2026", dive_cards: 1, prepared: 1, to_check: 1, logged_dives: 1 })]);
    expect((await call("save_trip_plan", { trip_id: "x", trip_name: "X", flights: [{ date: "2026-07-14", time: "1 pm" }], dives: [] })).isError).toBe(true);

    expect((await call("save_trip_plan", { trip_id: "../x", trip_name: "X", dives: [] })).text).toContain("Invalid trip id");
    expect((await call("save_trip_plan", { trip_id: "x", trip_name: "X", dives: [{ ...card, logged_dives: [99] }] })).text).toContain("There is no dive 99");
    expect((await call("get_trip_plans", { trip_id: "nope" })).isError).toBe(true);
    const prompt = await client.getPrompt({ name: "trip-prep", arguments: { trip: "Dahab" } });
    expect(JSON.stringify(prompt.messages)).toContain('trip \\"Dahab\\"');
  });

  it("proposes dive sites for a trip, takes the diver's choice and saves the chosen ones' profiles", async () => {
    await ok("save_trip_plan", { trip_id: "koh-tao", trip_name: "Koh Tao", dives: [] });
    const proposed = await json("propose_dive_sites", {
      trip_id: "koh-tao",
      shop: { name: "Big Blue", lat: 10.095, lng: 99.827 },
      notes_markdown: "## Big Blue's rotation",
      sites: [
        { id: "osm-node-1", name: "Chumphon Pinnacle", max_depth_m: 35, distance_km: 7.2, why: "Your deepest dives were 30 m." },
        { name: "Sail Rock", why: "A swim-through at 12 m." },
      ],
    });
    expect(proposed).toEqual({
      saved: true,
      sites: [
        { id: "osm-node-1", name: "Chumphon Pinnacle", status: "proposed" },
        { id: "sail-rock", name: "Sail Rock", status: "proposed" },
      ],
      choose_at: "http://localhost:3001/trips/koh-tao#sites",
    });
    expect((await call("save_site_profile", { trip_id: "koh-tao", site_id: "sail-rock", profile_markdown: "## Sail Rock" })).text).toContain("isn't chosen");

    expect(await json("choose_dive_sites", { trip_id: "koh-tao", chosen: ["sail-rock"] })).toEqual({
      chosen: [{ id: "sail-rock", name: "Sail Rock", has_profile: false }],
      still_proposed: ["osm-node-1"],
    });
    expect((await call("choose_dive_sites", { trip_id: "koh-tao", chosen: ["nope"] })).text).toContain('no proposed site "nope"');
    const profile = "## Sail Rock\nSource: https://example.com";
    const saved = await json("save_site_profile", { trip_id: "koh-tao", site_id: "sail-rock", profile_markdown: profile });
    expect(saved).toEqual({ saved: true, site: "Sail Rock", chosen_without_profile: [], shown_at: "http://localhost:3001/trips/koh-tao#sites" });

    const trip = await json("get_trip_plans", { trip_id: "koh-tao" });
    expect(trip.shop).toEqual({ name: "Big Blue", lat: 10.095, lng: 99.827 });
    expect(trip.site_notes).toBe("## Big Blue's rotation");
    expect(trip.sites[1]).toMatchObject({ id: "sail-rock", status: "chosen", profile });
    expect(trip.sites[0]).toMatchObject({ id: "osm-node-1", max_depth_m: 35, distance_km: 7.2, profile: null });
    expect(await json("get_trip_plans")).toEqual(expect.arrayContaining([expect.objectContaining({ trip_id: "koh-tao", sites_chosen: 1, sites_proposed: 1 })]));
    expect((await call("propose_dive_sites", { trip_id: "nope", shop: { name: "X" }, sites: [{ name: "A", why: "b" }] })).text).toContain("Save it with save_trip_plan first");

    await ok("save_trip_plan", {
      trip_id: "koh-tao",
      trip_name: "Koh Tao",
      todos: [{ text: "Ask which tanks", item_id: "c1" }],
      dives: [{ item_id: "c1", title: "Best-Of day 1", site_id: "osm-node-1" }],
    });
    const withCard = await json("get_trip_plans", { trip_id: "koh-tao" });
    expect(withCard.cards[0].site_id).toBe("osm-node-1");
    expect(withCard.todos).toEqual([{ id: "t1", text: "Ask which tanks", done: false, card: "c1", by: "companion" }]);
    expect(withCard.sites).toHaveLength(2);

    const prompt = await client.getPrompt({ name: "site-scout", arguments: { trip: "Koh Tao" } });
    expect(JSON.stringify(prompt.messages)).toContain("find_dive_sites");
    expect(client.getInstructions()).toContain("the diver chooses, you research");
  });

  it("explains when there is no Python database to migrate", async () => {
    const res = await call("migrate_from_python");
    expect(res).toEqual({ isError: true, text: expect.stringContaining("No database at") });
  });
});
