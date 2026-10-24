import { describe, expect, it } from "vitest";
import { formatDate, formatMinutes, formatNumber, formatSeconds } from "./format";

describe("format", () => {
  it("formats dates without converting time zones", () => {
    expect(formatDate("2026-09-25T20:29:14")).toBe("25 Sept 2026, 20:29");
    expect(formatDate("2026-09-25T20:29:14", false)).toBe("25 Sept 2026");
    expect(formatDate(null)).toBe("Undated");
  });

  it("formats durations and numbers", () => {
    expect(formatMinutes(33.1)).toBe("33 min");
    expect(formatMinutes(65)).toBe("1 h 05 min");
    expect(formatNumber(39.24)).toBe("39.2");
    expect(formatNumber(1830, 0, "L")).toBe("1,830 L");
    expect(formatNumber(null)).toBe("–");
    expect(formatSeconds(510)).toBe("8 min 30 s");
    expect(formatSeconds(45)).toBe("45 s");
  });
});
