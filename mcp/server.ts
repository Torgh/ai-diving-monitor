/**
 * DiveDeck MCP server: turns Claude Code / Claude Desktop (or Codex with a ChatGPT plan) into
 * your AI dive companion, on your own subscription. No API key needed: the client's model does the work,
 * this server exposes your dive log, the analytics, and tools to fill in what the computer doesn't record.
 *
 * It reads and writes the dive files in the data folder (see lib/server/paths.ts).
 *
 *   claude mcp add --scope user divedeck -- <path-to-bun> <path-to-repo>/mcp/server.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  camelKeys,
  DESCRIPTIONS,
  diveAnalysis,
  diveGear,
  kitAnswer,
  weightingAnswer,
  weightingInput,
  divePrep,
  diveProfile,
  listDives,
  MCP_INSTRUCTIONS,
  overview,
  progressTrend,
  resolveDive,
  snakeKeys,
  SITE_SCOUT_REQUEST,
  SUMMARY_REQUEST,
  TRIP_PREP_REQUEST,
  tripCardUrl,
  tripPlans,
  tripSitesUrl,
} from "../lib/coach";
import { analyzeRecord, chronological, parseGas } from "../lib/record";
import { findSet, KitInputError } from "../lib/kit";
import { parseKitChange } from "../lib/kitSchema";
import { DiveStore } from "../lib/server/diveStore";
import { KitStore } from "../lib/server/kitStore";
import { migrateFromPython } from "../lib/server/migrate";
import { pythonDbPath } from "../lib/server/paths";
import { findDiveSites, siteConditions } from "../lib/server/siteSources";
import { TripStore } from "../lib/server/tripStore";
import { chooseSites, proposeSites, saveSiteProfile } from "../lib/trip";
import { UddfParseError } from "../lib/uddf";

/** The log where Settings say it is stored, looked up on every call so a change applies at once. */
const store = () => new DiveStore();
const trips = () => new TripStore();
const kits = () => new KitStore();
const server = new McpServer({ name: "divedeck", title: "DiveDeck", version: "0.3.0" }, { instructions: MCP_INSTRUCTIONS });

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
/** Asks a public service on the internet (OpenStreetMap, Open-Meteo). */
const LOOKS_UP = { readOnlyHint: true, openWorldHint: true };
const diveRef = z
  .union([z.number().int(), z.string()])
  .describe("The dive's number in the log (1 = the oldest; `seq` in list_dives) or its id.");

async function find(ref: string | number) {
  return resolveDive(await store().list(), ref);
}

server.registerTool(
  "list_dives",
  { title: "List dives", description: DESCRIPTIONS.list_dives, annotations: READ_ONLY },
  tool(async () => listDives(await store().list())),
);

server.registerTool(
  "get_overview",
  { title: "Dive log overview", description: DESCRIPTIONS.get_overview, annotations: READ_ONLY },
  tool(async () => overview(await store().list(), store().backend.location)),
);

