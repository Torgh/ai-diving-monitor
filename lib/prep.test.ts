import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "./dive";
import { normalizeSite, plannedGas, prepareDive, REFRESHER_DAYS, sameSite } from "./prep";
import { type DiveRecord, RECORD_FORMAT } from "./record";
import { parseUddf } from "./uddf";

const ROOT = path.resolve(__dirname, "..");
const records: DiveRecord[] = ["spring-2026.uddf", "summer-2026.uddf"]
  .flatMap((f) => parseUddf(fs.readFileSync(path.join(ROOT, "examples", f))))
  .map((dive, i) => ({
    format: RECORD_FORMAT,
    version: 1,
    id: fingerprint(dive),
    importedAt: `2026-10-24T10:00:0${i}.000Z`,
    updatedAt: "2026-10-24T10:00:00.000Z",
    source: { fileName: "samples.uddf", sha256: "0".repeat(64), uddfId: dive.uddfId },
    parserVersion: 2,
    dive,
    details: {},
    review: null,
  }));
const TODAY = new Date("2026-10-25T12:00:00Z");

describe("dive sites", () => {
  it("match without accents, case and punctuation, and a short name only as whole words", () => {
    expect(normalizeSite("  Hańcza – Bachanowo! ")).toBe("hancza bachanowo");
    expect(sameSite("Blue Hole", "blue hole, Dahab")).toBe(true);
    expect(sameSite("Hancza", "Hańcza")).toBe(true);
    expect(sameSite("Hole", "Blue Hole")).toBe(true);
    expect(sameSite("Ho", "Ho Chi")).toBe(false);
    expect(sameSite("Arch", "Blue Hole Archway")).toBe(false);
    expect(sameSite(null, "x")).toBe(false);
    expect(sameSite("!!", "!!")).toBe(false);
  });
});

describe("planned gas", () => {
  it("reads TripDeck's kinds and real mixes", () => {
    expect(plannedGas("nitrox")).toEqual({ family: "nitrox", o2: null, he: null });
    expect(plannedGas("Trimix")).toEqual({ family: "trimix", o2: null, he: null });
    expect(plannedGas("air")).toEqual({ family: "air", o2: 0.21, he: 0 });
    expect(plannedGas("EAN32")).toEqual({ family: "nitrox", o2: 0.32, he: 0 });
    expect(plannedGas("Tx 18/45")).toEqual({ family: "trimix", o2: 0.18, he: 0.45 });
    expect(plannedGas("oxygen")).toEqual({ family: "oxygen", o2: 1, he: 0 });
    expect(plannedGas("")).toBeNull();
    expect(plannedGas("banana")).toBeNull();
  });
});

describe("prepareDive", () => {
  it("finds the experience, the same site first, and the gas plan", () => {
    const prep = prepareDive(records, { site: "Koparki", maxDepthM: 40, gas: "EAN32", dives: 2, date: "2027-05-10" }, TODAY);
    expect(prep.experience).toMatchObject({
      dives: 9,
      deepestM: 52,
      divesNearPlannedDepth: 1,
      deeperThanEver: false,
      divesWithThisGas: 7,
      divesWithDeco: 1,
      lastDive: { seq: 9, date: "2026-09-19", site: "Zakrzówek" },
      daysSinceLastDive: 233,
      divesInLast12Months: 5,
    });
    expect(prep.atThisSite.map((d) => d.seq)).toEqual([1, 2]);
    expect(prep.comparable.map((d) => d.seq)).toEqual([2, 1, 8, 6, 7]);
    expect(prep.gasPlan).toEqual({
      rmvLMin: 19.3,
      rmvDives: 9,
      consumptionAtMaxDepthLMin: 95.5,
      ppo2AtMaxDepth: 1.6,
      modM: 33.8,
      bestNitroxPercent: 27,
      endM: null,
    });
    expect(prep.recurringIssues[0]).toEqual({ title: "Ascent faster than recommended", severity: "warning", dives: 3, of: 9 });
    // 1.604 bar rounds to 1.6 but is over the limit.
    expect(prep.notes[0]).toMatch(/^ppO2 1.6 bar at 40 m is over 1.6 bar: this gas is not safe/);
    expect(prep.notes).toContain(`233 days since the last logged dive: worth a refresher or an easy check-out dive first.`);
    expect(prep.notes.some((n) => n.startsWith("2 dives in this outing"))).toBe(true);
  });

  it("raises a deep dive on air, a ppO2 over 1.4, a new site and an unknown mix", () => {
    const air = prepareDive(records, { site: "Hole in the Wall", maxDepthM: 60, gas: "air" }, TODAY);
    expect(air.experience.deeperThanEver).toBe(true);
    expect(air.notes).toEqual(
      expect.arrayContaining([
        "Deeper than the diver has logged: 60 m planned, deepest so far 52 m.",
        "Air at 60 m: expect narcosis (END 60 m).",
        "First dive at Hole in the Wall in the log.",
      ]),
    );
    expect(air.gasPlan.bestNitroxPercent).toBe(21);
    expect(prepareDive(records, { maxDepthM: 36, gas: "EAN32" }, TODAY).notes[0]).toBe(
      "ppO2 1.48 bar at 36 m is over 1.4 bar for the bottom phase (MOD 33.8 m).",
    );
    const nitrox = prepareDive(records, { maxDepthM: 18, gas: "nitrox" }, TODAY);
    expect(nitrox.notes[0]).toBe("The nitrox mix isn't known yet: ask which mix, to check ppO2 and MOD (EAN40 is the richest nitrox for 18 m).");
    expect(prepareDive(records, { gas: "trimix" }, TODAY).notes[0]).toBe("The trimix mix isn't known yet: ask which mix, to check ppO2 and MOD.");
    expect(prepareDive(records, { gas: "oxygen" }, TODAY).notes).toContain("No logged dives on oxygen yet.");
  });

  it("gives a trimix its END, and counts days to today without a date", () => {
    const tx = prepareDive(records, { maxDepthM: 60, gas: "Tx 18/45" }, TODAY);
    expect(tx.gasPlan).toMatchObject({ ppo2AtMaxDepth: 1.26, endM: 28.6 });
    expect(tx.experience.daysSinceLastDive).toBe(36);
    expect(prepareDive(records, { date: "not a date" }, TODAY).experience.daysSinceLastDive).toBe(36);
    const old = prepareDive(records, { date: "2027-10-01" }, TODAY);
    expect(old.experience.daysSinceLastDive).toBeGreaterThan(REFRESHER_DAYS);
    expect(old.experience.divesInLast12Months).toBe(0);
  });

  it("says when the log is empty or has no gas consumption", () => {
    const empty = prepareDive([], { site: "Koparki", maxDepthM: 20 }, TODAY);
    expect(empty.experience).toMatchObject({ dives: 0, deepestM: null, lastDive: null, daysSinceLastDive: null });
    expect(empty.notes).toEqual(["The dive log is empty: there is no history to prepare from. Import the diver's dives first."]);
    expect(empty.comparable).toEqual([]);

    const noTanks = records.map((r) => ({ ...r, dive: { ...r.dive, tanks: [] } }));
    const prep = prepareDive(noTanks, {}, TODAY);
    expect(prep.gasPlan).toMatchObject({ rmvLMin: null, rmvDives: 0, consumptionAtMaxDepthLMin: null, bestNitroxPercent: null });
    expect(prep.notes).toContain("No gas consumption in the log: fill in tank volumes (update_dive) to plan gas from the diver's RMV.");
  });
});
