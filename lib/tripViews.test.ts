import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "./dive";
import { type DiveRecord, RECORD_FORMAT } from "./record";
import { mergeTripPlan, type TripPlan, type TripPlanInput } from "./trip";
import { breakBefore, flightAfterDiving, tripRow, tripsView, tripView } from "./tripViews";
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
    const twoDays = [
      { itemId: "a", title: "A", date: "2026-11-02" },
      { itemId: "b", title: "B", date: "2026-11-02" },
      { itemId: "c", title: "C", date: "2026-11-03" },
    ];
    expect(tripRow(plan({ dives: twoDays }), TODAY).diveDays).toBe(2);
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

describe("before and after the trip", () => {
  const thailand = plan({ id: "th", name: "Thailand", dives: [{ itemId: "t1", title: "T1", date: "2027-01-25" }, { itemId: "t2", title: "T2", date: "2027-01-28" }] });
  const mexico = plan({
    id: "mx",
    name: "Mexico",
    dives: [
      { itemId: "m1", title: "The Pit", date: "2027-02-22", startTime: "08:00", dives: 2, verdict: "check", verdictSummary: "First cenotes." },
      { itemId: "m2", title: "Cozumel", date: "2027-03-02", startTime: "08:00", dives: 2, verdict: "ready" },
    ],
    flights: [
      { date: "2027-02-13", time: "10:00", from: "WAW", to: "CUN" },
      { date: "2027-03-04", time: "13:35", from: "CUN", to: "MEX" },
    ],
  });

  it("counts the break from the later of the last logged dive and an earlier trip's last dive", () => {
    expect(breakBefore(mexico, [thailand, mexico], records)).toEqual({ days: 25, after: { kind: "trip", id: "th", name: "Thailand", date: "2027-01-28" } });
    const alone = breakBefore(mexico, [mexico], records);
    expect(alone?.after).toMatchObject({ kind: "dive", seq: records.length });
    expect(breakBefore(plan({}), [], records)).toBeNull();
    expect(breakBefore(mexico, [mexico], [])).toBeNull();
  });

  it("counts the hours from the last dive to the next flight, cautiously", () => {
    // Two dives from 08:00 end about 11:00; the flight leaves two days later at 13:35.
    expect(flightAfterDiving(mexico)).toEqual({
      flight: { date: "2027-03-04", time: "13:35", from: "CUN", to: "MEX" },
      lastDiveEnd: "2027-03-02T11:00",
      hours: 50.6,
      neededHours: 18,
      timeAssumed: false,
    });
    // One dive without a time counts as ending at 18:00; a flight without a time leaves right after it.
    const day = plan({ dives: [{ itemId: "a", title: "A", date: "2026-11-02" }], flights: [{ date: "2026-11-02", time: "20:00" }] });
    expect(flightAfterDiving(day)).toMatchObject({ hours: 2, neededHours: 12, timeAssumed: true });
    expect(flightAfterDiving({ ...day, flights: [{ date: "2026-11-02" }] })).toMatchObject({ hours: 0, timeAssumed: true });
    expect(flightAfterDiving({ ...day, flights: [{ date: "2026-11-01", time: "08:00" }] })).toBeNull();
    expect(flightAfterDiving(plan({}))).toBeNull();
  });

  it("puts both on the trip, and the cards to check on its row", () => {
    const view = tripView([thailand, mexico], records, "mx", TODAY)!;
    expect(view.toCheck).toBe(1);
    expect(view.breakBefore?.days).toBe(25);
    expect(view.flight?.hours).toBe(50.6);
    expect(view.dives[0].verdict).toMatchObject({ status: "check", summary: "First cenotes." });
  });
});
