import { describe, expect, it } from "vitest";
import { emptyKit, type Kit, updateKit } from "./kit";
import type { DiveRecord } from "./record";
import { bodySurface, confidenceOf, estimateWeighting } from "./weighting";

const kit = (): Kit =>
  updateKit(
    emptyKit(),
    {
      diver: { massKg: 82, heightCm: 183, bodyFatPercent: 18 },
      items: [
        { name: "Wetsuit 7", kind: "suit", suitType: "wetsuit", thicknessMm: 7 },
        { name: "Hood 5", kind: "hood", thicknessMm: 5 },
        { name: "Steel 12", kind: "tank", material: "steel", volumeL: 12, emptyBuoyancyKg: -1.4 },
        { name: "Al 11", kind: "tank", material: "aluminium", volumeL: 11.1 },
        { name: "Wing", kind: "bcd", plate: "steel" },
        { name: "Jacket", kind: "bcd", plate: "none" },
        { name: "Regs", kind: "regulator" },
        { name: "Shorty 3", kind: "suit", suitType: "wetsuit", thicknessMm: 3, ageYears: 20 },
        { name: "Dry", kind: "suit", suitType: "drysuit", undergarment: "thick 400 g" },
        { name: "Housing", kind: "camera" },
        { name: "Fins", kind: "fins", buoyancyKg: -0.6 },
      ],
      sets: [
        { name: "Lake", items: ["Wetsuit 7", "Hood 5", "Steel 12", "Wing", "Regs", "Fins"] },
        { name: "Warm", items: ["Shorty 3", "Al 11", "Jacket", "Regs", "Housing"] },
        { name: "Winter", items: ["Dry", "Steel 12", "Wing", "Regs"] },
      ],
      sites: [{ name: "Koparki", water: "fresh" }],
    },
    "T",
  );

const set = (k: Kit, name: string) => k.sets.find((s) => s.name === name)!;

/** A logged dive with only what the calibration reads. */
const dive = (details: DiveRecord["details"], site = "Koparki") => ({ id: "d", details, dive: { site, start: null } }) as unknown as DiveRecord;

describe("estimateWeighting", () => {
  it("adds up you and every piece of gear, in kg of buoyancy at the safety stop", () => {
    const k = kit();
    const e = estimateWeighting(k, [], set(k, "Lake"), "fresh");
    expect(e.parts.map((p) => p.label)).toEqual(["You", "Wetsuit 7", "Hood 5", "Steel 12", "Wing", "Regs", "Fins"]);
    expect(e.parts.find((p) => p.label === "Fins")).toMatchObject({ kg: -0.6, assumed: false });
    expect(e.parts.find((p) => p.label === "Wetsuit 7")!.kg).toBeGreaterThan(4);
    // The tank is its empty buoyancy less the gas still in it at the reserve.
    expect(e.parts.find((p) => p.label === "Steel 12")!.kg).toBeCloseTo(-1.4 - 12 * 50 * 0.001225, 1);
    expect(e.leadKg! % 0.5).toBe(0);
    expect(e.calibration).toBeNull();
  });

  it("needs more lead in salt water, with a thick suit and with floating gear", () => {
    const k = kit();
    const lead = (name: string, water: "fresh" | "salt") => estimateWeighting(k, [], set(k, name), water).modelKg!;
    // About 2.5 % of you and your gear: around 2 kg for an 82 kg diver.
    expect(lead("Warm", "salt") - lead("Warm", "fresh")).toBeGreaterThan(1.5);
    expect(lead("Warm", "salt")).toBeGreaterThan(lead("Lake", "salt"));
    expect(lead("Winter", "salt")).toBeGreaterThan(lead("Lake", "salt"));
  });

  it("uses typical figures where the kit has none, and says what would help", () => {
    const k = kit();
    const e = estimateWeighting(k, [], set(k, "Warm"), "salt");
    expect(e.parts.find((p) => p.label === "Al 11")).toMatchObject({ assumed: true });
    expect(e.parts.find((p) => p.label === "Jacket")).toMatchObject({ kg: 1, assumed: true });
    expect(e.missing).toEqual(expect.arrayContaining([expect.stringContaining("Al 11: its empty buoyancy"), expect.stringContaining("Housing: its buoyancy")]));
    const dry = estimateWeighting(k, [], set(k, "Winter"), "fresh");
    expect(dry.parts.find((p) => p.label === "Dry")).toMatchObject({ kg: 7, assumed: true });
  });

  it("counts the neoprene with a typical height when yours is missing, flagged", () => {
    const k = updateKit(kit(), { diver: { heightCm: null } }, "T2");
    const suit = estimateWeighting(k, [], set(k, "Lake"), "salt").parts.find((p) => p.label === "Wetsuit 7")!;
    expect(suit.kg).toBeGreaterThan(4);
    expect(suit.assumed).toBe(true);
  });

  it("can't give a lead without your body mass, and asks for the rest", () => {
    const k = updateKit(kit(), { diver: { massKg: null, heightCm: null, bodyFatPercent: null } }, "T2");
    const e = estimateWeighting(k, [], null, "salt");
    expect(e).toMatchObject({ set: null, leadKg: null, modelKg: null, density: 1.025 });
    expect(e.missing.slice(0, 5)).toEqual([
      "your body mass",
      expect.stringContaining("your body fat"),
      expect.stringContaining("your height"),
      "the suit you dive in",
      "the tank",
    ]);
  });

  it("is corrected by your dives: the lead you carried and how it felt", () => {
    const k = kit();
    const model = estimateWeighting(k, [], set(k, "Lake"), "fresh").modelKg!;
    const records = [
      dive({ gearSetId: "lake", ballastKg: model + 3, weighting: "ok" }),
      dive({ gearSetId: "lake", ballastKg: model + 4.5, weighting: "heavy" }),
      dive({ gearSetId: "lake", ballastKg: 6 }), // no feeling: doesn't count
      dive({ gearSetId: "lake", ballastKg: 6, weighting: "ok" }, "Nowhere"), // no water known
      dive({ gearSetId: "winter", ballastKg: 6, weighting: "ok" }), // another suit
    ];
    const e = estimateWeighting(k, records, set(k, "Lake"), "fresh");
    expect(e.calibration).toEqual({ dives: 2, offsetKg: 3 });
    expect(e.leadKg).toBe(Math.max(0, Math.round((model + 3) * 2) / 2));
    // The correction keeps the difference between waters, even where the kit alone would sink.
    const salt = estimateWeighting(k, records, set(k, "Lake"), "salt");
    expect(salt.leadKg!).toBeGreaterThan(e.leadKg!);
    expect(e.missing.some((m) => m.includes("a few dives"))).toBe(false);
  });
});

