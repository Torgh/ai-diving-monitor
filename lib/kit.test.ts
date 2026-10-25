import { describe, expect, it } from "vitest";
import { emptyKit, findSet, KitInputError, readKit, updateKit, waterOf } from "./kit";

const base = () =>
  updateKit(
    emptyKit(),
    {
      diver: { massKg: 82, heightCm: 183 },
      items: [
        { name: "Pianka 7 mm", kind: "suit", suitType: "wetsuit", thicknessMm: 7 },
        { name: "Stal 12 L", kind: "tank", material: "steel", volumeL: 12, workingPressureBar: 232, emptyBuoyancyKg: -1.4 },
        { name: "Skrzydło", kind: "bcd", plate: "steel" },
      ],
      sets: [{ name: "Jezioro", items: ["Pianka 7 mm", "stal 12 l", "skrzydlo"], ballastKg: 8, water: "fresh" }],
      sites: [{ name: "Koparki", water: "fresh" }],
    },
    "T1",
  );

describe("updateKit", () => {
  it("adds the diver, gear, a set by item names and a site", () => {
    const kit = base();
    expect(kit.updatedAt).toBe("T1");
    expect(kit.diver).toEqual({ massKg: 82, heightCm: 183 });
    expect(kit.items.map((i) => i.id)).toEqual(["pianka-7-mm", "stal-12-l", "skrzydlo"]);
    expect(kit.items[1]).toMatchObject({ kind: "tank", material: "steel", volumeL: 12, emptyBuoyancyKg: -1.4 });
    expect(kit.sets).toEqual([{ id: "jezioro", name: "Jezioro", itemIds: ["pianka-7-mm", "stal-12-l", "skrzydlo"], ballastKg: 8, water: "fresh" }]);
    expect(kit.sites).toEqual([{ name: "Koparki", water: "fresh" }]);
  });

  it("changes by id or name, removes a field with null, and keeps ids unique", () => {
    const kit = updateKit(
      base(),
      {
        diver: { heightCm: null, bodyFatPercent: 18 },
        items: [{ id: "pianka-7-mm", name: "Pianka 7 mm (stara)", ageYears: 6 }, { name: "Pianka 7 mm", kind: "suit" }, { name: "Skrzydło", plate: null }],
        sets: [{ name: "jezioro", ballastKg: 9 }],
      },
      "T2",
    );
    expect(kit.diver).toEqual({ massKg: 82, bodyFatPercent: 18 });
    expect(kit.items.find((i) => i.id === "pianka-7-mm")).toMatchObject({ name: "Pianka 7 mm (stara)", ageYears: 6 });
    expect(kit.items.map((i) => i.id)).toContain("pianka-7-mm-2");
    expect(kit.items.find((i) => i.id === "skrzydlo")).not.toHaveProperty("plate");
    expect(kit.sets[0].ballastKg).toBe(9);
  });

  it("takes removed gear out of its sets, and forgets a site with a null water", () => {
    const kit = updateKit(base(), { remove: { items: ["Stal 12 L"], sets: [] }, sites: [{ name: "KOPARKI", water: null }] }, "T2");
    expect(kit.items.map((i) => i.id)).toEqual(["pianka-7-mm", "skrzydlo"]);
    expect(kit.sets[0].itemIds).toEqual(["pianka-7-mm", "skrzydlo"]);
    expect(kit.sites).toEqual([]);
    expect(updateKit(base(), { remove: { sets: ["Jezioro"] } }, "T2").sets).toEqual([]);
  });

  it("refuses what it can't use", () => {
    expect(() => updateKit(base(), { items: [{ name: "Thing" }] }, "T")).toThrow(KitInputError);
    expect(() => updateKit(base(), { items: [{ kind: "fins" }] }, "T")).toThrow("needs a name");
    expect(() => updateKit(base(), { items: [{ id: "skrzydlo", kind: "jetpack" as never }] }, "T")).toThrow("Unknown kind");
    expect(() => updateKit(base(), { diver: { massKg: 900 } }, "T")).toThrow("massKg must be a number from 20 to 250");
    expect(() => updateKit(base(), { sets: [{ name: "Morze", items: ["Pianka 3 mm"] }] }, "T")).toThrow('No gear called "Pianka 3 mm"');
    expect(() => updateKit(base(), { sets: [{ ballastKg: 4 }] }, "T")).toThrow("A new set needs a name");
    expect(() => updateKit(base(), { sites: [{ name: "Dahab", water: "lava" as never }] }, "T")).toThrow("fresh, brackish or salt");
    expect(() => updateKit(base(), { sites: [{ name: " ", water: "salt" }] }, "T")).toThrow("needs its name");
  });
});

describe("findSet", () => {
  it("finds a set by id or by name, accents and case aside", () => {
    expect(findSet(base(), "jezioro")?.name).toBe("Jezioro");
    expect(findSet(base(), "JEZIORO")?.id).toBe("jezioro");
    expect(findSet(base(), "Morze")).toBeUndefined();
  });
});

describe("waterOf", () => {
  it("takes the dive's water, else its site's, with the density", () => {
    const kit = updateKit(base(), { sites: [{ name: "Ras Mohammed", water: "salt", density: 1.03 }] }, "T2");
    expect(waterOf(kit, { water: "salt" }, "Koparki")).toEqual({ water: "salt", density: 1.025, from: "dive" });
    expect(waterOf(kit, {}, "koparki")).toEqual({ water: "fresh", density: 1, from: "site" });
    expect(waterOf(kit, {}, "Ras Mohammed")?.density).toBe(1.03);
    expect(waterOf(kit, {}, "Nowhere")).toBeNull();
    expect(waterOf(kit, {}, null)).toBeNull();
  });
});

describe("readKit", () => {
  it("reads a kit file and treats anything else as empty", () => {
    expect(readKit({ ...base() }).items).toHaveLength(3);
    expect(readKit({ format: "divedeck/kit", version: 1 })).toMatchObject({ diver: {}, items: [], sets: [], sites: [] });
    expect(readKit(null)).toEqual(emptyKit());
    expect(readKit({ format: "other" })).toEqual(emptyKit());
  });
});
