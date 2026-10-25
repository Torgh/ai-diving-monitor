import { describe, expect, it } from "vitest";
import { formatDate, formatDateRange, formatMinutes, formatNumber, formatSeconds, formatTripWhen } from "./format";

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

  it("formats a trip's dates and when it is", () => {
    expect(formatDateRange("2027-05-08", "2027-05-15")).toBe("8–15 May 2027");
    expect(formatDateRange("2027-04-28", "2027-05-03")).toBe("28 Apr – 3 May 2027");
    expect(formatDateRange("2026-12-28", "2027-01-04")).toBe("28 Dec 2026 – 4 Jan 2027");
    expect(formatDateRange("2027-05-08", "2027-05-08")).toBe("8 May 2027");
    expect(formatDateRange(null, null)).toBe("No dates");

    const today = new Date("2026-10-25T09:00:00Z");
    expect(formatTripWhen({ when: "upcoming", daysUntil: 12, endDate: null }, today)).toBe("In 12 days");
    expect(formatTripWhen({ when: "upcoming", daysUntil: 1, endDate: null }, today)).toBe("Tomorrow");
    expect(formatTripWhen({ when: "now", daysUntil: -2, endDate: "2026-10-30" }, today)).toBe("Under way");
    expect(formatTripWhen({ when: "past", daysUntil: -9, endDate: "2026-10-24" }, today)).toBe("Ended yesterday");
    expect(formatTripWhen({ when: "past", daysUntil: -9, endDate: "2026-10-20" }, today)).toBe("Ended 5 days ago");
    expect(formatTripWhen({ when: "past", daysUntil: -9, endDate: null }, today)).toBe("Ended");
    expect(formatTripWhen({ when: "undated", daysUntil: null, endDate: null }, today)).toBe("No dates yet");
  });
});
