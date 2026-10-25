"use client";

import { type FormEvent, useState } from "react";
import { useUnits } from "@/components/Units";
import { api, useLive } from "@/components/useLive";
import { GEAR_KINDS, type GearItem, type GearKind, type GearSet, type Kit, type KitChange, type Water, WATERS } from "@/lib/kit";

type Data = Kit & { version: string; siteNames: string[] };

const KIND_LABEL: Record<GearKind, string> = {
  suit: "Suit",
  hood: "Hood",
  gloves: "Gloves",
  boots: "Boots",
  bcd: "BCD / wing",
  regulator: "Regulator",
  tank: "Tank",
  fins: "Fins",
  computer: "Computer",
  light: "Light",
  camera: "Camera",
  other: "Other",
};
const WATER_LABEL: Record<Water, string> = { fresh: "Fresh", brackish: "Brackish", salt: "Salt" };

/** "" leaves a number out (and removes it when editing); a comma works as the decimal point. */
const num = (text: string) => (text.trim() === "" ? null : Number(text.trim().replace(",", ".")));
const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));

/** One line of what matters about a piece of gear. */
function specs(item: GearItem, weight: (kg: number) => string): string {
  return [
    item.brand,
    item.suitType,
    item.thicknessMm ? `${item.thicknessMm} mm` : null,
    item.undergarment,
    item.size ? `size ${item.size}` : null,
    item.ageYears !== undefined ? `${item.ageYears} y old` : null,
    item.material,
    item.volumeL ? `${item.volumeL} L` : null,
    item.workingPressureBar ? `${item.workingPressureBar} bar` : null,
    item.emptyBuoyancyKg !== undefined ? `empty ${item.emptyBuoyancyKg > 0 ? "+" : ""}${weight(item.emptyBuoyancyKg)}` : null,
    item.plate && item.plate !== "none" ? `${item.plate} plate` : null,
    item.buoyancyKg !== undefined ? `buoyancy ${item.buoyancyKg > 0 ? "+" : ""}${weight(item.buoyancyKg)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function useSave() {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(change: KitChange): Promise<boolean> {
    setBusy(true);
    setFailure(null);
    try {
      await api("/api/kit", "PUT", change);
      return true;
    } catch (err) {
      setFailure((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, failure };
}

function DiverCard({ kit, onSaved }: { kit: Kit; onSaved: () => void }) {
  const [form, setForm] = useState({ massKg: str(kit.diver.massKg), heightCm: str(kit.diver.heightCm), bodyFatPercent: str(kit.diver.bodyFatPercent) });
  const { save, busy, failure } = useSave();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await save({ diver: { massKg: num(form.massKg), heightCm: num(form.heightCm), bodyFatPercent: num(form.bodyFatPercent) } })) onSaved();
  }
  return (
    <section className="card stack" aria-labelledby="you-h">
      <h2 id="you-h">You</h2>
      <p className="muted" style={{ margin: 0 }}>
        Your own buoyancy is the biggest unknown in weighting: fat floats, muscle sinks. Kept with your log, wherever it is stored.
      </p>
      <form className="form" onSubmit={submit}>
        <label>
          Body mass (kg)
          <input value={form.massKg} onChange={set("massKg")} inputMode="decimal" placeholder="e.g. 82" />
        </label>
        <label>
          Height (cm)
          <input value={form.heightCm} onChange={set("heightCm")} inputMode="decimal" placeholder="e.g. 183" />
        </label>
        <label>
          Body fat (%, if you know it)
          <input value={form.bodyFatPercent} onChange={set("bodyFatPercent")} inputMode="decimal" placeholder="e.g. 18" />
        </label>
        <div className="row wide">
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          {failure && <span role="alert" style={{ color: "var(--critical)" }}>{failure}</span>}
        </div>
      </form>
    </section>
  );
}

const EMPTY_ITEM = {
  id: "",
  name: "",
  kind: "suit" as GearKind,
  brand: "",
  buoyancyKg: "",
  suitType: "wetsuit",
  thicknessMm: "",
  undergarment: "",
  size: "",
  ageYears: "",
  material: "steel",
  volumeL: "",
  workingPressureBar: "",
  emptyBuoyancyKg: "",
  plate: "steel",
  notes: "",
};
type ItemForm = typeof EMPTY_ITEM;

const toForm = (item: GearItem): ItemForm => ({
  ...EMPTY_ITEM,
  ...Object.fromEntries(Object.entries(item).map(([k, v]) => [k, str(v)])),
  kind: item.kind,
});

/** Only the fields that belong to the kind are sent; the others are removed. */
function itemChange(form: ItemForm): NonNullable<KitChange["items"]>[number] {
  const k = form.kind;
  const neoprene = k === "suit" || k === "hood" || k === "gloves" || k === "boots";
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name.trim(),
    kind: k,
    brand: form.brand.trim() || null,
    notes: form.notes.trim() || null,
    buoyancyKg: num(form.buoyancyKg),
    suitType: k === "suit" ? (form.suitType as GearItem["suitType"]) : null,
    thicknessMm: neoprene && !(k === "suit" && form.suitType === "drysuit") ? num(form.thicknessMm) : null,
    undergarment: k === "suit" && form.suitType === "drysuit" ? form.undergarment.trim() || null : null,
    size: k === "suit" ? form.size.trim() || null : null,
    ageYears: neoprene ? num(form.ageYears) : null,
    material: k === "tank" ? (form.material as GearItem["material"]) : null,
    volumeL: k === "tank" ? num(form.volumeL) : null,
    workingPressureBar: k === "tank" ? num(form.workingPressureBar) : null,
    emptyBuoyancyKg: k === "tank" ? num(form.emptyBuoyancyKg) : null,
    plate: k === "bcd" ? (form.plate as GearItem["plate"]) : null,
  };
}

function ItemEditor({ initial, onDone }: { initial: ItemForm; onDone: () => void }) {
  const [form, setForm] = useState(initial);
  const { save, busy, failure } = useSave();
  const set = (key: keyof ItemForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const k = form.kind;
  const neoprene = k === "suit" || k === "hood" || k === "gloves" || k === "boots";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await save({ items: [itemChange(form)] })) onDone();
  }
  return (
    <form className="form card" onSubmit={submit} style={{ background: "var(--raised)" }}>
      <label>
        Name
        <input value={form.name} onChange={set("name")} required placeholder="e.g. Wetsuit 7 mm" />
      </label>
      <label>
        Kind
        <select value={form.kind} onChange={set("kind")}>
          {GEAR_KINDS.map((g) => (
            <option key={g} value={g}>
              {KIND_LABEL[g]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Brand, model
        <input value={form.brand} onChange={set("brand")} />
      </label>
      {k === "suit" && (
        <label>
          Suit
          <select value={form.suitType} onChange={set("suitType")}>
            <option value="wetsuit">Wetsuit</option>
            <option value="semidry">Semi-dry</option>
            <option value="drysuit">Drysuit</option>
          </select>
        </label>
      )}
      {neoprene && !(k === "suit" && form.suitType === "drysuit") && (
        <label>
          Neoprene (mm)
          <input value={form.thicknessMm} onChange={set("thicknessMm")} inputMode="decimal" placeholder="e.g. 7" />
        </label>
      )}
      {k === "suit" && form.suitType === "drysuit" && (
        <label>
          Undergarment
          <input value={form.undergarment} onChange={set("undergarment")} placeholder="e.g. 200 g fleece" />
        </label>
      )}
      {k === "suit" && (
        <label>
          Size
          <input value={form.size} onChange={set("size")} placeholder="e.g. L" />
        </label>
      )}
      {neoprene && (
        <label>
          Age (years)
          <input value={form.ageYears} onChange={set("ageYears")} inputMode="decimal" />
        </label>
      )}
      {k === "tank" && (
        <>
          <label>
            Material
            <select value={form.material} onChange={set("material")}>
              <option value="steel">Steel</option>
              <option value="aluminium">Aluminium</option>
              <option value="carbon">Carbon</option>
            </select>
          </label>
          <label>
            Volume (L)
            <input value={form.volumeL} onChange={set("volumeL")} inputMode="decimal" placeholder="e.g. 12" />
          </label>
          <label>
            Working pressure (bar)
            <input value={form.workingPressureBar} onChange={set("workingPressureBar")} inputMode="decimal" placeholder="e.g. 232" />
          </label>
          <label>
            Empty buoyancy (kg, + floats)
            <input value={form.emptyBuoyancyKg} onChange={set("emptyBuoyancyKg")} inputMode="decimal" placeholder="from the maker, e.g. -1.4" />
          </label>
        </>
      )}
      {k === "bcd" && (
        <label>
          Backplate
          <select value={form.plate} onChange={set("plate")}>
            <option value="steel">Steel</option>
            <option value="aluminium">Aluminium</option>
            <option value="none">None (jacket)</option>
          </select>
        </label>
      )}
      {k !== "tank" && (
        <label>
          Buoyancy in water (kg, + floats)
          <input value={form.buoyancyKg} onChange={set("buoyancyKg")} inputMode="decimal" placeholder="if you know it" />
        </label>
      )}
      <label className="wide">
        Notes
        <input value={form.notes} onChange={set("notes")} />
      </label>
      <div className="row wide">
        <button className="button primary" type="submit" disabled={busy || !form.name.trim()}>
          {busy ? "Saving…" : form.id ? "Save" : "Add"}
        </button>
        <button className="button" type="button" onClick={onDone}>
          Cancel
        </button>
        {failure && <span role="alert" style={{ color: "var(--critical)" }}>{failure}</span>}
      </div>
    </form>
  );
}

function GearCard({ kit, onSaved }: { kit: Kit; onSaved: () => void }) {
  const [editing, setEditing] = useState<ItemForm | null>(null);
  const { save, busy, failure } = useSave();
  const { show } = useUnits();
  const weight = (kg: number) => show("weight", kg);
  const done = () => {
    setEditing(null);
    onSaved();
  };
  async function remove(item: GearItem) {
    if (window.confirm(`Remove "${item.name}"? It also leaves the sets it is in.`) && (await save({ remove: { items: [item.id] } }))) onSaved();
  }
  const kinds = GEAR_KINDS.filter((k) => kit.items.some((i) => i.kind === k));
  return (
    <section className="card stack" aria-labelledby="gear-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="gear-h" style={{ margin: 0 }}>
          Gear
        </h2>
        {!editing && (
          <button className="button" type="button" onClick={() => setEditing(EMPTY_ITEM)}>
            Add gear
          </button>
        )}
      </div>
      {editing && <ItemEditor key={editing.id || "new"} initial={editing} onDone={done} />}
      {!kit.items.length && !editing && <p className="muted">No gear yet. Add your suit, tank and BCD first: they matter most for weighting.</p>}
      {kinds.map((k) => (
        <div key={k}>
          <h3 style={{ margin: "0.3rem 0" }}>{KIND_LABEL[k]}</h3>
          <ul className="gear-list">
            {kit.items
              .filter((i) => i.kind === k)
              .map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <div className="secondary" style={{ fontSize: "0.9rem" }}>
                      {specs(item, weight) || <span className="muted">no details</span>}
                    </div>
                  </div>
                  <span className="row" style={{ gap: "0.4rem" }}>
                    <button className="button" type="button" onClick={() => setEditing(toForm(item))}>
                      Edit
                    </button>
                    <button className="button" type="button" disabled={busy} onClick={() => remove(item)}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {failure && <div className="error">{failure}</div>}
    </section>
  );
}

function SetEditor({ kit, initial, onDone }: { kit: Kit; initial: GearSet | null; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [items, setItems] = useState<string[]>(initial?.itemIds ?? []);
  const [ballast, setBallast] = useState(str(initial?.ballastKg));
  const [water, setWater] = useState<string>(initial?.water ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const { save, busy, failure } = useSave();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const change = { ...(initial ? { id: initial.id } : {}), name: name.trim(), items, ballastKg: num(ballast), water: (water || null) as Water | null, notes: notes.trim() || null };
    if (await save({ sets: [change] })) onDone();
  }
  const toggle = (id: string) => setItems(items.includes(id) ? items.filter((i) => i !== id) : [...items, id]);
  return (
    <form className="form card" onSubmit={submit} style={{ background: "var(--raised)" }}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Lake, Warm sea" />
      </label>
      <label>
        Usual lead (kg)
        <input value={ballast} onChange={(e) => setBallast(e.target.value)} inputMode="decimal" placeholder="e.g. 8" />
      </label>
      <label>
        Meant for
        <select value={water} onChange={(e) => setWater(e.target.value)}>
          <option value="">Any water</option>
          {WATERS.map((w) => (
            <option key={w} value={w}>
              {WATER_LABEL[w]} water
            </option>
          ))}
        </select>
      </label>
      <fieldset className="wide" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="muted" style={{ fontSize: "0.85rem" }}>
          Gear in this set
        </legend>
        <div className="chips" style={{ marginTop: "0.4rem" }}>
          {kit.items.map((i) => (
            <button key={i.id} type="button" className="chip" aria-pressed={items.includes(i.id)} onClick={() => toggle(i.id)}>
              {i.name}
            </button>
          ))}
          {!kit.items.length && <span className="muted">Add gear first.</span>}
        </div>
      </fieldset>
      <label className="wide">
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 2 kg on the tank band" />
      </label>
      <div className="row wide">
        <button className="button primary" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Saving…" : initial ? "Save" : "Add set"}
        </button>
        <button className="button" type="button" onClick={onDone}>
          Cancel
        </button>
        {failure && <span role="alert" style={{ color: "var(--critical)" }}>{failure}</span>}
      </div>
    </form>
  );
}

function SetsCard({ kit, onSaved }: { kit: Kit; onSaved: () => void }) {
  const [editing, setEditing] = useState<GearSet | "new" | null>(null);
  const { save, busy, failure } = useSave();
  const { show } = useUnits();
  const done = () => {
    setEditing(null);
    onSaved();
  };
  async function remove(set: GearSet) {
    if (window.confirm(`Remove the set "${set.name}"? Its gear stays.`) && (await save({ remove: { sets: [set.id] } }))) onSaved();
  }
  return (
    <section className="card stack" aria-labelledby="sets-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="sets-h" style={{ margin: 0 }}>
          Sets
        </h2>
        {!editing && (
          <button className="button" type="button" onClick={() => setEditing("new")}>
            Add set
          </button>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        The gear you dive together, with the lead you usually carry. Pick a set on a dive&apos;s page, or tell your companion.
      </p>
      {editing && <SetEditor key={editing === "new" ? "new" : editing.id} kit={kit} initial={editing === "new" ? null : editing} onDone={done} />}
      <ul className="gear-list">
        {kit.sets.map((set) => (
          <li key={set.id}>
            <div>
              <strong>{set.name}</strong>
              <div className="secondary" style={{ fontSize: "0.9rem" }}>
                {[
                  set.ballastKg !== undefined ? `${show("weight", set.ballastKg)} lead` : null,
                  set.water ? `${WATER_LABEL[set.water].toLowerCase()} water` : null,
                  set.itemIds.map((id) => kit.items.find((i) => i.id === id)?.name ?? id).join(", ") || "no gear",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <span className="row" style={{ gap: "0.4rem" }}>
              <button className="button" type="button" onClick={() => setEditing(set)}>
                Edit
              </button>
              <button className="button" type="button" disabled={busy} onClick={() => remove(set)}>
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      {failure && <div className="error">{failure}</div>}
    </section>
  );
}

function SitesCard({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const { save, failure } = useSave();
  const names = [...new Set([...data.siteNames, ...data.sites.map((s) => s.name)])].sort((a, b) => a.localeCompare(b));
  const waterOf = (name: string) => data.sites.find((s) => s.name.toLowerCase() === name.toLowerCase())?.water ?? "";
  async function change(name: string, water: string) {
    if (await save({ sites: [{ name, water: (water || null) as Water | null }] })) onSaved();
  }
  return (
    <section className="card stack" aria-labelledby="sites-h">
      <h2 id="sites-h">Water at your dive sites</h2>
      <p className="muted" style={{ margin: 0 }}>
        Salt water carries about 2.5 % more than fresh: with you and your gear that is a few kilograms of lead. Every dive at a site takes its water; a
        dive can say otherwise.
      </p>
      {!names.length ? (
        <p className="muted">No dive sites yet: fill in the site of your dives first.</p>
      ) : (
        <ul className="gear-list">
          {names.map((name) => (
            <li key={name}>
              <strong>{name}</strong>
              <label className="row" style={{ gap: "0.5rem" }}>
                <span className="visually-hidden">Water at {name}</span>
                <select value={waterOf(name)} onChange={(e) => change(name, e.target.value)}>
                  <option value="">Not set</option>
                  {WATERS.map((w) => (
                    <option key={w} value={w}>
                      {WATER_LABEL[w]}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      )}
      {failure && <div className="error">{failure}</div>}
    </section>
  );
}

export default function GearPage() {
  const { data, error, loading, reload } = useLive<Data>("/api/kit");
  if (error && !data) return <div className="error">Couldn&apos;t load your gear: {error}</div>;
  if (!data) return <p className="muted">Loading your gear…</p>;
  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Gear</h1>
      </div>
      <DiverCard key={JSON.stringify(data.diver)} kit={data} onSaved={reload} />
      <GearCard kit={data} onSaved={reload} />
      <SetsCard kit={data} onSaved={reload} />
      <SitesCard data={data} onSaved={reload} />
    </div>
  );
}