server.registerTool(
  "get_dive_analysis",
  { title: "Dive analysis", description: DESCRIPTIONS.get_dive_analysis, inputSchema: { dive_id: diveRef }, annotations: READ_ONLY },
  tool(async ({ dive_id }: { dive_id: string | number }) => {
    const { record, seq } = await find(dive_id);
    return { ...diveAnalysis(record, seq), gear: diveGear(record, await kits().get()) };
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
  tool(async ({ metric }: { metric: string }) => progressTrend(await store().list(), metric)),
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
        const r = await store().importFile(path.basename(file), new Uint8Array(await fs.readFile(file)));
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
    await store().saveReview(record.id, summary_markdown);
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
      gear_set: z.string().max(100).nullable().optional().describe("The gear set dived with, by id or name (get_kit lists them). null removes it."),
      ballast_kg: z.number().min(0).max(40).nullable().optional().describe("The lead actually carried, kg. null removes it."),
      water: z.enum(["fresh", "brackish", "salt"]).nullable().optional().describe("Only when it differs from the site's water (set that with update_kit). null removes it."),
      weighting: z.enum(["light", "ok", "heavy"]).nullable().optional().describe("How the weighting felt at the safety stop with a nearly empty tank."),
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
    gear_set?: string | null;
    ballast_kg?: number | null;
    water?: "fresh" | "brackish" | "salt" | null;
    weighting?: "light" | "ok" | "heavy" | null;
  }) => {
    const { record, seq } = await find(args.dive_id);
    const kit = await kits().get();
    let gearSetId: string | null | undefined = args.gear_set === undefined ? undefined : null;
    if (args.gear_set) {
      const set = findSet(kit, args.gear_set);
      if (!set) throw new KitInputError(`No gear set "${args.gear_set}". Sets: ${kit.sets.map((s) => s.name).join(", ") || "none yet (add one with update_kit)"}.`);
      gearSetId = set.id;
    }
    let gas: { o2: number; he: number } | null | undefined = args.gas === undefined ? undefined : null;
    if (args.gas) {
      gas = parseGas(args.gas);
      if (!gas) throw new Error(`Can't read the gas "${args.gas}". Write it like air, EAN32, oxygen or Tx 18/45.`);
    }
    const updated = await store().updateDetails(record.id, {
      site: args.site,
      location: args.location,
      buddy: args.buddy,
      notes: args.notes,
      tankVolumeL: args.tank_volume_l,
      gas,
      gearSetId,
      ballastKg: args.ballast_kg,
      water: args.water,
      weighting: args.weighting,
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
      gear: diveGear(updated, kit),
    };
  }),
);

server.registerTool(
  "get_kit",
  { title: "The diver's kit", description: DESCRIPTIONS.get_kit, inputSchema: {}, annotations: READ_ONLY },
  tool(async () => {
    const [kit, records] = await Promise.all([kits().get(), store().list()]);
    return kitAnswer(kit, records);
  }),
);

server.registerTool(
  "estimate_weighting",
  { title: "Estimate the lead", description: DESCRIPTIONS.estimate_weighting, inputSchema: weightingInput, annotations: READ_ONLY },
  tool(async (args: { gear_set?: string; water?: "fresh" | "brackish" | "salt"; site?: string; density?: number }) => {
    const [kit, records] = await Promise.all([kits().get(), store().list()]);
    return weightingAnswer(kit, records, { gearSet: args.gear_set, water: args.water, site: args.site, density: args.density });
  }),
);

const nullableNumber = (what: string) => z.number().nullable().optional().describe(what);
server.registerTool(
  "update_kit",
  {
    title: "Change the diver's kit",
    description: DESCRIPTIONS.update_kit,
    inputSchema: {
      diver: z
        .object({ mass_kg: nullableNumber("Body mass, kg."), height_cm: nullableNumber("Height, cm."), body_fat_percent: nullableNumber("Body fat, %.") })
        .optional(),
      items: z
        .array(
          z.object({
            id: z.string().optional().describe("To change an item; leave out to add one (or to change it by its name)."),
            name: z.string().optional(),
            kind: z.enum(["suit", "hood", "gloves", "boots", "bcd", "regulator", "tank", "fins", "computer", "light", "camera", "other"]).optional(),
            brand: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
            buoyancy_kg: nullableNumber("In the water: + floats, − sinks (maker's figure or weighed)."),
            weight_kg: nullableNumber("On land, kg (not its buoyancy)."),
            suit_type: z.enum(["wetsuit", "semidry", "drysuit"]).nullable().optional(),
            thickness_mm: nullableNumber("Neoprene thickness, mm (a suit's torso)."),
            thickness_limbs_mm: nullableNumber("A suit's arms and legs, when thinner (3/2 mm: 2)."),
            undergarment: z.string().nullable().optional().describe("Under a drysuit."),
            size: z.string().nullable().optional(),
            age_years: nullableNumber("How old the neoprene is (old neoprene floats less)."),
            material: z.enum(["steel", "aluminium", "carbon"]).nullable().optional(),
            volume_l: nullableNumber("Tank water volume, L."),
            working_pressure_bar: nullableNumber("Tank working pressure, bar."),
            empty_buoyancy_kg: nullableNumber("Empty tank with valve, from the maker's sheet."),
            plate: z.enum(["steel", "aluminium", "none"]).nullable().optional(),
          }),
        )
        .optional(),
      sets: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string().optional(),
            items: z.array(z.string()).optional().describe("Gear by id or name; replaces the set's list."),
            ballast_kg: nullableNumber("The lead usually carried with this set, kg."),
            water: z.enum(["fresh", "brackish", "salt"]).nullable().optional(),
            notes: z.string().nullable().optional(),
          }),
        )
        .optional(),
      sites: z
        .array(z.object({ name: z.string(), water: z.enum(["fresh", "brackish", "salt"]).nullable(), density: nullableNumber("kg/L, e.g. 1.03 for the Red Sea.") }))
        .optional(),
      remove: z.object({ items: z.array(z.string()).optional(), sets: z.array(z.string()).optional() }).optional(),
    },
    annotations: WRITES,
  },
  tool(async (args: Record<string, unknown>) => {
    const kit = await kits().update(parseKitChange(camelKeys(args)));
    return snakeKeys(kit);
  }),
);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const gasText = z.string().max(40).describe('"air", "nitrox", "trimix" (as TripDeck has it) or the mix: "EAN32", "Tx 18/45".');

