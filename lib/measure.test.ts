import { describe, expect, it } from "vitest";
import { convert, digitsFor, formatRange, isUnitSystem, unitOf } from "./measure";

describe("units", () => {
  it("leaves metric as it is", () => {
    expect(convert("depth", 39.2, "metric")).toBe(39.2);
    expect(unitOf("flow", "metric")).toBe("L/min");
    expect(digitsFor("depth", "metric", 0)).toBe(0);
    expect(digitsFor("depth", "metric")).toBe(1);
    for (const q of ["depth", "pressure", "temperature", "volume", "speed", "flow", "weight"] as const) expect(convert(q, 12.5, "metric")).toBe(12.5);
  });

  it("converts to imperial with its own rounding", () => {
    expect(convert("depth", 30, "imperial")).toBeCloseTo(98.4, 1);
    expect(convert("pressure", 200, "imperial")).toBeCloseTo(2900.8, 1);
    expect(convert("temperature", 31, "imperial")).toBeCloseTo(87.8, 1);
    expect(convert("volume", 11.1, "imperial")).toBeCloseTo(0.392, 3);
    expect(convert("speed", 10, "imperial")).toBeCloseTo(32.8, 1);
    expect(convert("flow", 20, "imperial")).toBeCloseTo(0.706, 3);
    expect(convert("weight", 8, "imperial")).toBeCloseTo(17.6, 1);
    expect(unitOf("depth", "imperial")).toBe("ft");
    expect(digitsFor("depth", "imperial", 1)).toBe(0);
  });

  it("knows the two systems", () => {
    expect(isUnitSystem("imperial")).toBe(true);
    expect(isUnitSystem("us")).toBe(false);
  });
});

describe("formatRange", () => {
  const number = (v: number, digits: number) => v.toFixed(digits);

  it("writes the unit once", () => {
    expect(formatRange("depth", 1, 35, "metric", number)).toBe("1–35 m");
    expect(formatRange("depth", 1, 35, "imperial", number)).toBe("3–115 ft");
    expect(formatRange("depth", 18, 18, "metric", number)).toBe("18 m");
  });

  it("says which end is known, or nothing", () => {
    expect(formatRange("depth", undefined, 35, "metric", number)).toBe("to 35 m");
    expect(formatRange("depth", 5, null, "metric", number)).toBe("from 5 m");
    expect(formatRange("depth", undefined, undefined, "metric", number)).toBeNull();
    expect(formatRange("depth", Number.NaN, undefined, "metric", number)).toBeNull();
  });
});
