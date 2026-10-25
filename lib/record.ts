/**
 * A dive as it is stored: one JSON file per dive. It keeps what the dive computer recorded (`dive`,
 * parsed from the original UDDF file), what the diver or the coach filled in later (`details`) and
 * the coach's review. The analysis is computed when the dive is read, from the dive with the details
 * applied, so a tank volume filled in later gives the dive its gas consumption at once.
 */

import { analyzeDive, type DiveAnalysis } from "./analysis";
import { type Dive, type GasMix, gasLabel } from "./dive";
import type { Water } from "./kit";

export const RECORD_FORMAT = "ai-diving-monitor/dive";
export const RECORD_VERSION = 1;

/** What the dive computer doesn't record, filled in by the diver or the coach. */
export interface DiveDetails {
  site?: string;
  location?: string;
  buddy?: string;
  notes?: string;
  /** Volume of the main (first) tank, in litres. */
  tankVolumeL?: number;
  /** Gas in the main tank, as fractions 0..1. */
  gas?: { o2: number; he: number };
  /** The gear set dived with (an id from the kit). */
  gearSetId?: string;
  /** The lead actually carried, kg. */
  ballastKg?: number;
  /** The water, when it differs from the site's (or the site has none). */
  water?: Water;
  /** How the weighting felt: too light, right, too heavy. */
  weighting?: Weighting;
}

export type Weighting = "light" | "ok" | "heavy";

export interface Review {
  markdown: string;
  savedAt: string;
}

export interface DiveRecord {
  format: typeof RECORD_FORMAT;
  version: number;
  /** The dive's fingerprint: the same dive imported twice gets the same id. */
  id: string;
  importedAt: string;
  updatedAt: string;
  source: { fileName: string; sha256: string; uddfId: string };
  /** The parser version that read `dive`; older dives are parsed again from the original file. */
  parserVersion: number;
  dive: Dive;
  details: DiveDetails;
  review: Review | null;
  /** The dive's id in the Python version's database, when it was migrated from there. */
  legacyId?: number;
}

export const DIVER_GAS_ID = "diver-gas";

/** The dive with the diver's details applied: what the analysis and the coach work from. */
export function effectiveDive(record: DiveRecord): Dive {
  const dive: Dive = structuredClone(record.dive);
  const { details } = record;
  if (details.site !== undefined) dive.site = details.site;
  if (details.location !== undefined) dive.location = details.location;
  if (details.notes !== undefined) dive.notes = details.notes;
  if (details.tankVolumeL !== undefined || details.gas) {
    if (!dive.tanks.length) dive.tanks.push({ id: "tank1", mixId: null, volumeL: null, startBar: null, endBar: null });
    const main = dive.tanks[0];
    if (details.tankVolumeL !== undefined) main.volumeL = details.tankVolumeL;
    if (details.gas) {
      const mix: GasMix = { id: DIVER_GAS_ID, name: "", ...details.gas };
      mix.name = gasLabel(mix);
      dive.gasMixes[DIVER_GAS_ID] = mix;
      // The first sample names the starting gas; replace it unless it is a switch to another gas.
      const first = dive.samples[0];
      if (first && (first.mixRef === null || first.mixRef === main.mixId)) first.mixRef = DIVER_GAS_ID;
      main.mixId = DIVER_GAS_ID;
    }
  }
  return dive;
}

export function analyzeRecord(record: DiveRecord): DiveAnalysis {
  return analyzeDive(effectiveDive(record));
}

/** "2026-09-25 2029 Koparki (3f2a…).dive.json": sortable, readable, and found again by its id. */
export function recordFileName(record: DiveRecord): string {
  const when = record.dive.start ? record.dive.start.slice(0, 16).replace("T", " ").replace(":", "") : "undated";
  const site = (record.details.site ?? record.dive.site ?? "")
    .replace(/[^\p{L}\p{N} ._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${[when, site].filter(Boolean).join(" ")} (${record.id}).dive.json`;
}

/** Oldest first, like the Python version: by start time, then in import order. */
export function chronological(records: DiveRecord[]): DiveRecord[] {
  const key = (r: DiveRecord) => [r.dive.start ?? "", r.importedAt, r.id];
  const compare = (a: string[], b: string[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  };
  return [...records].sort((a, b) => compare(key(a), key(b)));
}

/**
 * A gas written the way divers do: "air", "EAN32", "nitrox 32", "32%", "oxygen", "Tx 18/45",
 * "trimix 18/45", "18/45". Returns fractions, or null when it can't be read.
 */
export function parseGas(text: string): { o2: number; he: number } | null {
  const t = text.trim().toLowerCase().replace(/,/g, ".");
  if (t === "air" || t === "powietrze") return { o2: 0.21, he: 0 };
  if (t === "oxygen" || t === "o2" || t === "tlen" || t === "100%") return { o2: 1, he: 0 };
  const mix = /^(?:tx|trimix|heliair|helitrox)?\s*(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d{1,2}(?:\.\d+)?)$/.exec(t);
  const nitrox = /^(?:ean|eanx|nitrox|nx)?\s*(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(t);
  const [o2, he] = mix ? [Number(mix[1]), Number(mix[2])] : nitrox ? [Number(nitrox[1]), 0] : [NaN, NaN];
  if (!(o2 >= 5 && o2 <= 100 && he >= 0 && o2 + he <= 100)) return null;
  return { o2: o2 / 100, he: he / 100 };
}

export type TodoKind = "tank-volume" | "site" | "review" | "gas";

export interface Todo {
  kind: TodoKind;
  /** Record ids. */
  dives: string[];
  /** What is missing and what filling it in gives. */
  text: string;
}

/** What is still missing in the log, most useful to fill in first ("to sort out", as in TripDeck). */
export function logTodos(records: DiveRecord[]): Todo[] {
  const dives = (pick: (r: DiveRecord, dive: Dive) => boolean) =>
    chronological(records)
      .filter((r) => pick(r, effectiveDive(r)))
      .map((r) => r.id);
  const todos: Todo[] = [
    {
      kind: "tank-volume",
      dives: dives((_, d) => d.tanks.some((t) => t.startBar && t.endBar !== null && !t.volumeL)),
      text: "Tank volume missing: gas consumption (RMV in L/min) can't be computed. Ask the diver for the tank size (e.g. 12 L, 2×12 L) and save it with update_dive.",
    },
    {
      kind: "gas",
      dives: dives((_, d) => Object.keys(d.gasMixes).length === 0),
      text: "Gas unknown: ppO2, CNS and END can't be checked. Ask which gas was breathed and save it with update_dive.",
    },
    {
      kind: "site",
      dives: dives((_, d) => !d.site),
      text: "Dive site missing. Ask where the dive was and save it with update_dive.",
    },
    {
      kind: "review",
      dives: dives((r) => r.review === null),
      text: "No debrief yet. Offer one (the dive-review prompt) and save it with save_dive_summary.",
    },
  ];
  return todos.filter((t) => t.dives.length > 0);
}