server.registerTool(
  "prepare_dive",
  {
    title: "Prepare for a dive",
    description: DESCRIPTIONS.prepare_dive,
    inputSchema: {
      site: z.string().max(200).optional().describe("Dive site, e.g. Blue Hole."),
      location: z.string().max(200).optional().describe("Region or country."),
      max_depth_m: z.number().positive().max(200).optional().describe("Planned maximum depth in metres."),
      gas: gasText.optional(),
      dives: z.number().int().min(1).max(10).optional().describe("Dives in the outing, e.g. 2 for a two-tank boat trip."),
      date: isoDate.optional().describe("The day of the dive, YYYY-MM-DD (default: today)."),
    },
    annotations: READ_ONLY,
  },
  tool(async (args: { site?: string; location?: string; max_depth_m?: number; gas?: string; dives?: number; date?: string }) =>
    divePrep(await store().list(), {
      site: args.site,
      location: args.location,
      maxDepthM: args.max_depth_m,
      gas: args.gas,
      dives: args.dives,
      date: args.date,
    }),
  ),
);

const tripCard = z.object({
  item_id: z.string().min(1).max(64).describe("The card's id in TripDeck."),
  title: z.string().max(200),
  day: z.number().int().min(1).optional().describe("Trip day, 1 = the first."),
  date: isoDate.optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("HH:MM"),
  site: z.string().max(200).optional(),
  center: z.string().max(200).optional().describe("Dive centre."),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  max_depth_m: z.number().positive().max(200).optional(),
  gas: gasText.optional(),
  dives: z.number().int().min(1).max(10).optional(),
  prep_markdown: z.string().max(20000).optional().describe('Your preparation for this dive. Omit to keep the saved one; "" removes it.'),
  verdict: z
    .enum(["ready", "check", ""])
    .optional()
    .describe('The verdict you also save on the TripDeck card: ready, or check when something is still to sort out. Omit to keep the saved one; "" removes it.'),
  verdict_summary: z.string().max(300).optional().describe("The verdict in one line, as on the TripDeck card."),
  logged_dives: z
    .array(z.union([z.number().int(), z.string()]))
    .max(20)
    .optional()
    .describe("Logged dives this card turned into (numbers or ids). Omit to keep the saved links."),
});

