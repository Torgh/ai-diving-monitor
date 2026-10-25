/**
 * How much lead a diver needs with a gear set in a given water: neutral at the safety stop (5 m) with
 * an empty BCD, a normal breath and the tank down to its reserve. Each part's buoyancy is estimated
 * from what the kit says (a measured figure always wins), then corrected by the diver's own dives: the
 * lead they carried and how it felt. A planning aid, not a replacement for a weight check in the water.
 */

import type { DiveRecord } from "./record";
import { effectiveDive } from "./record";
import { type GearItem, type GearSet, type Kit, WATER_DENSITY, type Water, waterOf } from "./kit";

/** kg/L. Body fat and fat-free mass (Siri), neoprene's solid rubber, lead. */
const FAT_DENSITY = 0.9007;
const LEAN_DENSITY = 1.1;
const RUBBER_DENSITY = 1.23;
const LEAD_DENSITY = 11.34;
/** Air at the surface, kg/L. */
const AIR_KG_PER_L = 0.001225;
/** Share of a wetsuit's foam that is gas when new; old neoprene loses some of it. */
const FOAM_GAS = 0.75;
const FOAM_LOSS_PER_YEAR = 0.03;
const FOAM_LOSS_MAX = 0.3;
/** The weight check: the safety stop, the tank at its reserve. */
export const CHECK_DEPTH_M = 5;
export const RESERVE_BAR = 50;
/** Height when it isn't known (for the body's surface and the lungs), flagged as assumed. */
const DEFAULT_HEIGHT_CM = 175;
/** Body fat when it isn't known, flagged as assumed. */
const DEFAULT_BODY_FAT = 0.2;
/** How much a dive's feeling moves the lead it should have had, kg. */
const FEEL_KG = { light: 1.5, ok: 0, heavy: -1.5 } as const;

/** A full suit's 80 %: the torso's share, and the arms' and legs'. */
const TORSO = 0.35;
const LIMBS = 0.45;
/** Share of the body's surface each piece of neoprene covers. */
const COVER: Partial<Record<GearItem["kind"], number>> = { suit: 0.8, hood: 0.06, gloves: 0.05, boots: 0.06 };

export interface Part {
  label: string;
  /** The piece of gear; none for the diver. */
  itemId?: string;
  /** Buoyancy at the check: positive floats, negative sinks. */
  kg: number;
  /** Taken from a typical value, not from the diver's kit. */
  assumed: boolean;
  /** Yours, a typical figure, or not known at all (a camera housing can float a kilogram or more). */
  status: "yours" | "typical" | "unknown";
  why: string;
}

export interface Confidence {
  level: "low" | "medium" | "high";
  /** 0–100, for a meter. */
  score: number;
  reasons: string[];
}

export interface WeightingEstimate {
  set: { id: string; name: string } | null;
  water: Water;
  density: number;
  /** Lead to carry, rounded to 0.5 kg; null without the diver's body mass. */
  leadKg: number | null;
  /** Before rounding and before the diver's own correction; negative when the kit alone sinks. */
  modelKg: number | null;
  parts: Part[];
  /** From the diver's dives with this kind of kit: how far the model was off, on average. */
  calibration: { dives: number; offsetKg: number } | null;
  /** What would make the estimate better, most useful first. */
  missing: string[];
  confidence: Confidence;
}

const round = (v: number, step = 0.1) => Math.round(v / step) * step;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Mosteller: body surface area, m², from height (cm) and mass (kg). */
export const bodySurface = (heightCm: number, massKg: number) => Math.sqrt((heightCm * massKg) / 3600);

/** Average air in the lungs while breathing from a regulator, L: the functional residual capacity by height, plus half a breath. */
const lungAir = (heightCm: number) => Math.max(2.2, 0.035 * heightCm - 3);

/** Neoprene: foam whose gas shrinks with pressure (Boyle), on part of the body's surface. */
function neoprene(item: GearItem, surfaceM2: number, density: number, pressureBar: number, heightAssumed: boolean): Part | null {
  const cover = COVER[item.kind];
  if (!cover || !item.thicknessMm) return null;
  // m² × mm = L; a 3/2 suit has its torso and its limbs at different thicknesses.
  const split = item.kind === "suit" && item.thicknessLimbsMm !== undefined;
  const volumeL = split ? surfaceM2 * (TORSO * item.thicknessMm + LIMBS * item.thicknessLimbsMm!) : surfaceM2 * cover * item.thicknessMm;
  const gas = FOAM_GAS * (1 - Math.min(FOAM_LOSS_MAX, (item.ageYears ?? 0) * FOAM_LOSS_PER_YEAR));
  const mass = volumeL * (1 - gas) * RUBBER_DENSITY;
  const squeezed = volumeL * (1 - gas) + (volumeL * gas) / pressureBar;
  return {
    label: item.name,
    itemId: item.id,
    kg: squeezed * density - mass,
    assumed: heightAssumed,
    status: heightAssumed ? "typical" : "yours",
    why:
      `${split ? `${item.thicknessMm} mm torso, ${item.thicknessLimbsMm} mm limbs` : `${item.thicknessMm} mm neoprene on about ${Math.round(cover * 100)} % of your body`}` +
      `${item.ageYears ? `, ${item.ageYears} years old` : ""}, squeezed at ${CHECK_DEPTH_M} m`,
  };
}

