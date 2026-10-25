import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callCoachTool, type ToolContext } from "../coachTools";
import { fingerprint } from "../dive";
import { type DiveRecord, RECORD_FORMAT } from "../record";
import { mergeTripPlan } from "../trip";
import { parseUddf } from "../uddf";
import { agentAppStatus, bunPath, installReviewCommand, runsOf, shellQuote } from "./agentApps";
import { listModels, runCoach } from "./coachAgent";
import { apiKey, configPath, readSettings, select, selected, setApiKey } from "./config";
import { HttpError } from "./http";
import { isolateEnv, restoreEnv } from "../../test-env";

const ROOT = path.resolve(__dirname, "..", "..");
const saved = { ...process.env };
let home: string;

const records: DiveRecord[] = parseUddf(fs.readFileSync(path.join(ROOT, "examples", "spring-2026.uddf"))).map((dive, i) => ({
  format: RECORD_FORMAT,
  version: 1,
  id: fingerprint(dive),
  importedAt: `2026-10-24T10:00:0${i}.000Z`,
  updatedAt: "2026-10-24T10:00:00.000Z",
  source: { fileName: "spring.uddf", sha256: "0".repeat(64), uddfId: dive.uddfId },
  parserVersion: 2,
  dive,
  details: {},
  review: null,
}));
const ctx: ToolContext = { records: async () => records, dataFolder: "/data" };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-coach-"));
  for (const name of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_HOME"]) {
    delete process.env[name];
  }
  isolateEnv(home);
  delete process.env.DIVEDECK_DB;
});

afterEach(() => {
  restoreEnv(saved);
  fs.rmSync(home, { recursive: true, force: true });
});

describe("settings", () => {
  it("defaults to Claude and reads the Python version's settings file", async () => {
    expect(configPath()).toBe(path.join(home, "config.json"));
    expect(selected()).toMatchObject({ provider: { id: "anthropic" }, model: "claude-opus-5-5" });
    fs.writeFileSync(configPath(), JSON.stringify({ provider: "claude-code", models: { "claude-code": "" } }));
    expect(selected().provider.id).toBe("claude-code");
    fs.writeFileSync(configPath(), JSON.stringify({ provider: "gemini" })); // removed in #9
    expect(selected().provider.id).toBe("anthropic");
  });

  it("uses environment variables until a choice is saved", async () => {
    process.env.DIVEDECK_PROVIDER = "openai";
    process.env.DIVEDECK_MODEL = "gpt-5-mini";
    expect(selected()).toMatchObject({ provider: { id: "openai" }, model: "gpt-5-mini" });
    await select("anthropic", "claude-sonnet-5-5");
    expect(selected()).toMatchObject({ provider: { id: "anthropic" }, model: "claude-sonnet-5-5" });
    expect(readSettings()).toEqual({ provider: "anthropic", models: { anthropic: "claude-sonnet-5-5" } });
  });

  it("prefers a saved key over the environment and removes it again", async () => {
    expect(apiKey("openai")).toBeNull();
    process.env.OPENAI_API_KEY = "env-key";
    expect(apiKey("openai")).toEqual({ key: "env-key", source: "OPENAI_API_KEY" });
    await setApiKey("openai", "  saved-key-1234 ");
    expect(apiKey("openai")).toEqual({ key: "saved-key-1234", source: "saved" });
    expect(readSettings().api_keys).toEqual({ openai: "saved-key-1234" });
    await setApiKey("openai", null);
    expect(apiKey("openai")?.source).toBe("OPENAI_API_KEY");
  });
});