server.registerTool(
  "save_trip_plan",
  {
    title: "Save trip preparation",
    description: DESCRIPTIONS.save_trip_plan,
    inputSchema: {
      trip_id: z.string().min(1).max(64).describe("The trip's id in TripDeck."),
      trip_name: z.string().min(1).max(200),
      destination: z.string().max(200).optional(),
      start_date: isoDate.optional(),
      end_date: isoDate.optional(),
      summary_markdown: z.string().max(20000).optional().describe('Notes for the whole trip. Omit to keep the saved ones; "" removes them.'),
      flights: z
        .array(
          z.object({
            date: isoDate,
            time: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Departure, HH:MM local time, as on the ticket."),
            from: z.string().max(100).optional(),
            to: z.string().max(100).optional(),
          }),
        )
        .max(20)
        .optional()
        .describe("The trip's flights from TripDeck (its transport cards). Omit to keep the saved ones; [] removes them."),
      dives: z.array(tripCard).max(100).describe("Every dive card of the trip."),
    },
    annotations: WRITES,
  },
  tool(async (args: {
    trip_id: string;
    trip_name: string;
    destination?: string;
    start_date?: string;
    end_date?: string;
    summary_markdown?: string;
    flights?: { date: string; time?: string; from?: string; to?: string }[];
    dives: z.infer<typeof tripCard>[];
  }) => {
    const records = await store().list();
    const target = trips();
    const plan = await target.save({
      id: args.trip_id,
      name: args.trip_name,
      destination: args.destination,
      startDate: args.start_date,
      endDate: args.end_date,
      summaryMarkdown: args.summary_markdown,
      flights: args.flights,
      dives: args.dives.map((c) => ({
        itemId: c.item_id,
        title: c.title,
        day: c.day,
        date: c.date,
        startTime: c.start_time,
        site: c.site,
        center: c.center,
        lat: c.lat,
        lng: c.lng,
        maxDepthM: c.max_depth_m,
        gas: c.gas,
        dives: c.dives,
        prepMarkdown: c.prep_markdown,
        verdict: c.verdict,
        verdictSummary: c.verdict_summary,
        loggedDiveIds: c.logged_dives?.map((ref) => resolveDive(records, ref).record.id),
      })),
    });
    return {
      saved: true,
      trip_id: plan.id,
      dive_cards: plan.dives.length,
      prepared: plan.dives.filter((d) => d.prep).length,
      to_check: plan.dives.filter((d) => d.verdict?.status === "check").map((d) => d.itemId),
      without_prep: plan.dives.filter((d) => !d.prep).map((d) => d.itemId),
      // For TripDeck's save_dive_prep: where each card's preparation opens.
      urls: Object.fromEntries(plan.dives.map((d) => [d.itemId, tripCardUrl(plan.id, d.itemId)])),
      stored_in: target.backend.location,
    };
  }),
);

server.registerTool(
  "get_trip_plans",
  {
    title: "Saved trips",
    description: DESCRIPTIONS.get_trip_plans,
    inputSchema: { trip_id: z.string().max(64).optional().describe("A trip's id, for its cards in full.") },
    annotations: READ_ONLY,
  },
  tool(async ({ trip_id }: { trip_id?: string }) => tripPlans(await trips().list(), await store().list(), trip_id?.trim() || undefined)),
);

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

server.registerTool(
  "find_dive_sites",
  {
    title: "Dive sites near a place",
    description: DESCRIPTIONS.find_dive_sites,
    inputSchema: {
      lat: lat.describe("The dive shop's latitude."),
      lng: lng.describe("The dive shop's longitude."),
      radius_km: z.number().min(1).max(150).optional().describe("How far the boats go, km (default 30)."),
      limit: z.number().int().min(1).max(200).optional().describe("At most this many, the nearest first (default 60)."),
    },
    annotations: LOOKS_UP,
  },
  tool(async (args: { lat: number; lng: number; radius_km?: number; limit?: number }) => {
    const sites = await findDiveSites(args.lat, args.lng, args.radius_km ?? 30);
    return {
      found: sites.length,
      source: "OpenStreetMap contributors (ODbL), mapped by volunteers: confirm depths with another source.",
      sites: sites.slice(0, args.limit ?? 60).map((s) => snakeKeys(s)),
    };
  }),
);