describe("parts and how sure", () => {
  it("counts a 3/2 suit's torso and limbs apart", () => {
    const k = updateKit(
      kit(),
      {
        items: [
          { name: "Suit 3/2", kind: "suit", suitType: "wetsuit", thicknessMm: 3, thicknessLimbsMm: 2 },
          { name: "Suit 3", kind: "suit", suitType: "wetsuit", thicknessMm: 3 },
          { name: "Suit 2", kind: "suit", suitType: "wetsuit", thicknessMm: 2 },
        ],
        sets: [
          { name: "A", items: ["Suit 3/2"] },
          { name: "B", items: ["Suit 3"] },
          { name: "C", items: ["Suit 2"] },
        ],
      },
      "T2",
    );
    const suit = (name: string) => estimateWeighting(k, [], set(k, name), "salt").parts[1];
    expect(suit("A").kg).toBeLessThan(suit("B").kg);
    expect(suit("A").kg).toBeGreaterThan(suit("C").kg);
    expect(suit("A").why).toContain("3 mm torso, 2 mm limbs");
  });

  it("says whose each figure is, and points every part at its gear", () => {
    const k = kit();
    const parts = estimateWeighting(k, [], set(k, "Warm"), "salt").parts;
    const status = Object.fromEntries(parts.map((p) => [p.label, p.status]));
    expect(status).toMatchObject({ You: "yours", "Shorty 3": "yours", "Al 11": "typical", Jacket: "typical", Housing: "unknown" });
    expect(parts.find((p) => p.label === "Al 11")?.itemId).toBe("al-11");
    expect(parts.find((p) => p.label === "You")?.itemId).toBeUndefined();
    const fins = estimateWeighting(k, [], set(k, "Lake"), "salt").parts.find((p) => p.label === "Fins");
    expect(fins).toMatchObject({ status: "yours", kg: -0.6 });
  });

  it("is less sure without a tank, with typical or unknown figures and without dives", () => {
    const k = kit();
    const lake = estimateWeighting(k, [], set(k, "Lake"), "salt").confidence;
    expect(lake.reasons).toEqual(["2 typical figures", "no dives logged with this set yet"]);
    expect(lake.level).toBe("medium");
    const sure = confidenceOf([{ label: "You", kg: 0.2, assumed: false, status: "yours", why: "" }], true, { dives: 4, offsetKg: 1 });
    expect(sure).toEqual({ level: "high", score: 100, reasons: ["corrected by 4 of your dives"] });
    const unsure = confidenceOf([{ label: "Cam", kg: 0, assumed: true, status: "unknown", why: "" }], false, { dives: 1, offsetKg: 0 });
    expect(unsure).toMatchObject({ level: "low", score: 43 });
    expect(unsure.reasons).toEqual(["no tank in the set", "1 unknown", "corrected by 1 of your dive"]);
    expect(confidenceOf([], false, null)).toMatchObject({ level: "low", score: 40 });
  });
});

describe("bodySurface", () => {
  it("is about 2 m² for a tall adult", () => {
    expect(bodySurface(183, 82)).toBeCloseTo(2.04, 2);
  });
});
