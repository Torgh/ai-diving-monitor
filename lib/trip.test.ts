import { describe, expect, it } from "vitest";
import { mergeTripPlan, TripInputError, tripFileName, type TripPlanInput } from "./trip";

const input = (over: Partial<TripPlanInput> = {}): TripPlanInput => ({
  id: "malta-27",
  name: " Malta 2027 ",
  destination: "Malta",
  startDate: "2027-05-08",
  dives: [
    { itemId: "b", title: "Um El Faroud", date: "2027-05-10", site: "Um El Faroud", maxDepthM: 36, gas: "EAN28", prepMarkdown: "## Wreck" },
    { itemId: "a", title: "", site: "Blue Hole", date: "2027-05-09", startTime: "09:00", center: "" },
    { itemId: "c", title: "Night dive" },
  ],
  ...over,
});

describe("mergeTripPlan", () => {
  it("stores the cards by date, with the preparation sent", () => {
    const plan = mergeTripPlan(undefined, { ...input(), summaryMarkdown: " Practise stops. " }, "T1");
    expect(plan).toMatchObject({ id: "malta-27", name: "Malta 2027", destination: "Malta", startDate: "2027-05-08", createdAt: "T1", updatedAt: "T1" });
    expect(plan.summary).toEqual({ markdown: "Practise stops.", savedAt: "T1" });
    expect(plan.dives.map((d) => d.itemId)).toEqual(["a", "b", "c"]);
    expect(plan.dives[0]).toEqual({ itemId: "a", title: "Blue Hole", site: "Blue Hole", date: "2027-05-09", startTime: "09:00", prep: null, loggedDiveIds: [] });
    expect(plan.dives[1].prep).toEqual({ markdown: "## Wreck", savedAt: "T1" });
    expect(plan.dives[2].title).toBe("Night dive");
  });

  it("follows TripDeck's cards and keeps what the dive log added", () => {
    const first = mergeTripPlan(undefined, { ...input(), summaryMarkdown: "Notes" }, "T1");
    first.dives[1].loggedDiveIds = ["d1"];
    const again = mergeTripPlan(
      first,
      {
        id: "malta-27",
        name: "Malta",
        dives: [
          { itemId: "b", title: "Um El Faroud", date: "2027-05-11" },
          { itemId: "a", title: "Blue Hole", prepMarkdown: "" , loggedDiveIds: ["d2", "d2"] },
        ],
      },
      "T2",
    );
    expect(again).toMatchObject({ createdAt: "T1", updatedAt: "T2", summary: { markdown: "Notes", savedAt: "T1" } });
    expect(again).not.toHaveProperty("destination");
    expect(again.dives.map((d) => [d.itemId, d.date, d.prep?.markdown ?? null, d.loggedDiveIds])).toEqual([
      ["b", "2027-05-11", "## Wreck", ["d1"]],
      ["a", undefined, null, ["d2"]],
    ]);
    expect(mergeTripPlan(again, { id: "malta-27", name: "Malta", summaryMarkdown: "", dives: [] }, "T3").summary).toBeNull();
  });

  it("refuses a bad id, a missing name, a wrong date and a card sent twice", () => {
    expect(() => mergeTripPlan(undefined, input({ id: "../x" }), "T")).toThrow(TripInputError);
    expect(() => mergeTripPlan(undefined, input({ name: " " }), "T")).toThrow("needs a name");
    expect(() => mergeTripPlan(undefined, input({ startDate: "8.5.2027" }), "T")).toThrow("YYYY-MM-DD");
    const twice = input();
    twice.dives.push({ itemId: "a", title: "Again" });
    expect(() => mergeTripPlan(undefined, twice, "T")).toThrow("The card a is sent twice.");
  });
});

describe("tripFileName", () => {
  it("is readable and keeps the id", () => {
    expect(tripFileName({ id: "malta-27", name: "Malta: 2027 / wrecks?" })).toBe("Malta 2027 wrecks (malta-27).trip.json");
    expect(tripFileName({ id: "x", name: "???" })).toBe("(x).trip.json");
  });
});
