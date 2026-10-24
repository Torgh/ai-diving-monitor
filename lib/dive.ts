import { formatFixed, pyFloat, pyRound } from "./py";
import { sha256Hex } from "./sha256";

/** A breathing gas. Fractions are 0..1. */
export interface GasMix {
  id: string;
  name: string;
  o2: number;
  he: number;
}

export interface Tank {
  id: string;
  mixId: string | null;
  volumeL: number | null;
  startBar: number | null;
  endBar: number | null;
}

export interface Sample {
  timeS: number;
  depthM: number;
  tempC: number | null;
  /** Pressure of the tank breathed at this moment. */
  pressureBar: number | null;
  tankRef: string | null;
  /** Set when a gas switch happens at this sample (and on the first sample: the starting gas). */
  mixRef: string | null;
  ppo2: number | null;
  /** Percent. */
  cns: number | null;
  ndlS: number | null;
  decoDepthM: number | null;
  alarms: string[];
}

export interface Dive {
  uddfId: string;
  number: number | null;
  /** Local time as written by the dive computer, ISO 8601 without a time zone (Python's isoformat). */
  start: string | null;
  site: string | null;
  location: string | null;
  maxDepthM: number;
  durationS: number;
  minTempC: number | null;
  notes: string | null;
  gasMixes: Record<string, GasMix>;
  tanks: Tank[];
  samples: Sample[];
  computer: string | null;
}

export function nitrogen(mix: GasMix): number {
  return Math.max(0, 1 - mix.o2 - mix.he);
}

/** "Air", "EAN32", "Oxygen" or "Tx 18/45". */
export function gasLabel(mix: GasMix): string {
  if (mix.he > 0) return `Tx ${pyRound(mix.o2 * 100)}/${pyRound(mix.he * 100)}`;
  if (Math.abs(mix.o2 - 0.21) < 0.005) return "Air";
  if (mix.o2 >= 0.995) return "Oxygen";
  return `EAN${pyRound(mix.o2 * 100)}`;
}

/**
 * Stable identifier used to avoid importing the same dive twice. Computed exactly as the Python
 * version does, so dives imported there are recognised.
 */
export function fingerprint(dive: Dive): string {
  let key = `${dive.start ?? ""}|${pyRound(dive.durationS)}|${pyFloat(pyRound(dive.maxDepthM, 1))}`;
  if (!dive.start) {
    key += "|" + dive.samples.slice(0, 50).map((s) => `${formatFixed(s.timeS, 0)}:${formatFixed(s.depthM, 1)}`).join("");
  }
  return sha256Hex(key).slice(0, 24);
}
