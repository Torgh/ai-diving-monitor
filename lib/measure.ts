/**
 * Showing a quantity in the diver's units. Everything is stored and analysed in metric (m, bar, °C,
 * litres); only what the pages show is converted. ppO2 stays in bar in both systems, as divers read it.
 */

export type UnitSystem = "metric" | "imperial";
export type Quantity = "depth" | "pressure" | "temperature" | "volume" | "speed" | "flow" | "weight";

const FT_PER_M = 3.28084;
const PSI_PER_BAR = 14.5038;
const CUFT_PER_L = 0.0353147;
const LB_PER_KG = 2.20462;

interface Unit {
  unit: string;
  from: (metric: number) => number;
  /** Decimals when the caller doesn't ask for its own (imperial numbers are read rounder). */
  digits: number;
}

const UNITS: Record<UnitSystem, Record<Quantity, Unit>> = {
  metric: {
    depth: { unit: "m", from: (v) => v, digits: 1 },
    pressure: { unit: "bar", from: (v) => v, digits: 0 },
    temperature: { unit: "°C", from: (v) => v, digits: 1 },
    volume: { unit: "L", from: (v) => v, digits: 1 },
    speed: { unit: "m/min", from: (v) => v, digits: 1 },
    flow: { unit: "L/min", from: (v) => v, digits: 1 },
    weight: { unit: "kg", from: (v) => v, digits: 1 },
  },
  imperial: {
    depth: { unit: "ft", from: (v) => v * FT_PER_M, digits: 0 },
    pressure: { unit: "psi", from: (v) => v * PSI_PER_BAR, digits: 0 },
    temperature: { unit: "°F", from: (v) => (v * 9) / 5 + 32, digits: 0 },
    volume: { unit: "cu ft", from: (v) => v * CUFT_PER_L, digits: 1 },
    speed: { unit: "ft/min", from: (v) => v * FT_PER_M, digits: 0 },
    // Surface gas, so litres convert to cubic feet like a volume.
    flow: { unit: "cu ft/min", from: (v) => v * CUFT_PER_L, digits: 2 },
    weight: { unit: "lb", from: (v) => v * LB_PER_KG, digits: 0 },
  },
};

export const isUnitSystem = (value: unknown): value is UnitSystem => value === "metric" || value === "imperial";

export function unitOf(quantity: Quantity, system: UnitSystem): string {
  return UNITS[system][quantity].unit;
}

export function convert(quantity: Quantity, metric: number, system: UnitSystem): number {
  return UNITS[system][quantity].from(metric);
}

/** Metric numbers keep the decimals the caller asks for; imperial ones use their own rounding. */
export function digitsFor(quantity: Quantity, system: UnitSystem, metricDigits?: number): number {
  return system === "metric" && metricDigits !== undefined ? metricDigits : UNITS[system][quantity].digits;
}

/**
 * A range with its unit once: "1–35 m", "to 35 m", "from 5 m"; null when neither end is known.
 * `number` formats a converted number with the given decimals (the pages' number format).
 */
export function formatRange(
  quantity: Quantity,
  min: number | null | undefined,
  max: number | null | undefined,
  system: UnitSystem,
  number: (value: number, digits: number) => string,
): string | null {
  const known = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
  const digits = digitsFor(quantity, system, 0);
  const text = (v: number) => number(convert(quantity, v, system), digits);
  const unit = unitOf(quantity, system);
  if (known(min) && known(max)) return min === max ? `${text(max)} ${unit}` : `${text(min)}–${text(max)} ${unit}`;
  if (known(max)) return `to ${text(max)} ${unit}`;
  if (known(min)) return `from ${text(min)} ${unit}`;
  return null;
}
