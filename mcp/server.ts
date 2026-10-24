/**
 * AI Diving Monitor MCP server: turns Claude Code / Claude Desktop (or Codex with a ChatGPT plan) into
 * your dive coach, on your own subscription. No API key needed: the client's model does the coaching,
 * this server exposes your dive log, the analytics, and tools to fill in what the computer doesn't record.
 *
 * It reads and writes the dive files in the data folder (see lib/server/paths.ts).
 *
 *   claude mcp add --scope user ai-diving-monitor -- <path-to-bun> <path-to-repo>/mcp/server.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DESCRIPTIONS,
  diveAnalysis,
  diveProfile,
  listDives,
  MCP_INSTRUCTIONS,
  overview,
  progressTrend,
  resolveDive,
  SUMMARY_REQUEST,
} from "../lib/coach";
import { analyzeRecord, chronological, parseGas } from "../lib/record";
import { DiveStore } from "../lib/server/diveStore";
import { migrateFromPython } from "../lib/server/migrate";
import { dataDir, pythonDbPath } from "../lib/server/paths";
import { UddfParseError } from "../lib/uddf";

const store = new DiveStore();
const server = new McpServer({ name: "ai-diving-monitor", title: "AI Diving Monitor", version: "0.2.0" }, { instructions: MCP_INSTRUCTIONS });

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
});

/** Errors become a tool answer the model can read and act on, not a protocol failure. */
function tool<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return text(await fn(args));
    } catch (err) {
      return { ...text(`Error: ${(err as Error).message}`), isError: true };
    }
  };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const diveRef = z
  .union([z.number().int(), z.string()])
  .describe("The dive's number in the log (1 = the oldest; `seq` in list_dives) or its id.");

async function find(ref: string | number) {
  return resolveDive(await store.list(), ref);
}

server.registerTool(
  "list_dives",
  { title: "List dives", description: DESCRIPTIONS.list_dives, annotations: READ_ONLY },
  tool(async () => listDives(await store.list())),
);

server.registerTool(
  "get_overview",
  { title: "Dive log overview", description: DESCRIPTIONS.get_overview, annotations: READ_ONLY },
  tool(async () => overview(await store.list(), dataDir())),
);

server.registerTool(
  "get_dive_analysis",
  { title: "Dive analysis", description: DESCRIPTIONS.get_dive_analysis, inputSchema: { dive_id: diveRef }, annotations: READ_ONLY },
  tool(async ({ dive_id }: { dive_id: string | number }) => {
    const { record, seq } = await find(dive_id);
    return diveAnalysis(record, seq);
  }),
);

server.registerTool(
  "get_dive_profile",
  {
    title: "Dive profile",
    description: DESCRIPTIONS.get_dive_profile,
    inputSchema: {
      dive_id: diveRef,
      interval_s: z.number().int().optional().describe("Seconds between returned points (minimum 10, default 30)."),
    },
    annotations: READ_ONLY,
  },
  tool(async ({ dive_id, interval_s }: { dive_id: string | number; interval_s?: number }) =>
    diveProfile((await find(dive_id)).record, interval_s ?? 30),
  ),
);

server.registerTool(
  "get_progress_trend",
  {
    title: "Progress trend",
    description: DESCRIPTIONS.get_progress_trend,
    inputSchema: { metric: z.string().describe("For example rmv_l_min, max_ascent_rate_m_min or score.") },
    annotations: READ_ONLY,
  },
  tool(async ({ metric }: { metric: string }) => progressTrend(await store.list(), metric)),
);

server.registerTool(
  "import_uddf",
  {
    title: "Import UDDF",
    description: DESCRIPTIONS.import_uddf,
    inputSchema: { path: z.string().min(1).describe("A .uddf file, or a folder with .uddf files.") },
    annotations: WRITES,
  },
  tool(async ({ path: target }: { path: string }) => {
    const resolved = path.resolve(target.replace(/^~(?=$|[\\/])/, process.env.HOME ?? process.env.USERPROFILE ?? "~"));
    const stat = await fs.stat(resolved).catch(() => undefined);
    if (!stat) throw new Error(`Not found: ${resolved}`);
    const files = stat.isDirectory()
      ? (await fs.readdir(resolved)).filter((n) => n.toLowerCase().endsWith(".uddf")).sort().map((n) => path.join(resolved, n))
      : [resolved];
    if (!files.length) return [{ file: resolved, error: "No .uddf files found" }];
    const results = [];
    for (const file of files) {
      try {
        const r = await store.importFile(path.basename(file), new Uint8Array(await fs.readFile(file)));
        results.push({ file, added: r.added.length, duplicates: r.duplicates.length });
      } catch (err) {
        if (!(err instanceof UddfParseError) && !(err as NodeJS.ErrnoException).code) throw err;
        results.push({ file, error: (err as Error).message });
      }
    }
    return results;
  }),
);

