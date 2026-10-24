/**
 * The read-only tools the in-app coach uses, shared by the Claude and the ChatGPT loop: the same
 * names and answers as the MCP server's tools, so the coach works the same way everywhere.
 */

import { z } from "zod";
import { DESCRIPTIONS, diveAnalysis, diveProfile, listDives, METRIC_NAMES, overview, progressTrend, resolveDive } from "./coach";
import type { DiveRecord } from "./record";

const diveRef = z
  .union([z.number().int(), z.string()])
  .describe("The dive's number in the log (1 = the oldest; `seq` in list_dives) or its id.");

export interface ToolContext {
  records: () => Promise<DiveRecord[]>;
  dataFolder: string;
}

export interface CoachTool {
  name: string;
  description: string;
  schema: z.ZodObject;
  run: (args: never, ctx: ToolContext) => Promise<unknown>;
}

const tool = <S extends z.ZodObject>(t: { name: string; description: string; schema: S; run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown> }) =>
  t as unknown as CoachTool;

export const COACH_TOOLS: CoachTool[] = [
  tool({
    name: "list_dives",
    description: DESCRIPTIONS.list_dives,
    schema: z.object({}),
    run: async (_, ctx) => listDives(await ctx.records()),
  }),
  tool({
    name: "get_overview",
    description: DESCRIPTIONS.get_overview,
    schema: z.object({}),
    run: async (_, ctx) => overview(await ctx.records(), ctx.dataFolder),
  }),
  tool({
    name: "get_dive_analysis",
    description: DESCRIPTIONS.get_dive_analysis,
    schema: z.object({ dive_id: diveRef }),
    run: async ({ dive_id }, ctx) => {
      const { record, seq } = resolveDive(await ctx.records(), dive_id);
      return diveAnalysis(record, seq);
    },
  }),
  tool({
    name: "get_dive_profile",
    description: DESCRIPTIONS.get_dive_profile,
    schema: z.object({
      dive_id: diveRef,
      interval_s: z.number().int().optional().describe("Seconds between returned points (minimum 10, default 30)."),
    }),
    run: async ({ dive_id, interval_s }, ctx) => diveProfile(resolveDive(await ctx.records(), dive_id).record, interval_s ?? 30),
  }),
  tool({
    name: "get_progress_trend",
    description: DESCRIPTIONS.get_progress_trend,
    schema: z.object({ metric: z.enum(Object.keys(METRIC_NAMES) as [string, ...string[]]) }),
    run: async ({ metric }, ctx) => progressTrend(await ctx.records(), metric),
  }),
];

/**
 * Runs a tool for the model. Arguments are checked against the tool's schema first, and errors come
 * back as a JSON `{ error }` the model can read and correct, never as an exception.
 */
export async function callCoachTool(name: string, args: unknown, ctx: ToolContext): Promise<string> {
  const found = COACH_TOOLS.find((t) => t.name === name);
  if (!found) return JSON.stringify({ error: `Unknown tool ${name}` });
  const parsed = found.schema.safeParse(args ?? {});
  if (!parsed.success) return JSON.stringify({ error: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}` });
  try {
    const result = await found.run(parsed.data as never, ctx);
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}
