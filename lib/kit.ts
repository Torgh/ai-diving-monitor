/**
 * The diver's kit: who dives (body mass, height, body fat), the gear, the sets it is put together in,
 * and the water at each dive site. One file next to the log, wherever it is stored, so every device
 * and the agent see the same. Dives point at a set by its id (DiveDetails.gearSetId).
 */

export const KIT_FORMAT = "divedeck/kit";
export const KIT_VERSION = 1;

/** Fresh (lakes, quarries), brackish (the Baltic) or salt (the sea). */
export type Water = "fresh" | "brackish" | "salt";
export const WATERS: Water[] = ["fresh", "brackish", "salt"];
/** Typical density, kg/L; a site can give its own (the Red Sea is about 1.03). */
export const WATER_DENSITY: Record<Water, number> = { fresh: 1.0, brackish: 1.01, salt: 1.025 };

export type GearKind = "suit" | "hood" | "gloves" | "boots" | "bcd" | "regulator" | "tank" | "fins" | "computer" | "light" | "camera" | "other";
export const GEAR_KINDS: GearKind[] = ["suit", "hood", "gloves", "boots", "bcd", "regulator", "tank", "fins", "computer", "light", "camera", "other"];

export interface Diver {
  massKg?: number;
  heightCm?: number;
  /** Fat floats and muscle sinks: the biggest unknown in a diver's own buoyancy. */
  bodyFatPercent?: number;
}

export interface GearItem {
  /** Made from the name when the item is added; stays when it is renamed. */
  id: string;
  name: string;
  kind: GearKind;
  brand?: string;
  notes?: string;
  /** In the water: positive floats, negative sinks (from the maker, or weighed). */
  buoyancyKg?: number;
  /** Suits: what kind, how thick, what is worn under a drysuit, the size and how old the neoprene is. */
  suitType?: "wetsuit" | "semidry" | "drysuit";
  thicknessMm?: number;
  undergarment?: string;
  size?: string;
  ageYears?: number;
  /** Tanks. */
  material?: "steel" | "aluminium" | "carbon";
  volumeL?: number;
  workingPressureBar?: number;
  /** Buoyancy of the empty tank with its valve, from the maker's sheet. */
  emptyBuoyancyKg?: number;
  /** BCDs: a backplate's material (or none for a jacket). */
  plate?: "steel" | "aluminium" | "none";
}

export interface GearSet {
  id: string;
  name: string;
  itemIds: string[];
  /** The lead usually carried with this set. */
  ballastKg?: number;
  /** The water the set is meant for, as a hint. */
  water?: Water;
  notes?: string;
}

export interface SiteWater {
  /** The dive site's name, as in the log. */
  name: string;
  water: Water;
  /** kg/L, when the site's water is known better than its kind. */
  density?: number;
}

export interface Kit {
  format: typeof KIT_FORMAT;
  version: number;
  updatedAt: string;
  diver: Diver;
  items: GearItem[];
  sets: GearSet[];
  sites: SiteWater[];
}

export const emptyKit = (updatedAt = ""): Kit => ({ format: KIT_FORMAT, version: KIT_VERSION, updatedAt, diver: {}, items: [], sets: [], sites: [] });

type Nullable<T> = { [K in keyof T]?: T[K] | null };

/** What the app or the agent sends: only what changes. A null field removes it. */
export interface KitChange {
  diver?: Nullable<Diver>;
  /** Added (no id, or an unknown one) or changed (a known id or name). */
  items?: (Nullable<Omit<GearItem, "id" | "name" | "kind">> & { id?: string; name?: string; kind?: GearKind })[];
  /** Items by id or name. */
  sets?: (Nullable<Omit<GearSet, "id" | "name" | "itemIds">> & { id?: string; name?: string; items?: string[] })[];
  /** A null water forgets the site. */
  sites?: { name: string; water: Water | null; density?: number | null }[];
  remove?: { items?: string[]; sets?: string[] };
}

export class KitInputError extends Error {}

/** Letters that don't decompose into a base letter and an accent. */
const PLAIN: Record<string, string> = { ł: "l", Ł: "L", ø: "o", Ø: "O", đ: "d", Đ: "D", ß: "ss", æ: "ae", Æ: "AE" };

/** Lower case, without accents: "Skrzydło" and "skrzydlo" are the same name. */
const fold = (text: string) =>
  text
    .replace(/[łŁøØđĐßæÆ]/g, (c) => PLAIN[c])
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();

const slug = (name: string) =>
  fold(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "item";

function uniqueId(name: string, taken: Set<string>): string {
  const base = slug(name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

const same = (a: string, b: string) => fold(a) === fold(b);

/** Finds by id first, then by name (case does not matter). */
function find<T extends { id: string; name: string }>(list: T[], ref: string): T | undefined {
  return list.find((x) => x.id === ref) ?? list.find((x) => same(x.name, ref));
}

const RANGES: Record<string, [number, number]> = {
  massKg: [20, 250],
  heightCm: [100, 230],
  bodyFatPercent: [3, 60],
  buoyancyKg: [-30, 30],
  thicknessMm: [0.5, 12],
  ageYears: [0, 40],
  volumeL: [0.2, 40],
  workingPressureBar: [50, 400],
  emptyBuoyancyKg: [-10, 10],
  ballastKg: [0, 40],
  density: [0.99, 1.25],
};

/** Copies the fields given onto `target`: null or "" removes one, a number must be in range. */
function apply(target: Record<string, unknown>, change: Record<string, unknown>, skip: string[] = []) {
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined || skip.includes(key)) continue;
    if (value === null || value === "") {
      delete target[key];
      continue;
    }
    const range = RANGES[key];
    if (range && (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]))
      throw new KitInputError(`${key} must be a number from ${range[0]} to ${range[1]}, not ${JSON.stringify(value)}.`);
    target[key] = typeof value === "string" ? value.trim() : value;
  }
}