describe("agent apps", () => {
  const repo = "/repo";

  it("tells the Python server from the TypeScript one", () => {
    expect(runsOf({ command: "python.exe", args: ["-m", "ai_diving_monitor.mcp_server"] })).toBe("python");
    expect(runsOf({ command: "bun", args: ["/repo/mcp/server.ts"] })).toBe("typescript");
    expect(runsOf({ command: "node", args: ["other.js"] })).toBe("other");
  });

  it("gives the command to connect Claude Code, or to switch it from the Python server", () => {
    process.env.DIVEDECK_DB = "D:\\data\\dives.db";
    const fresh = agentAppStatus("claude-code", repo, home);
    expect(fresh).toMatchObject({ registered: false, runs: null, reviewCommandInstalled: false });
    expect(fresh.commands).toEqual([
      `claude mcp add --scope user divedeck -e DIVEDECK_HOME=${shellQuote(home)} -e DIVEDECK_DB=${shellQuote("D:\\data\\dives.db")} -- ${shellQuote(bunPath(home))} ${shellQuote(path.join(repo, "mcp", "server.ts"))}`,
    ]);

    const python = { command: "py", args: ["-m", "ai_diving_monitor.mcp_server"] };
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ projects: { "/x": { mcpServers: { "ai-diving-monitor": python } } } }));
    const old = agentAppStatus("claude-code", repo, home);
    expect(old).toMatchObject({ registered: true, runs: "python" });
    expect(old.commands[0]).toBe("claude mcp remove --scope user ai-diving-monitor");

    // Registered under the AI Diving Monitor name: renamed to divedeck.
    const ts = { command: "bun", args: [path.join(repo, "mcp", "server.ts")] };
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "ai-diving-monitor": ts } }));
    const renamed = agentAppStatus("claude-code", repo, home);
    expect(renamed).toMatchObject({ registered: true, runs: "typescript" });
    expect(renamed.commands[0]).toBe("claude mcp remove --scope user ai-diving-monitor");
    expect(renamed.commands[1]).toMatch(/^claude mcp add --scope user divedeck /);

    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { divedeck: ts } }));
    expect(agentAppStatus("claude-code", repo, home)).toMatchObject({ registered: true, runs: "typescript", commands: [] });
  });

  it("reads the Codex registration from config.toml", () => {
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(
      path.join(home, ".codex", "config.toml"),
      'model = "x"\n\n[mcp_servers.ai-diving-monitor]\ncommand = "C:\\\\py.exe"\nargs = ["-m", "ai_diving_monitor.mcp_server"]\n\n[other]\nx = 1\n',
    );
    expect(agentAppStatus("codex", repo, home)).toMatchObject({ registered: true, runs: "python" });
    expect(agentAppStatus("codex", repo, home).commands[0]).toBe("codex mcp remove ai-diving-monitor");
  });

  it("quotes paths for the diver's shell", () => {
    expect(shellQuote("/home/ola/ai-diving-monitor/mcp/server.ts", "linux")).toBe("/home/ola/ai-diving-monitor/mcp/server.ts");
    expect(shellQuote("/Users/Ola K/dives", "darwin")).toBe("'/Users/Ola K/dives'");
    expect(shellQuote("/tmp/it's here\\", "linux")).toBe("'/tmp/it'\\''s here\\'");
    expect(shellQuote("C:\Users\lisza\.bun\bin\bun.exe", "win32")).toBe("C:\Users\lisza\.bun\bin\bun.exe");
    expect(shellQuote("C:\Program Files\Bun\bun.exe", "win32")).toBe('"C:\Program Files\Bun\bun.exe"');
  });

  it("installs the /dive-review command", () => {
    installReviewCommand(ROOT, home);
    expect(fs.existsSync(path.join(home, ".claude", "commands", "dive-review.md"))).toBe(true);
    expect(agentAppStatus("claude-code", repo, home).reviewCommandInstalled).toBe(true);
  });
});