const siteProposal = z.object({
  id: z.string().max(80).optional().describe("The id from find_dive_sites (osm-…); leave out for a site OpenStreetMap doesn't have."),
  name: z.string().min(1).max(200),
  lat: lat.optional(),
  lng: lng.optional(),
  distance_km: z.number().min(0).max(1000).optional().describe("From the dive shop."),
  min_depth_m: z.number().min(0).max(200).optional(),
  max_depth_m: z.number().positive().max(200).optional(),
  type: z.string().max(40).optional().describe("reef, wreck, wall, pinnacle…"),
  entry: z.string().max(40).optional().describe("boat or shore."),
  source: z.string().max(500).optional().describe("Where its facts come from: its OpenStreetMap page or a web page."),
  why: z.string().min(1).max(400).describe("One line: why it suits the diver, or what it would take."),
});

server.registerTool(
  "propose_dive_sites",
  {
    title: "Propose dive sites for a trip",
    description: DESCRIPTIONS.propose_dive_sites,
    inputSchema: {
      trip_id: z.string().min(1).max(64).describe("The trip's id in TripDeck."),
      shop: z.object({ name: z.string().min(1).max(200), lat: lat.optional(), lng: lng.optional() }).describe("The dive shop the trip dives from."),
      sites: z.array(siteProposal).min(1).max(40),
      notes_markdown: z
        .string()
        .max(20000)
        .optional()
        .describe("What you weighed for the list as a whole: the shop's schedule and packages, the season, the diver's log, with sources. Omit to keep the saved notes; \"\" removes them."),
    },
    annotations: WRITES,
  },
  tool(async (args: { trip_id: string; shop: { name: string; lat?: number; lng?: number }; sites: z.infer<typeof siteProposal>[]; notes_markdown?: string }) => {
    const plan = await trips().update(args.trip_id, (p) =>
      proposeSites(
        p,
        args.shop,
        args.sites.map((s) => ({
          id: s.id,
          name: s.name,
          lat: s.lat,
          lng: s.lng,
          distanceKm: s.distance_km,
          minDepthM: s.min_depth_m,
          maxDepthM: s.max_depth_m,
          type: s.type,
          entry: s.entry,
          source: s.source,
          why: s.why,
        })),
        args.notes_markdown === undefined ? undefined : { markdown: args.notes_markdown, now: new Date().toISOString() },
      ),
    );
    return {
      saved: true,
      sites: (plan.sites ?? []).map((s) => ({ id: s.id, name: s.name, status: s.status })),
      choose_at: tripSitesUrl(plan.id),
    };
  }),
);

server.registerTool(
  "choose_dive_sites",
  {
    title: "Choose dive sites",
    description: DESCRIPTIONS.choose_dive_sites,
    inputSchema: {
      trip_id: z.string().min(1).max(64),
      chosen: z.array(z.string()).max(40).optional().describe("Site ids the diver chose."),
      dropped: z.array(z.string()).max(40).optional().describe("Site ids the diver doesn't want."),
      proposed: z.array(z.string()).max(40).optional().describe("Site ids back to undecided."),
    },
    annotations: WRITES,
  },
  tool(async (args: { trip_id: string; chosen?: string[]; dropped?: string[]; proposed?: string[] }) => {
    const plan = await trips().update(args.trip_id, (p) => chooseSites(p, { chosen: args.chosen, dropped: args.dropped, proposed: args.proposed }));
    const sites = plan.sites ?? [];
    return {
      chosen: sites.filter((s) => s.status === "chosen").map((s) => ({ id: s.id, name: s.name, has_profile: !!s.profile })),
      still_proposed: sites.filter((s) => s.status === "proposed").map((s) => s.id),
    };
  }),
);

