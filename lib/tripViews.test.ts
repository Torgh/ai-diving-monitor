import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "./dive";
import { type DiveRecord, RECORD_FORMAT } from "./record";
import { mergeTripPlan, type TripPlan, type TripPlanInput } from "./trip";
import { tripRow, tripsView, tripView } from "./tripViews";
import { parseUddf } from "./uddf";

const ROOT = path.resolve(__dirname, "..");
const records: DiveRecord[] = parseUddf(fs.readFileSync(path.join(ROOT, "examples", "summer-2026.uddf"))).map((dive, i) => ({
  format: RECORD_FORMAT,
  version: 1,
  id: fingerprint(dive),
  importedAt: `2026-10-24T10:00:0${i}.000Z`,
  updatedAt: "2026-10-24T10:00:00.000Z",
  source: { fileName: "summer.uddf", sha256: "0".repeat(64), uddfId: dive.uddfId },
  parserVersion: 2,
  dive,
  details: {},
  review: null,
}));
const TODAY = new Date("2026-10-25T09:00:00Z");
const plan = (over: Partial<TripPlanInput>): TripPlan => mergeTripPlan(undefined, { id: "t", name: "Trip", dives: [], ...over }, "2026-10-01T00:00:00.000Z");

describe("tripRow", () => {
  it("knows whether a trip is coming, under way or over, from its dates or its cards", () => {
    expect(tripRow(plan({ startDate: "2026-11-01", endDate: "2026-11-08" }), TODAY)).toMatchObject({ when: "upcoming", daysUntil: 7, endDate: "2026-11-08" });
    expect(tripRow(plan({ dives: [{ itemId: "a", title: "A", date: "2026-10-26" }, { itemId: "b", title: "B", date: "2026-10-24" }] }), TODAY)).toMatchObject({
      when: "now",
      startDate: "2026-10-24",
      endDate: "2026-10-26",
      daysUntil: -1,
    });
    expect(tripRow(plan({ startDate: "2026-10-20" }), TODAY)).toMatchObject({ when: "past", endDate: "2026-10-20" });
    expect(tripRow(plan({ startDate: "2026-10-20", endDate: "2026-10-10" }), TODAY).endDate).toBe("2026-10-20");
    expect(tripRow(plan({}), TODAY)).toMatchObject({ when: "undated", startDate: null, daysUntil: null, cards: 0, prepared: 0, loggedDives: 0 });
  });
});

describe("tripsView", () => {
  it("puts the trip under way first, then the next ones, the undated and the past ones newest first", () => {
    const trips = [
      plan({ id: "old", name: "Old", startDate: "2025-05-01" }),
      plan({ id: "later", name: "Later", startDate: "2027-05-01" }),
      plan({ id: "recent", name: "Recent", startDate: "2026-09-01" }),
      plan({ id: "someday", name: "Someday" }),
      plan({ id: "soon", name: "Soon", startDate: "2026-11-01" }),
      plan({ id: "now", name: "Now", startDate: "2026-10-24", endDate: "2026-10-30" }),
    ];
    const view = tripsView(trips, TODAY);
    expect(view.trips.map((t) => t.id)).toEqual(["now", "soon", "later", "someday", "recent", "old"]);
    expect(view.next?.id).toBe("now");
    expect(tripsView([trips[0]], TODAY).next).toBeNull();
  });
});

describe("tripView", () => {
  it("shows each card with the numbers behind the preparation and the logged dives", () => {
    const [first, second] = records;
    const date = first.dive.start!.slice(0, 10);
    const trip = plan({
      startDate: date,
      summaryMarkdown: "Stops.",
      dives: [
        { itemId: "a", title: "First", date, maxDepthM: 20, gas: "EAN32", prepMarkdown: "## Go", loggedDiveIds: ["gone"] },
        { itemId: "b", title: "Second", date: second.dive.start!.slice(0, 10), loggedDiveIds: [second.id] },
        { itemId: "c", title: "Undated" },
      ],
    });
    const view = tripView([trip], records, "t", TODAY)!;
    expect(view).toMatchObject({ id: "t", when: "past", summary: { markdown: "Stops." }, prepared: 1, loggedDives: 2 });
    const [a, b, c] = view.dives;
    expect(a).toMatchObject({ itemId: "a", prep: { markdown: "## Go" }, logged: [{ id: "gone", seq: null }] });
    // Preparation counts only the dives before the card's day.
    expect(a.facts.experience.dives).toBe(0);
    expect(a.facts.gasPlan.ppo2AtMaxDepth).toBe(0.96);
    expect(view.recurringIssues).toEqual([]);
    expect(a.loggedThatDay).toEqual([expect.objectContaining({ id: first.id, seq: 1, start: first.dive.start })]);
    expect(b.logged).toEqual([expect.objectContaining({ id: second.id, seq: 2 })]);
    expect(b.loggedThatDay).toEqual([]);
    expect(c.loggedThatDay).toEqual([]);
    expect(tripView([trip], records, "nope", TODAY)).toBeNull();
  });
});

describe("tripView after the log", () => {
  it("shows the problems that keep coming back once, on the trip, not on every card", () => {
    const trip = plan({ startDate: "2027-01-10", dives: [{ itemId: "a", title: "A", date: "2027-01-11", maxDepthM: 20 }] });
    const spring = parseUddf(fs.readFileSync(path.join(ROOT, "examples", "spring-2026.uddf"))).map((dive, i) => ({
      ...records[0],
      id: fingerprint(dive),
      importedAt: `2026-10-23T10:00:0${i}.000Z`,
      dive,
    }));
    const view = tripView([trip], [...spring, ...records], "t", TODAY)!;
    const { facts, notes } = view.dives[0];
    expect(view.recurringIssues.length).toBeGreaterThan(0);
    expect(facts.notes.some((n) => n.startsWith("Keeps coming back"))).toBe(true);
    expect(notes.some((n) => n.startsWith("Keeps coming back"))).toBe(false);
  });
});