describe("coach tools", () => {
  it("answers like the MCP server and turns mistakes into errors the model can read", async () => {
    expect(JSON.parse(await callCoachTool("list_dives", {}, ctx))).toHaveLength(5);
    expect(await callCoachTool("get_overview", undefined, ctx)).toContain("Dive log: 5 dives");
    expect(JSON.parse(await callCoachTool("get_dive_analysis", { dive_id: 2 }, ctx))).toMatchObject({ seq: 2 });
    expect(JSON.parse(await callCoachTool("get_progress_trend", { metric: "rmv_l_min" }, ctx))).toMatchObject({ metric: "rmv_l_min" });
    expect(JSON.parse(await callCoachTool("get_dive_profile", { dive_id: 1 }, ctx))[0]).toMatchObject({ t_min: 0 });
    expect(JSON.parse(await callCoachTool("nope", {}, ctx)).error).toContain("Unknown tool");
    expect(JSON.parse(await callCoachTool("get_progress_trend", { metric: "nope" }, ctx)).error).toContain("Invalid arguments");
    expect(JSON.parse(await callCoachTool("get_dive_analysis", { dive_id: 42 }, ctx)).error).toContain("the log has 5 dives");
  });

  it("prepares for a dive and reads the saved trips", async () => {
    const prep = JSON.parse(await callCoachTool("prepare_dive", { site: "Koparki", max_depth_m: 20, gas: "air", date: "2026-06-01" }, ctx));
    expect(prep).toMatchObject({ experience: { dives: 4, days_since_last_dive: 23 }, gas_plan: { ppo2_at_max_depth: 0.63 } });
    expect(prep.at_this_site).toHaveLength(2);
    expect(JSON.parse(await callCoachTool("prepare_dive", { date: "1.6.2026" }, ctx)).error).toContain("Invalid arguments");

    expect(await callCoachTool("get_trip_plans", {}, ctx)).toContain("No trips saved yet");
    const koparki = records[1];
    const plan = mergeTripPlan(
      undefined,
      {
        id: "pl",
        name: "Poland",
        destination: "Koparki",
        summaryMarkdown: "Stops.",
        dives: [
          { itemId: "c1", title: "Koparki", date: koparki.dive.start!.slice(0, 10), maxDepthM: 20, prepMarkdown: "## Go", loggedDiveIds: ["gone"] },
          { itemId: "c2", title: "Undated" },
        ],
      },
      "2026-10-25T00:00:00.000Z",
    );
    const withTrips: ToolContext = { ...ctx, trips: async () => [plan] };
    expect(JSON.parse(await callCoachTool("get_trip_plans", {}, withTrips))).toEqual([
      { trip_id: "pl", name: "Poland", destination: "Koparki", start_date: null, end_date: null, dive_cards: 2, prepared: 1, to_check: 0, logged_dives: 1, updated_at: plan.updatedAt },
    ]);
    const full = JSON.parse(await callCoachTool("get_trip_plans", { trip_id: "pl" }, withTrips));
    expect(full).toMatchObject({ trip_id: "pl", summary: "Stops." });
    expect(full.cards[0]).toMatchObject({
      item_id: "c1",
      max_depth_m: 20,
      prep: "## Go",
      logged_dives: [{ id: "gone", missing: true }],
      logged_that_day: [{ id: koparki.id, seq: 2, start: koparki.dive.start }],
    });
    expect(full.cards[1]).toMatchObject({ item_id: "c2", prep: null, prep_saved_at: null, logged_that_day: [] });
    expect(JSON.parse(await callCoachTool("get_trip_plans", { trip_id: "x" }, withTrips)).error).toContain('No saved trip with id "x"');
  });
});

type Params = Record<string, unknown> & { tools: { name: string; run: (args: unknown) => Promise<string> }[] };

/** A stand-in for the Anthropic client: the tool runner calls two tools, then answers. */
function fakeClaude(answer: Partial<{ stop_reason: string; text: string }> = {}) {
  const seen: Params[] = [];
  const client = {
    beta: {
      messages: {
        toolRunner: async (params: Params) => {
          seen.push(params);
          const run = (name: string, args: unknown) => params.tools.find((t) => t.name === name)!.run(args);
          const dives = JSON.parse(await run("list_dives", {}));
          await run("get_dive_analysis", { dive_id: dives.length });
          return {
            stop_reason: answer.stop_reason ?? "end_turn",
            content: [{ type: "thinking", thinking: "" }, { type: "text", text: answer.text ?? `You have ${dives.length} dives.` }],
          };
        },
      },
    },
    models: { list: async function* () { yield { id: "claude-sonnet-5-5" }; yield { id: "claude-opus-5-5" }; } },
  };
  return { seen, make: () => client as unknown as Anthropic };
}