server.registerTool(
  "save_site_profile",
  {
    title: "Save a dive site's profile",
    description: DESCRIPTIONS.save_site_profile,
    inputSchema: {
      trip_id: z.string().min(1).max(64),
      site_id: z.string().min(1).max(80),
      profile_markdown: z.string().max(20000).describe("The profile with its sources as links."),
    },
    annotations: WRITES,
  },
  tool(async (args: { trip_id: string; site_id: string; profile_markdown: string }) => {
    let name = "";
    const plan = await trips().update(args.trip_id, (p) => {
      name = saveSiteProfile(p, args.site_id, args.profile_markdown, new Date().toISOString()).name;
    });
    return {
      saved: true,
      site: name,
      chosen_without_profile: (plan.sites ?? []).filter((s) => s.status === "chosen" && !s.profile).map((s) => s.id),
      shown_at: tripSitesUrl(plan.id),
    };
  }),
);

server.registerTool(
  "get_site_conditions",
  {
    title: "The sea at a dive site",
    description: DESCRIPTIONS.get_site_conditions,
    inputSchema: {
      lat,
      lng,
      start_date: isoDate.optional().describe("The first day, YYYY-MM-DD (default: today)."),
      days: z.number().int().min(1).max(16).optional().describe("How many days (default 3)."),
    },
    annotations: LOOKS_UP,
  },
  tool(async (args: { lat: number; lng: number; start_date?: string; days?: number }) => {
    const today = new Date().toISOString().slice(0, 10);
    const found = await siteConditions(args.lat, args.lng, args.start_date ?? today, args.days ?? 3, today);
    return {
      source: "Open-Meteo marine forecast (surface figures; not the current at depth)",
      note: found.note,
      days: found.days.map((d) => snakeKeys(d)),
    };
  }),
);

server.registerTool(
  "migrate_from_python",
  {
    title: "Migrate the Python version's log",
    description: DESCRIPTIONS.migrate_from_python,
    inputSchema: { db_path: z.string().optional().describe("The Python version's dives.db (default: DIVEDECK_DB or ~/.ai-diving-monitor/dives.db).") },
    annotations: WRITES,
  },
  tool(async ({ db_path }: { db_path?: string }) => {
    const database = db_path?.trim() || pythonDbPath();
    if (!(await fs.stat(database).catch(() => undefined))) throw new Error(`No database at ${database}.`);
    const target = store();
    return { ...(await migrateFromPython(target, database)), stored_in: target.backend.location };
  }),
);

server.registerPrompt(
  "dive-review",
  {
    title: "Dive review",
    description: "Debrief of a dive (default: the latest one)",
    argsSchema: { dive: z.string().optional().describe("The dive's number in the log or its id (default: the latest)") },
  },
  async ({ dive }) => {
    const log = chronological(await store().list());
    const target = dive?.trim() || (log.length ? String(log.length) : "");
    const request = target
      ? `${SUMMARY_REQUEST.replace("{dive}", `#${target}`)}\n\nUse the divedeck tools (get_dive_analysis, get_dive_profile, list_dives, get_progress_trend), then save the review with save_dive_summary.`
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

server.registerPrompt(
  "trip-prep",
  {
    title: "Prepare for a trip",
    description: "Get ready for the dives of a TripDeck trip, from your own dive log",
    argsSchema: { trip: z.string().optional().describe("The trip's name or id in TripDeck (default: the next trip with dives)") },
  },
  ({ trip }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: TRIP_PREP_REQUEST.replace("{trip}", trip?.trim() ? `"${trip.trim()}"` : "(the next one with dives)") },
      },
    ],
  }),
);

server.registerPrompt(
  "site-scout",
  {
    title: "Choose dive sites",
    description: "Dive sites around your trip's dive shop: you choose, then each chosen one is researched",
    argsSchema: { trip: z.string().optional().describe("The trip's name or id in TripDeck (default: the next trip)") },
  },
  ({ trip }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: SITE_SCOUT_REQUEST.replace("{trip}", trip?.trim() ? `"${trip.trim()}"` : "(the next one)") },
      },
    ],
  }),
);

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("DiveDeck MCP server failed:", err);
  process.exit(1);
});