/** The kit with the change applied; the input is left as it was. */
export function updateKit(kit: Kit, change: KitChange, now: string): Kit {
  const next: Kit = structuredClone(kit);
  next.updatedAt = now;
  if (change.diver) apply(next.diver as Record<string, unknown>, change.diver);

  const itemIds = new Set(next.items.map((i) => i.id));
  for (const c of change.items ?? []) {
    const known = (c.id && next.items.find((i) => i.id === c.id)) || (c.name && !c.id ? find(next.items, c.name) : undefined);
    if (known) {
      if (c.name?.trim()) known.name = c.name.trim();
      if (c.kind) {
        if (!GEAR_KINDS.includes(c.kind)) throw new KitInputError(`Unknown kind of gear "${c.kind}".`);
        known.kind = c.kind;
      }
      apply(known as unknown as Record<string, unknown>, c, ["id", "name", "kind"]);
    } else {
      if (!c.name?.trim()) throw new KitInputError("A new item needs a name.");
      if (!c.kind || !GEAR_KINDS.includes(c.kind)) throw new KitInputError(`"${c.name}" needs a kind: ${GEAR_KINDS.join(", ")}.`);
      const item: GearItem = { id: uniqueId(c.name, itemIds), name: c.name.trim(), kind: c.kind };
      apply(item as unknown as Record<string, unknown>, c, ["id", "name", "kind"]);
      next.items.push(item);
    }
  }

  const removedItems = new Set((change.remove?.items ?? []).map((ref) => find(next.items, ref)?.id ?? ref));
  next.items = next.items.filter((i) => !removedItems.has(i.id));
  for (const set of next.sets) set.itemIds = set.itemIds.filter((id) => !removedItems.has(id));

  const setIds = new Set(next.sets.map((s) => s.id));
  for (const c of change.sets ?? []) {
    const itemIdsOf = (refs: string[]) =>
      refs.map((ref) => {
        const item = find(next.items, ref);
        if (!item) throw new KitInputError(`No gear called "${ref}". Add it first, or use one of: ${next.items.map((i) => i.name).join(", ") || "(no gear yet)"}.`);
        return item.id;
      });
    const known = (c.id && next.sets.find((s) => s.id === c.id)) || (c.name && !c.id ? find(next.sets, c.name) : undefined);
    if (known) {
      if (c.name?.trim()) known.name = c.name.trim();
      if (c.items) known.itemIds = [...new Set(itemIdsOf(c.items))];
      apply(known as unknown as Record<string, unknown>, c, ["id", "name", "items"]);
    } else {
      if (!c.name?.trim()) throw new KitInputError("A new set needs a name.");
      const set: GearSet = { id: uniqueId(c.name, setIds), name: c.name.trim(), itemIds: [...new Set(itemIdsOf(c.items ?? []))] };
      apply(set as unknown as Record<string, unknown>, c, ["id", "name", "items"]);
      next.sets.push(set);
    }
  }
  const removedSets = new Set((change.remove?.sets ?? []).map((ref) => find(next.sets, ref)?.id ?? ref));
  next.sets = next.sets.filter((s) => !removedSets.has(s.id));

  for (const c of change.sites ?? []) {
    if (!c.name?.trim()) throw new KitInputError("A site needs its name.");
    const index = next.sites.findIndex((s) => same(s.name, c.name));
    if (c.water === null) {
      if (index >= 0) next.sites.splice(index, 1);
      continue;
    }
    if (!WATERS.includes(c.water)) throw new KitInputError(`Water is fresh, brackish or salt, not "${c.water}".`);
    const site: SiteWater = index >= 0 ? next.sites[index] : { name: c.name.trim(), water: c.water };
    site.water = c.water;
    apply(site as unknown as Record<string, unknown>, { density: c.density });
    if (index < 0) next.sites.push(site);
  }
  next.sites.sort((a, b) => a.name.localeCompare(b.name));
  return next;
}

/** A gear set by its id or name. */
export function findSet(kit: Kit, ref: string): GearSet | undefined {
  return find(kit.sets, ref);
}

/** The water of a dive: what the dive says, else what its site says. */
export function waterOf(kit: Kit, details: { water?: Water }, site: string | null | undefined): { water: Water; density: number; from: "dive" | "site" } | null {
  if (details.water) return { water: details.water, density: WATER_DENSITY[details.water], from: "dive" };
  const known = site ? kit.sites.find((s) => same(s.name, site)) : undefined;
  return known ? { water: known.water, density: known.density ?? WATER_DENSITY[known.water], from: "site" } : null;
}

/** A kit file read back: anything that isn't one is an empty kit. */
export function readKit(json: unknown): Kit {
  const k = json as Partial<Kit> | null;
  if (!k || k.format !== KIT_FORMAT) return emptyKit();
  return { ...emptyKit(), ...k, diver: k.diver ?? {}, items: k.items ?? [], sets: k.sets ?? [], sites: k.sites ?? [] } as Kit;
}