/** A stand-in for the OpenAI client: one list_dives call, then an answer built from it. */
function fakeChatGpt(finish = "stop") {
  const requests: { messages: { role: string; content?: string }[] }[] = [];
  const client = {
    chat: {
      completions: {
        create: async (body: { messages: { role: string; content?: string }[] }) => {
          requests.push(JSON.parse(JSON.stringify(body)));
          const last = body.messages[body.messages.length - 1];
          if (last.role === "tool") {
            return { choices: [{ finish_reason: finish, message: { role: "assistant", content: `You have ${JSON.parse(last.content!).length} dives.` } }] };
          }
          return {
            choices: [
              {
                finish_reason: "tool_calls",
                message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_dives", arguments: "{}" } }] },
              },
            ],
          };
        },
      },
    },
    models: { list: async function* () { yield { id: "gpt-5" }; } },
  };
  return { requests, make: () => client as unknown as OpenAI };
}

describe("runCoach", () => {
  const ask = [{ role: "user" as const, content: "How many dives?" }];

  it("runs Claude with the coach's tools, high effort and server-side fallbacks", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const { seen, make } = fakeClaude();
    expect(await runCoach("anthropic", "claude-opus-5-5", ask, ctx, { anthropic: make })).toEqual({ text: "You have 5 dives.", complete: true });
    expect(seen[0]).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "high" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    expect(seen[0].tools.map((t) => t.name)).toEqual(["list_dives", "get_overview", "get_dive_analysis", "get_dive_profile", "get_progress_trend", "prepare_dive", "get_trip_plans"]);
  });

  it("leaves fallbacks out for models without them, and marks declined or cut-off answers", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const haiku = fakeClaude();
    await runCoach("anthropic", "claude-haiku-5-5", ask, ctx, { anthropic: haiku.make });
    expect(haiku.seen[0]).not.toHaveProperty("fallbacks");
    const refused = fakeClaude({ stop_reason: "refusal" });
    expect((await runCoach("anthropic", "claude-opus-5-5", ask, ctx, { anthropic: refused.make })).complete).toBe(false);
    const cut = fakeClaude({ stop_reason: "max_tokens" });
    expect(await runCoach("anthropic", "claude-opus-5-5", ask, ctx, { anthropic: cut.make })).toEqual({ text: "You have 5 dives.\n\n_(Answer truncated.)_", complete: false });
    const empty = fakeClaude({ text: "" });
    expect((await runCoach("anthropic", "claude-opus-5-5", ask, ctx, { anthropic: empty.make })).complete).toBe(false);
  });

  it("runs ChatGPT through the same tools", async () => {
    process.env.OPENAI_API_KEY = "k";
    const { requests, make } = fakeChatGpt();
    expect(await runCoach("openai", "gpt-5", ask, ctx, { openai: make })).toEqual({ text: "You have 5 dives.", complete: true });
    expect(requests[0].messages[0].role).toBe("system");
    expect(requests[1].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    const cut = fakeChatGpt("length");
    expect((await runCoach("openai", "gpt-5", ask, ctx, { openai: cut.make })).complete).toBe(false);
  });

  it("needs a key, and doesn't run for the subscription modes", async () => {
    await expect(runCoach("anthropic", "claude-opus-5-5", ask, ctx)).rejects.toMatchObject({ status: 400 });
    await expect(runCoach("claude-code", "", ask, ctx)).rejects.toThrow(HttpError);
    await expect(runCoach("codex", "", ask, ctx)).rejects.toThrow(/runs in Codex/);
  });

  it("lists the models a key can use", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    expect(await listModels("anthropic", { anthropic: fakeClaude().make })).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(await listModels("openai", { openai: fakeChatGpt().make })).toEqual(["gpt-5"]);
    expect(await listModels("claude-code")).toEqual([]);
  });
});
