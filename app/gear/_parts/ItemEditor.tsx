import { type FormEvent, useState } from "react";
import { GEAR_KINDS, type GearItem, type GearKind, type GearSet, type KitChange } from "@/lib/kit";
import { Failure, KIND_LABEL, num, str, useSave } from "@/components/gear/shared";

export const EMPTY_ITEM = {
  id: "",
  name: "",
  kind: "suit" as GearKind,
  brand: "",
  buoyancyKg: "",
  weightKg: "",
  suitType: "wetsuit",
  thicknessMm: "",
  thicknessLimbsMm: "",
  undergarment: "",
  size: "",
  ageYears: "",
  material: "aluminium",
  volumeL: "",
  workingPressureBar: "",
  emptyBuoyancyKg: "",
  plate: "steel",
  notes: "",
};
export type ItemForm = typeof EMPTY_ITEM;

export const toForm = (item: GearItem): ItemForm => ({ ...EMPTY_ITEM, ...Object.fromEntries(Object.entries(item).map(([k, v]) => [k, str(v)])), kind: item.kind });

/** Only the fields that belong to the kind are sent; the others are removed. */
function itemChange(form: ItemForm): NonNullable<KitChange["items"]>[number] {
  const k = form.kind;
  const neoprene = k === "suit" || k === "hood" || k === "gloves" || k === "boots";
  const dry = k === "suit" && form.suitType === "drysuit";
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name.trim(),
    kind: k,
    brand: form.brand.trim() || null,
    notes: form.notes.trim() || null,
    buoyancyKg: k === "tank" ? null : num(form.buoyancyKg),
    weightKg: num(form.weightKg),
    suitType: k === "suit" ? (form.suitType as GearItem["suitType"]) : null,
    thicknessMm: neoprene && !dry ? num(form.thicknessMm) : null,
    thicknessLimbsMm: k === "suit" && !dry ? num(form.thicknessLimbsMm) : null,
    undergarment: dry ? form.undergarment.trim() || null : null,
    size: k === "suit" || k === "boots" || k === "fins" ? form.size.trim() || null : null,
    ageYears: neoprene ? num(form.ageYears) : null,
    material: k === "tank" ? (form.material as GearItem["material"]) : null,
    volumeL: k === "tank" ? num(form.volumeL) : null,
    workingPressureBar: k === "tank" ? num(form.workingPressureBar) : null,
    emptyBuoyancyKg: k === "tank" ? num(form.emptyBuoyancyKg) : null,
    plate: k === "bcd" ? (form.plate as GearItem["plate"]) : null,
  };
}

