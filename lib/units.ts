/**
 * UDDF stores values in SI units: pressure in pascal, temperature in kelvin, volume in cubic metres.
 * These helpers turn them into diver units (bar, °C, litres), tolerating exporters that don't follow
 * the spec. They match the Python version (tag v0.1-python).
 */

export const PA_PER_BAR = 100_000;
export const KELVIN_OFFSET = 273.15;

export function paToBar(pa: number | null): number | null {
  return pa === null ? null : pa / PA_PER_BAR;
}

/** Some exporters write Celsius despite the spec; values up to 100 can't be kelvin. */
export function toCelsius(k: number | null): number | null {
  if (k === null) return null;
  return k > 100 ? k - KELVIN_OFFSET : k;
}

/** Tank volume: cubic metres per the spec; values of 1 or more are already litres. */
export function toLitres(volume: number | null): number | null {
  if (volume === null) return null;
  return volume < 1 ? volume * 1000 : volume;
}

/** A number from XML text, or null when it is missing or not a number (as Python's float() reads it). */
export function parseNumber(text: string | null | undefined): number | null {
  if (text === null || text === undefined || !text.trim()) return null;
  // JavaScript also reads hex, binary and octal ("0x10" is 16); Python's float() refuses them.
  if (/^\s*[+-]?0[xob]/i.test(text)) return null;
  const value = Number(text.trim());
  return Number.isFinite(value) ? value : null;
}
