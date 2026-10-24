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
      "get_dive_analysis", "get_dive_profile", "get_overview", "get_progress_trend", "import_uddf",
      "list_dives", "migrate_from_python", "save_dive_summary", "update_dive",
    ]);
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(["dive-review", "sort-out"]);
    expect(client.getInstructions()).toContain("save it with update_dive");
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

  it("explains when there is no Python database to migrate", async () => {
    const res = await call("migrate_from_python");
    expect(res).toEqual({ isError: true, text: expect.stringContaining("No database at") });
  });
});