/** One piece of gear's buoyancy at the check. */
function part(item: GearItem, surfaceM2: number | null, density: number, pressureBar: number, heightAssumed: boolean): Part {
  if (item.kind === "tank") {
    const volume = item.volumeL;
    const empty =
      item.emptyBuoyancyKg ?? (volume ? (item.material === "aluminium" ? 0.16 : item.material === "carbon" ? 0.25 : -0.12) * volume : null);
    const gas = volume ? volume * RESERVE_BAR * AIR_KG_PER_L : 0;
    return {
      label: item.name,
      itemId: item.id,
      kg: (empty ?? -1.5) - gas,
      assumed: item.emptyBuoyancyKg === undefined,
      status: item.emptyBuoyancyKg === undefined ? "typical" : "yours",
      why:
        `${item.emptyBuoyancyKg !== undefined ? "empty, from your kit" : `empty, typical for ${item.material ?? "a"} ${volume ?? "?"} L tank`}` +
        (volume ? `, with ${r1(gas)} kg of gas left at ${RESERVE_BAR} bar` : ""),
    };
  }
  const typical = (kg: number, why: string): Part => ({ label: item.name, itemId: item.id, kg, assumed: true, status: "typical", why });
  if (item.buoyancyKg !== undefined) return { label: item.name, itemId: item.id, kg: item.buoyancyKg, assumed: false, status: "yours", why: "measured, from your kit" };
  if (item.kind === "suit" && item.suitType === "drysuit") {
    const thick = /thick|heavy|400|300|gruby/i.test(item.undergarment ?? "");
    return typical(thick ? 7 : 4, `a drysuit with ${thick ? "a thick" : "a light"} undergarment, typical air in it`);
  }
  if (COVER[item.kind] && surfaceM2) {
    const n = neoprene(item, surfaceM2, density, pressureBar, heightAssumed);
    if (n) return n;
  }
  if (item.kind === "bcd") {
    const kg = item.plate === "steel" ? -2.5 : item.plate === "aluminium" ? -1 : 1;
    return typical(kg, item.plate === "steel" ? "a steel backplate" : item.plate === "aluminium" ? "an aluminium backplate" : "a jacket's padding");
  }
  if (item.kind === "regulator") return typical(-1, "a typical regulator set");
  // Housings and lights can float or sink by a kilogram or more; small things are about 0.
  if (item.kind === "camera" || item.kind === "light") return { label: item.name, itemId: item.id, kg: 0, assumed: true, status: "unknown", why: "not known: weigh it in water" };
  return typical(0, "small, about 0 in the water");
}

/** The model alone: everything that floats or sinks, without the lead. */
export function estimateParts(kit: Kit, set: GearSet | null, density: number): { parts: Part[]; missing: string[] } {
  const { massKg, heightCm, bodyFatPercent } = kit.diver;
  const pressure = 1 + CHECK_DEPTH_M / 10;
  // Without a height, a typical one: the neoprene still counts, flagged as assumed.
  const surface = massKg ? bodySurface(heightCm ?? DEFAULT_HEIGHT_CM, massKg) : null;
  const parts: Part[] = [];
  const missing: string[] = [];
  if (massKg) {
    const fat = (bodyFatPercent ?? DEFAULT_BODY_FAT * 100) / 100;
    const bodyDensity = 1 / (fat / FAT_DENSITY + (1 - fat) / LEAN_DENSITY);
    const lungs = lungAir(heightCm ?? DEFAULT_HEIGHT_CM);
    const youAssumed = bodyFatPercent === undefined || heightCm === undefined;
    parts.push({
      label: "You",
      kg: (massKg / bodyDensity) * density - massKg + lungs * density,
      assumed: youAssumed,
      status: youAssumed ? "typical" : "yours",
      why: `${massKg} kg at ${Math.round(fat * 100)} % body fat${bodyFatPercent === undefined ? " (assumed)" : ""}, with about ${r1(lungs)} L of air in your lungs`,
    });
  } else missing.push("your body mass");
  if (bodyFatPercent === undefined) missing.push("your body fat (it moves the estimate by about 1 kg per 5 %)");
  if (heightCm === undefined) missing.push("your height (for your suit's area and your lungs)");

  const items = set ? set.itemIds.map((id) => kit.items.find((i) => i.id === id)).filter((i): i is GearItem => !!i) : [];
  for (const item of items) parts.push(part(item, surface, density, pressure, heightCm === undefined));
  if (!items.some((i) => i.kind === "suit")) missing.push("the suit you dive in");
  if (!items.some((i) => i.kind === "tank")) missing.push("the tank");
  for (const item of items) {
    if (item.kind === "tank" && item.emptyBuoyancyKg === undefined) missing.push(`${item.name}: its empty buoyancy from the maker's sheet`);
    if (item.kind === "suit" && item.suitType !== "drysuit" && !item.thicknessMm) missing.push(`${item.name}: its neoprene thickness`);
    if (item.kind === "camera" && item.buoyancyKg === undefined) missing.push(`${item.name}: its buoyancy (housings often float by a kilogram or more)`);
  }
  return { parts, missing };
}

