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
    client = new Client({ name: "ai-diving-monitor-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: bun!,
        args: [path.join(ROOT, "mcp", "server.ts")],
        env: { ...env, AI_DIVING_MONITOR_HOME: home, AI_DIVING_MONITOR_DB: path.join(home, "no-such.db") },
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
      "get_dive_analysis", "get_dive_profile", "get_overview", "get_progress_trend", "get_trip_plans", "import_uddf",
      "list_dives", "migrate_from_python", "prepare_dive", "save_dive_summary", "save_trip_plan", "update_dive",
    ]);
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["dive-review", "sort-out", "trip-prep"]);
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
      dives: [{ ...card, prep_markdown: "## Ready" }, { item_id: "c2", title: "Canyon", date: "2026-07-12" }],
    });
    expect(saved).toMatchObject({ saved: true, dive_cards: 2, prepared: 1, without_prep: ["c2"] });

    // The cards again, as TripDeck has them now: c2 was removed; c1 keeps its preparation.
    const dives = await json("list_dives");
    const sameDay = dives.filter((d: { start: string }) => d.start?.startsWith("2026-07-11"));
    await ok("save_trip_plan", { trip_id: "dahab-2026", trip_name: "Dahab", dives: [card] });
    const plan = await json("get_trip_plans", { trip_id: "dahab-2026" });
    expect(plan).toMatchObject({ name: "Dahab", summary: "Practise stops.", start_date: null });
    expect(plan.cards).toHaveLength(1);
    expect(plan.cards[0]).toMatchObject({ item_id: "c1", prep: "## Ready", logged_dives: [] });
    expect(plan.cards[0].logged_that_day.map((d: { id: string }) => d.id)).toEqual(sameDay.map((d: { id: string }) => d.id));

    await ok("save_trip_plan", { trip_id: "dahab-2026", trip_name: "Dahab", dives: [{ ...card, logged_dives: [sameDay[0].seq] }] });
    const linked = (await json("get_trip_plans", { trip_id: "dahab-2026" })).cards[0];
    expect(linked.logged_dives).toEqual([{ id: sameDay[0].id, seq: sameDay[0].seq, start: sameDay[0].start, site: sameDay[0].site }]);
    expect(linked.logged_that_day).toHaveLength(sameDay.length - 1);
    expect(await json("get_trip_plans")).toEqual([expect.objectContaining({ trip_id: "dahab-2026", dive_cards: 1, prepared: 1, logged_dives: 1 })]);

    expect((await call("save_trip_plan", { trip_id: "../x", trip_name: "X", dives: [] })).text).toContain("Invalid trip id");
    expect((await call("save_trip_plan", { trip_id: "x", trip_name: "X", dives: [{ ...card, logged_dives: [99] }] })).text).toContain("There is no dive 99");
    expect((await call("get_trip_plans", { trip_id: "nope" })).isError).toBe(true);
    const prompt = await client.getPrompt({ name: "trip-prep", arguments: { trip: "Dahab" } });
    expect(JSON.stringify(prompt.messages)).toContain('trip \\"Dahab\\"');
  });

  it("explains when there is no Python database to migrate", async () => {
    const res = await call("migrate_from_python");
    expect(res).toEqual({ isError: true, text: expect.stringContaining("No database at") });
  });
});
