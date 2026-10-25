/**
 * The read-only tools the in-app coach uses, shared by the Claude and the ChatGPT loop: the same
 * names and answers as the MCP server's tools, so the coach works the same way everywhere.
 */

import { z } from "zod";
import {
  DESCRIPTIONS,
  diveAnalysis,
  diveGear,
  divePrep,
  diveProfile,
  kitAnswer,
  listDives,
  METRIC_NAMES,
  overview,
  progressTrend,
  resolveDive,
  tripPlans,
  weightingAnswer,
  weightingInput,
} from "./coach";
import { emptyKit, type Kit } from "./kit";
import type { DiveRecord } from "./record";
import type { TripPlan } from "./trip";

const diveRef = z
  .union([z.number().int(), z.string()])
  .describe("The dive's number in the log (1 = the oldest; `seq` in list_dives) or its id.");

export interface ToolContext {
  records: () => Promise<DiveRecord[]>;
  /** The saved trips (none when not given). */
  trips?: () => Promise<TripPlan[]>;
  /** The diver's kit (empty when not given). */
  kit?: () => Promise<Kit>;
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
      return { ...diveAnalysis(record, seq), gear: diveGear(record, (await ctx.kit?.()) ?? emptyKit()) };
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
  tool({
    name: "prepare_dive",
    description: DESCRIPTIONS.prepare_dive,
    schema: z.object({
      site: z.string().max(200).optional(),
      location: z.string().max(200).optional(),
      max_depth_m: z.number().positive().max(200).optional(),
      gas: z.string().max(40).optional().describe('"air", "nitrox", "trimix" or the mix: "EAN32", "Tx 18/45".'),
      dives: z.number().int().min(1).max(10).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
    }),
    run: async (a, ctx) =>
      divePrep(await ctx.records(), { site: a.site, location: a.location, maxDepthM: a.max_depth_m, gas: a.gas, dives: a.dives, date: a.date }),
  }),
  tool({
    name: "get_trip_plans",
    description: DESCRIPTIONS.get_trip_plans,
    schema: z.object({ trip_id: z.string().max(64).optional() }),
    run: async ({ trip_id }, ctx) => tripPlans((await ctx.trips?.()) ?? [], await ctx.records(), trip_id?.trim() || undefined),
  }),
  tool({
    name: "get_kit",
    description: DESCRIPTIONS.get_kit,
    schema: z.object({}),
    run: async (_, ctx) => kitAnswer((await ctx.kit?.()) ?? emptyKit(), await ctx.records()),
  }),
  tool({
    name: "estimate_weighting",
    description: DESCRIPTIONS.estimate_weighting,
    schema: z.object(weightingInput),
    run: async (a, ctx) =>
      weightingAnswer((await ctx.kit?.()) ?? emptyKit(), await ctx.records(), { gearSet: a.gear_set, water: a.water, site: a.site, density: a.density }),
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