/** Lead for this much buoyancy; negative when the diver would sink without any (clamped only at the end, so a correction keeps the difference between waters). */
const leadFor = (buoyancy: number, density: number) => buoyancy / (1 - density / LEAD_DENSITY);

/** What each logged dive says the lead should have been, against what the model says for it. */
function calibrate(kit: Kit, records: DiveRecord[], forSet: GearSet | null): WeightingEstimate["calibration"] {
  const offsets: number[] = [];
  for (const r of records) {
    const { gearSetId, ballastKg, weighting } = r.details;
    if (!gearSetId || ballastKg === undefined || !weighting) continue;
    const set = kit.sets.find((s) => s.id === gearSetId);
    const water = waterOf(kit, r.details, effectiveDive(r).site);
    if (!set || !water) continue;
    // The same set counts; another set counts too when it shares the suit (the biggest part).
    const suitOf = (s: GearSet) => s.itemIds.find((id) => kit.items.find((i) => i.id === id)?.kind === "suit");
    if (forSet && set.id !== forSet.id && suitOf(set) !== suitOf(forSet)) continue;
    const { parts } = estimateParts(kit, set, water.density);
    const model = leadFor(parts.reduce((s, p) => s + p.kg, 0), water.density);
    offsets.push(ballastKg + FEEL_KG[weighting] - model);
  }
  if (!offsets.length) return null;
  return { dives: offsets.length, offsetKg: r1(offsets.reduce((a, b) => a + b, 0) / offsets.length) };
}

/**
 * How far to trust the number: a missing tank, typical figures (the bigger, the less), unknown ones
 * and no dives to correct it all take some away.
 */
export function confidenceOf(parts: Part[], hasTank: boolean, calibration: WeightingEstimate["calibration"]): Confidence {
  let score = 100;
  const reasons: string[] = [];
  if (!hasTank) {
    score -= 35;
    reasons.push("no tank in the set");
  }
  // Small things taken as about 0 kg don't move the number enough to count.
  const typical = parts.filter((p) => p.status === "typical" && p.kg !== 0);
  const unknown = parts.filter((p) => p.status === "unknown");
  score -= typical.reduce((s, p) => s + Math.min(12, 4 + 4 * Math.abs(p.kg)), 0) + 12 * unknown.length;
  if (typical.length || unknown.length)
    reasons.push([typical.length ? `${typical.length} typical figure${typical.length === 1 ? "" : "s"}` : null, unknown.length ? `${unknown.length} unknown` : null].filter(Boolean).join(", "));
  if (!calibration) {
    score -= 25;
    reasons.push("no dives logged with this set yet");
  } else {
    if (calibration.dives < 3) score -= 10;
    reasons.push(`corrected by ${calibration.dives} of your dive${calibration.dives === 1 ? "" : "s"}`);
  }
  score = Math.max(5, Math.min(100, score));
  return { level: score >= 75 ? "high" : score >= 45 ? "medium" : "low", score, reasons };
}

export function estimateWeighting(kit: Kit, records: DiveRecord[], setRef: GearSet | null, water: Water, density = WATER_DENSITY[water]): WeightingEstimate {
  const { parts, missing } = estimateParts(kit, setRef, density);
  const calibration = calibrate(kit, records, setRef);
  if (!calibration) missing.push("a few dives with this set, the lead you carried and how it felt (they correct the estimate to you)");
  const model = kit.diver.massKg ? leadFor(parts.reduce((s, p) => s + p.kg, 0), density) : null;
  return {
    set: setRef ? { id: setRef.id, name: setRef.name } : null,
    water,
    density,
    leadKg: model === null ? null : round(Math.max(0, model + (calibration?.offsetKg ?? 0)), 0.5),
    modelKg: model === null ? null : r1(model),
    parts: parts.map((p) => ({ ...p, kg: r1(p.kg) })),
    calibration,
    missing,
    confidence: confidenceOf(parts, !!setRef?.itemIds.some((id) => kit.items.find((i) => i.id === id)?.kind === "tank"), calibration),
  };
}