server.registerTool(
  "save_dive_summary",
  {
    title: "Save dive review",
    description: DESCRIPTIONS.save_dive_summary,
    inputSchema: { dive_id: diveRef, summary_markdown: z.string().min(1) },
    annotations: WRITES,
  },
  tool(async ({ dive_id, summary_markdown }: { dive_id: string | number; summary_markdown: string }) => {
    const { record, seq } = await find(dive_id);
    await store.saveReview(record.id, summary_markdown);
    return { saved: true, dive_id: record.id, seq };
  }),
);

const optionalText = (what: string) => z.string().max(2000).nullable().optional().describe(`${what}. "" or null removes it.`);

server.registerTool(
  "update_dive",
  {
    title: "Fill in dive details",
    description: DESCRIPTIONS.update_dive,
    inputSchema: {
      dive_id: diveRef,
      site: optionalText("Dive site, e.g. Koparki or Blue Hole"),
      location: optionalText("Region or country"),
      buddy: optionalText("Buddy's name"),
      notes: optionalText("The diver's notes"),
      tank_volume_l: z.number().positive().max(100).nullable().optional().describe("Water volume of the main tank in litres, e.g. 12, or 24 for twin 12s. null removes it."),
      gas: z.string().max(40).nullable().optional().describe('Gas in the main tank: "air", "EAN32", "Tx 18/45"… null removes it.'),
    },
    annotations: WRITES,
  },
  tool(async (args: {
    dive_id: string | number;
    site?: string | null;
    location?: string | null;
    buddy?: string | null;
    notes?: string | null;
    tank_volume_l?: number | null;
    gas?: string | null;
  }) => {
    const { record, seq } = await find(args.dive_id);
    let gas: { o2: number; he: number } | null | undefined = args.gas === undefined ? undefined : null;
    if (args.gas) {
      gas = parseGas(args.gas);
      if (!gas) throw new Error(`Can't read the gas "${args.gas}". Write it like air, EAN32, oxygen or Tx 18/45.`);
    }
    const updated = await store.updateDetails(record.id, {
      site: args.site,
      location: args.location,
      buddy: args.buddy,
      notes: args.notes,
      tankVolumeL: args.tank_volume_l,
      gas,
    });
    const { metrics, findings } = analyzeRecord(updated);
    return {
      updated: true,
      dive_id: updated.id,
      seq,
      details: updated.details,
      metrics: {
        gas_used_l: metrics.gasUsedL,
        rmv_l_min: metrics.rmvLMin,
        gases: metrics.gases,
        max_ppo2: metrics.maxPpo2,
        cns_percent: metrics.cnsPercent,
        score: metrics.score,
      },
      finding_titles: findings.map((f) => f.title),
    };
  }),
);

server.registerTool(
  "migrate_from_python",
  {
    title: "Migrate the Python version's log",
    description: DESCRIPTIONS.migrate_from_python,
    inputSchema: { db_path: z.string().optional().describe("The Python version's dives.db (default: AI_DIVING_MONITOR_DB or ~/.ai-diving-monitor/dives.db).") },
    annotations: WRITES,
  },
  tool(async ({ db_path }: { db_path?: string }) => {
    const database = db_path?.trim() || pythonDbPath();
    if (!(await fs.stat(database).catch(() => undefined))) throw new Error(`No database at ${database}.`);
    return { ...(await migrateFromPython(store, database)), data_folder: dataDir() };
  }),
);

server.registerPrompt(
  "dive-review",
  {
    title: "Dive review",
    description: "Coaching review of a dive (default: the latest one)",
    argsSchema: { dive: z.string().optional().describe("The dive's number in the log or its id (default: the latest)") },
  },
  async ({ dive }) => {
    const log = chronological(await store.list());
    const target = dive?.trim() || (log.length ? String(log.length) : "");
    const request = target
      ? `${SUMMARY_REQUEST.replace("{dive}", `#${target}`)}\n\nUse the ai-diving-monitor tools (get_dive_analysis, get_dive_profile, list_dives, get_progress_trend), then save the review with save_dive_summary.`
      : "My dive log is empty. Help me import my UDDF files with the import_uddf tool, or migrate my old log with migrate_from_python.";
    return { messages: [{ role: "user", content: { type: "text", text: request } }] };
  },
);

server.registerPrompt(
  "sort-out",
  { title: "Fill in what's missing", description: "Go through what the dive log is still missing and fill it in together" },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Look at my dive log with get_overview. Go through what is still missing, one dive at a time: ask me for the tank size, gas, site or buddy, save each answer with update_dive, and tell me what it changed (for example the gas consumption). Offer a review for dives that have none.",
        },
      },
    ],
  }),
);

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("AI Diving Monitor MCP server failed:", err);
  process.exit(1);
});
