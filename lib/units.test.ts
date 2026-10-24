import { describe, expect, it } from "vitest";
import { paToBar, parseNumber, toCelsius, toLitres } from "./units";

describe("units", () => {
  it("converts pascal to bar", () => {
    expect(paToBar(20_000_000)).toBe(200);
    expect(paToBar(null)).toBeNull();
  });

  it("converts kelvin to Celsius, and keeps Celsius written by mistake", () => {
    expect(toCelsius(298.15)).toBeCloseTo(25);
    expect(toCelsius(24)).toBe(24);
    expect(toCelsius(null)).toBeNull();
  });

  it("converts cubic metres to litres, and keeps litres written by mistake", () => {
    expect(toLitres(0.012)).toBeCloseTo(12);
    expect(toLitres(11.1)).toBe(11.1);
    expect(toLitres(null)).toBeNull();
  });

  it("parses numbers like the Python version", () => {
    expect(parseNumber(" 18.5 ")).toBe(18.5);
    expect(parseNumber("1e3")).toBe(1000);
    for (const text of [null, undefined, "", "  ", "abc"]) expect(parseNumber(text)).toBeNull();
  });
});