/** Adds or changes a piece of gear; a new one can go straight into the set on screen. */
export function ItemEditor({ initial, set, onDone }: { initial: ItemForm; set: GearSet | null; onDone: () => void }) {
  const [form, setForm] = useState(initial);
  const [intoSet, setIntoSet] = useState(!!set && !initial.id);
  const { save, busy, failure } = useSave();
  const field = (key: keyof ItemForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const k = form.kind;
  const neoprene = k === "suit" || k === "hood" || k === "gloves" || k === "boots";
  const dry = k === "suit" && form.suitType === "drysuit";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const kit = await save({ items: [itemChange(form)] });
    if (!kit) return;
    if (intoSet && set) {
      const added = [...kit.items].reverse().find((i) => i.name === form.name.trim());
      if (added && !set.itemIds.includes(added.id) && !(await save({ sets: [{ id: set.id, items: [...set.itemIds, added.id] }] }))) return;
    }
    onDone();
  }
  async function remove() {
    if (window.confirm(`Remove "${form.name}"? It also leaves the sets it is in.`) && (await save({ remove: { items: [form.id] } }))) onDone();
  }

  return (
    <form className="form card item-editor" onSubmit={submit}>
      <label>
        Name
        <input value={form.name} onChange={field("name")} required placeholder="e.g. Wetsuit 5 mm" />
      </label>
      <label>
        Kind
        <select value={form.kind} onChange={field("kind")}>
          {GEAR_KINDS.map((g) => (
            <option key={g} value={g}>
              {KIND_LABEL[g]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Brand, model
        <input value={form.brand} onChange={field("brand")} />
      </label>
      {k === "suit" && (
        <label>
          Suit
          <select value={form.suitType} onChange={field("suitType")}>
            <option value="wetsuit">Wetsuit</option>
            <option value="semidry">Semi-dry</option>
            <option value="drysuit">Drysuit</option>
          </select>
        </label>
      )}
      {neoprene && !dry && (
        <label>
          {k === "suit" ? "Torso (mm)" : "Neoprene (mm)"}
          <input value={form.thicknessMm} onChange={field("thicknessMm")} inputMode="decimal" placeholder="e.g. 3" />
        </label>
      )}
      {k === "suit" && !dry && (
        <label>
          Arms and legs (mm, if thinner)
          <input value={form.thicknessLimbsMm} onChange={field("thicknessLimbsMm")} inputMode="decimal" placeholder="e.g. 2 for a 3/2" />
        </label>
      )}
      {dry && (
        <label>
          Undergarment
          <input value={form.undergarment} onChange={field("undergarment")} placeholder="e.g. 200 g fleece" />
        </label>
      )}
      {(k === "suit" || k === "boots" || k === "fins") && (
        <label>
          Size
          <input value={form.size} onChange={field("size")} placeholder="e.g. M" />
        </label>
      )}
      {neoprene && (
        <label>
          Age (years)
          <input value={form.ageYears} onChange={field("ageYears")} inputMode="decimal" />
        </label>
      )}
      {k === "tank" && (
        <>
          <label>
            Material
            <select value={form.material} onChange={field("material")}>
              <option value="aluminium">Aluminium</option>
              <option value="steel">Steel</option>
              <option value="carbon">Carbon</option>
            </select>
          </label>
          <label>
            Volume (L)
            <input value={form.volumeL} onChange={field("volumeL")} inputMode="decimal" placeholder="e.g. 11.1" />
          </label>
          <label>
            Working pressure (bar)
            <input value={form.workingPressureBar} onChange={field("workingPressureBar")} inputMode="decimal" placeholder="e.g. 207" />
          </label>
          <label>
            Empty buoyancy (kg, + floats)
            <input value={form.emptyBuoyancyKg} onChange={field("emptyBuoyancyKg")} inputMode="decimal" placeholder="maker's sheet, e.g. +1.8" />
          </label>
        </>
      )}
      {k === "bcd" && (
        <label>
          Backplate
          <select value={form.plate} onChange={field("plate")}>
            <option value="steel">Steel</option>
            <option value="aluminium">Aluminium</option>
            <option value="none">None (jacket)</option>
          </select>
        </label>
      )}
      {k !== "tank" && (
        <label>
          Buoyancy in water (kg, + floats)
          <input value={form.buoyancyKg} onChange={field("buoyancyKg")} inputMode="decimal" placeholder="if you weighed it" />
        </label>
      )}
      <label>
        Weight on land (kg)
        <input value={form.weightKg} onChange={field("weightKg")} inputMode="decimal" />
      </label>
      <label className="wide">
        Notes
        <input value={form.notes} onChange={field("notes")} />
      </label>
      {set && !initial.id && (
        <label className="wide check">
          <input type="checkbox" checked={intoSet} onChange={(e) => setIntoSet(e.target.checked)} />
          Add it to {set.name}
        </label>
      )}
      <div className="row wide">
        <button className="button primary" type="submit" disabled={busy || !form.name.trim()}>
          {busy ? "Saving…" : initial.id ? "Save" : "Add"}
        </button>
        <button className="button" type="button" onClick={onDone}>
          Cancel
        </button>
        {initial.id && (
          <button className="button" type="button" disabled={busy} onClick={remove} style={{ marginLeft: "auto" }}>
            Remove
          </button>
        )}
        <Failure text={failure} />
      </div>
    </form>
  );
}
