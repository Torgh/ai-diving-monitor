"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useUnits } from "@/components/Units";
import { api, useLive } from "@/components/useLive";
import { GEAR_KINDS, type GearItem, type GearKind, type GearSet, type Kit, type KitChange, type Water, WATERS } from "@/lib/kit";
import type { Part, WeightingEstimate } from "@/lib/weighting";

type Data = Kit & { version: string; siteNames: string[]; estimates: Record<string, Record<Water, WeightingEstimate>> };

const KIND_LABEL: Record<GearKind, string> = {
  suit: "Suit",
  hood: "Hood",
  gloves: "Gloves",
  boots: "Boots",
  bcd: "BCD / wing",
  regulator: "Regulators",
  tank: "Tank",
  fins: "Fins",
  computer: "Computer",
  light: "Light",
  camera: "Camera",
  other: "Other",
};
const WATER_LABEL: Record<Water, string> = { fresh: "Fresh", brackish: "Brackish", salt: "Salt" };
const GROUPS: { title: string; kinds: GearKind[] }[] = [
  { title: "Exposure", kinds: ["suit", "hood", "gloves", "boots"] },
  { title: "BCD, tank, breathing", kinds: ["bcd", "tank", "regulator"] },
  { title: "Accessories", kinds: ["fins", "computer", "light", "camera", "other"] },
];

/** 24×24 stroke icons, one per kind of gear. */
const KIND_ICON: Record<GearKind, React.ReactNode> = {
  suit: <path d="M8 3h8l3 5-3 2v11H8V10L5 8z" />,
  hood: <path d="M6 12a6 6 0 0 1 12 0v6l-3 3H9l-3-3z" />,
  gloves: <path d="M8 21v-9l-2-3V5h2v4h1V3h2v6h1V3h2v6h1V5h2v8l-2 8z" />,
  boots: <path d="M7 3h5v11l7 3v4H7z" />,
  bcd: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="3" />
      <path d="M4 8c0 6 1 9 3 10M20 8c0 6-1 9-3 10" />
    </>
  ),
  regulator: (
    <>
      <circle cx="9" cy="10" r="5" />
      <path d="M14 10h4l2 3M9 15v5" />
    </>
  ),
  tank: (
    <>
      <rect x="8" y="5" width="8" height="16" rx="3" />
      <path d="M10 5V3h4v2" />
    </>
  ),
  fins: <path d="M9 3h6l2 18H7z" />,
  computer: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 6V3h6v3M9 18v3h6v-3" />
    </>
  ),
  light: <path d="M9 3h6v6l3 3v9H6v-9l3-3z" />,
  camera: (
    <>
      <rect x="3" y="7" width="13" height="11" rx="2" />
      <path d="M16 11l5-3v9l-5-3" />
    </>
  ),
  other: <path d="M3 9h18v5a3 3 0 0 1-3 3h-3l-3-3-3 3H6a3 3 0 0 1-3-3z" />,
};

function KindIcon({ kind }: { kind: GearKind }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      {KIND_ICON[kind]}
    </svg>
  );
}

/** "" leaves a number out (and removes it when editing); a comma works as the decimal point. */
const num = (text: string) => (text.trim() === "" ? null : Number(text.trim().replace(",", ".")));
const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));

function useSave() {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(change: KitChange): Promise<Kit | null> {
    setBusy(true);
    setFailure(null);
    try {
      return await api<Kit>("/api/kit", "PUT", change);
    } catch (err) {
      setFailure((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, failure };
}

function Failure({ text }: { text: string | null }) {
  return text ? (
    <span role="alert" style={{ color: "var(--critical)" }}>
      {text}
    </span>
  ) : null;
}

/** A buoyancy figure as a pill: blue floats, orange sinks, dashed when typical, amber when unknown. */
function BuoyancyPill({ part }: { part: Part | undefined }) {
  const { show } = useUnits();
  if (!part) return null;
  if (part.status === "unknown") return <span className="pill unknown">? kg</span>;
  const sign = part.kg > 0 ? "+" : part.kg < 0 ? "−" : "";
  const tone = part.kg > 0 ? "floats" : part.kg < 0 ? "sinks" : "zero";
  return (
    <span className={`pill ${tone} ${part.status === "typical" ? "typical" : ""}`} title={part.why}>
      {part.status === "typical" ? "≈ " : ""}
      {sign}
      {show("weight", Math.abs(part.kg))}
    </span>
  );
}

function DiverForm({ kit, onDone }: { kit: Kit; onDone: () => void }) {
  const [form, setForm] = useState({ massKg: str(kit.diver.massKg), heightCm: str(kit.diver.heightCm), bodyFatPercent: str(kit.diver.bodyFatPercent) });
  const { save, busy, failure } = useSave();
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await save({ diver: { massKg: num(form.massKg), heightCm: num(form.heightCm), bodyFatPercent: num(form.bodyFatPercent) } })) onDone();
  }
  return (
    <form className="form" onSubmit={submit} style={{ flexBasis: "100%" }}>
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
        <button className="button" type="button" onClick={onDone}>
          Cancel
        </button>
        <Failure text={failure} />
      </div>
    </form>
  );
}

function YouStrip({ kit, you, water, startEditing, onSaved }: { kit: Kit; you: Part | undefined; water: Water; startEditing: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(startEditing);
  const { show } = useUnits();
  const d = kit.diver;
  const facts = [
    d.massKg !== undefined ? show("weight", d.massKg) : null,
    d.heightCm !== undefined ? `${d.heightCm} cm` : null,
    d.bodyFatPercent !== undefined ? `${d.bodyFatPercent} % body fat` : null,
  ].filter(Boolean);
  return (
    <section className="card you-strip" aria-label="You">
      <span className="you-avatar" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
        </svg>
      </span>
      <div style={{ flex: "1 1 240px" }}>
        <strong>You</strong>
        <div className="secondary">{facts.length ? facts.join(" · ") : "Your body mass is needed for any estimate."}</div>
      </div>
      {you && (
        <div style={{ flex: "1 1 240px", fontSize: "0.9rem" }}>
          <div className="secondary">Your own buoyancy, normal breath</div>
          <div>
            <BuoyancyPill part={you} /> in {water} water
          </div>
        </div>
      )}
      {!editing && (
        <button className="button" type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      )}
      {editing && (
        <DiverForm
          kit={kit}
          onDone={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </section>
  );
}

const EMPTY_ITEM = {
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
type ItemForm = typeof EMPTY_ITEM;

const toForm = (item: GearItem): ItemForm => ({ ...EMPTY_ITEM, ...Object.fromEntries(Object.entries(item).map(([k, v]) => [k, str(v)])), kind: item.kind });

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
function ItemEditor({ initial, set, onDone }: { initial: ItemForm; set: GearSet | null; onDone: () => void }) {
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

function SetEditor({ kit, initial, onDone }: { kit: Kit; initial: GearSet | null; onDone: (setId?: string) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [items, setItems] = useState<string[]>(initial?.itemIds ?? []);
  const [ballast, setBallast] = useState(str(initial?.ballastKg));
  const [water, setWater] = useState<string>(initial?.water ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const { save, busy, failure } = useSave();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const change = { ...(initial ? { id: initial.id } : {}), name: name.trim(), items, ballastKg: num(ballast), water: (water || null) as Water | null, notes: notes.trim() || null };
    const saved = await save({ sets: [change] });
    if (saved) onDone(initial?.id ?? [...saved.sets].reverse().find((s) => s.name === name.trim())?.id);
  }
  async function remove() {
    if (initial && window.confirm(`Remove the set "${initial.name}"? Its gear stays.`) && (await save({ remove: { sets: [initial.id] } }))) onDone("");
  }
  const toggle = (id: string) => setItems(items.includes(id) ? items.filter((i) => i !== id) : [...items, id]);
  return (
    <form className="form card item-editor" onSubmit={submit}>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Lake, Warm sea" />
      </label>
      <label>
        Usual lead (kg)
        <input value={ballast} onChange={(e) => setBallast(e.target.value)} inputMode="decimal" placeholder="e.g. 4" />
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
          {!kit.items.length && <span className="muted">No gear yet: add the set now and its gear later.</span>}
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
        <button className="button" type="button" onClick={() => onDone()}>
          Cancel
        </button>
        {initial && (
          <button className="button" type="button" disabled={busy} onClick={remove} style={{ marginLeft: "auto" }}>
            Remove set
          </button>
        )}
        <Failure text={failure} />
      </div>
    </form>
  );
}

/** Bars from a centre line: what floats goes right in blue, what sinks goes left in orange. */
function BalanceCard({ estimate, hasTank, water, setWater }: { estimate: WeightingEstimate; hasTank: boolean; water: Water; setWater: (w: Water) => void }) {
  const { show } = useUnits();
  const parts = estimate.parts;
  const total = parts.reduce((s, p) => s + p.kg, 0);
  const shown = parts.filter((p) => p.label === "You" || p.kg !== 0 || p.status === "unknown");
  const zero = parts.filter((p) => !shown.includes(p));
  const half = Math.max(3, Math.ceil(Math.max(...parts.map((p) => Math.abs(p.kg)), Math.abs(total))));
  const signed = (kg: number) => `${kg > 0 ? "+" : kg < 0 ? "−" : ""}${show("weight", Math.abs(kg))}`;
  const bar = (kg: number, typical: boolean, strong = false) => {
    const width = Math.max(0.8, (Math.min(Math.abs(kg), half) / half) * 50);
    return <span className={`bar ${strong ? "total" : kg >= 0 ? "floats" : "sinks"} ${typical ? "typical" : ""}`} style={{ left: `${kg >= 0 ? 50 : 50 - width}%`, width: `${width}%` }} />;
  };
  return (
    <section className="card balance" aria-labelledby="bal-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h2 id="bal-h" style={{ margin: 0 }}>
            Buoyancy balance
          </h2>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            at the safety stop, empty BCD, 50 bar left
          </span>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Water">
          {WATERS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={water === w} onClick={() => setWater(w)}>
              {WATER_LABEL[w]}
            </button>
          ))}
        </div>
      </div>
      <div className="balance-axis" aria-hidden="true">
        <span>◂ sinks</span>
        <span>floats ▸</span>
      </div>
      <ul className="balance-rows" aria-label={`Buoyancy in ${water} water`}>
        {shown.map((p) => (
          <li key={p.label}>
            <span className="label">
              {p.label === "You" ? <strong>You</strong> : p.label}
              {p.status === "typical" && p.label !== "You" && <span className="tag">typical</span>}
            </span>
            {p.status === "unknown" ? (
              <span className="track unknown">not known: housings and lights often float 1 kg or more</span>
            ) : (
              <span className="track" title={p.why}>
                {bar(p.kg, p.status === "typical")}
              </span>
            )}
            <span className="value">{p.status === "unknown" ? "?" : signed(p.kg)}</span>
          </li>
        ))}
        {!hasTank && (
          <li>
            <span className="label secondary">Tank</span>
            <span className="track missing">not in this set: an aluminium 11 L floats about +1.1 kg at 50 bar, a steel 12 L sinks about 2 kg</span>
            <span className="value">–</span>
          </li>
        )}
        {zero.length > 0 && (
          <li className="zero">
            <details>
              <summary>
                {zero.length} more at 0 kg: {zero.map((p) => p.label).join(", ")}
              </summary>
              <span className="muted">Small things count as about 0. Add a measured buoyancy to any of them if you know it.</span>
            </details>
          </li>
        )}
        <li className="sum">
          <span className="label">
            <strong>Everything together</strong>
          </span>
          <span className="track">{bar(total, false, true)}</span>
          <span className="value">{signed(total)}</span>
        </li>
      </ul>
    </section>
  );
}

function ResultCard({ estimate, hasTank }: { estimate: WeightingEstimate; hasTank: boolean }) {
  const { show } = useUnits();
  const total = estimate.parts.reduce((s, p) => s + p.kg, 0);
  const c = estimate.confidence;
  return (
    <section className="card result" aria-labelledby="lead-h">
      <h2 id="lead-h" className="eyebrow" style={{ margin: 0 }}>
        Lead to carry · {estimate.water} water
      </h2>
      <div className="lead">{estimate.leadKg === null ? "–" : show("weight", estimate.leadKg)}</div>
      <p style={{ margin: 0 }}>
        {estimate.leadKg === null
          ? "Add your body mass first."
          : estimate.calibration
            ? `Corrected by ${estimate.calibration.dives} of your dives with this kind of kit (${estimate.calibration.offsetKg > 0 ? "+" : ""}${show("weight", estimate.calibration.offsetKg)} on the model).`
            : total < 0
              ? `Without lead your set already sinks ${show("weight", -total)}.${hasTank ? "" : " The tank will decide it."}`
              : `Your set floats ${show("weight", total)}; the lead takes it to neutral.`}
      </p>
      <div className="stack" style={{ gap: "0.35rem" }}>
        <div className="row" style={{ justifyContent: "space-between", fontSize: "0.85rem" }}>
          <strong>How sure</strong>
          <span className={`confidence ${c.level}`}>{c.level[0].toUpperCase() + c.level.slice(1)}</span>
        </div>
        <div className="meter" role="img" aria-label={`How sure: ${c.level}, ${c.score} of 100`}>
          <span className={`confidence-fill ${c.level}`} style={{ width: `${c.score}%` }} />
        </div>
        <ul className="secondary" style={{ margin: "0.2rem 0 0", paddingLeft: "1.1rem", fontSize: "0.9rem" }}>
          {c.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The few things that would make the estimate sure, each with a way to do it here. */
function MakeItSure({
  kit,
  set,
  estimate,
  hasTank,
  onAddTank,
  onEditYou,
  onSaved,
}: {
  kit: Kit;
  set: GearSet;
  estimate: WeightingEstimate;
  hasTank: boolean;
  onAddTank: () => void;
  onEditYou: () => void;
  onSaved: () => void;
}) {
  const { save, failure } = useSave();
  const [values, setValues] = useState<Record<string, string>>({});
  const unknown = estimate.parts.filter((p) => p.status === "unknown" && p.itemId);
  const d = kit.diver;
  const steps: { key: string; title: string; why: string; action: React.ReactNode }[] = [];
  if (!hasTank)
    steps.push({
      key: "tank",
      title: "Add the tank you dive with",
      why: "Steel sinks, aluminium floats when empty: the biggest unknown left. Rented ones too: material and volume are enough.",
      action: (
        <button className="button primary" type="button" onClick={onAddTank}>
          Add a tank
        </button>
      ),
    });
  for (const p of unknown) {
    const id = p.itemId!;
    steps.push({
      key: id,
      title: `${p.label}: its buoyancy`,
      why: "Hang it from a luggage scale in the pool: what it pulls down is negative; or push it under and see how much it floats.",
      action: (
        <form
          className="row"
          style={{ gap: "0.5rem" }}
          onSubmit={async (e) => {
            e.preventDefault();
            const v = num(values[id] ?? "");
            if (v !== null && (await save({ items: [{ id, buoyancyKg: v }] }))) onSaved();
          }}
        >
          <label className="row" style={{ gap: "0.4rem", fontSize: "0.9rem" }}>
            <span className="secondary">kg, + floats</span>
            <input className="small-input" value={values[id] ?? ""} onChange={(e) => setValues({ ...values, [id]: e.target.value })} inputMode="decimal" placeholder="e.g. +0.8" />
          </label>
          <button className="button" type="submit">
            Save
          </button>
        </form>
      ),
    });
  }
  if (d.heightCm === undefined || d.bodyFatPercent === undefined)
    steps.push({
      key: "you",
      title: `Add your ${[d.heightCm === undefined ? "height" : null, d.bodyFatPercent === undefined ? "body fat" : null].filter(Boolean).join(" and ")}`,
      why: "Body fat moves the estimate by about 1 kg per 5 %; height gives your suit's area and your lungs.",
      action: (
        <button className="button" type="button" onClick={onEditYou}>
          Edit you
        </button>
      ),
    });
  if (!estimate.calibration || estimate.calibration.dives < 3)
    steps.push({
      key: "dives",
      title: "Log the lead on your next dives",
      why: `On each dive with ${set.name}: the lead you carried and whether it felt too light, right or too heavy. Three dives correct the estimate to you.`,
      action: (
        <Link className="button" href="/dives">
          Open the dive log
        </Link>
      ),
    });
  if (!steps.length) return null;
  return (
    <section className="card" aria-labelledby="sure-h">
      <h2 id="sure-h">Make it sure</h2>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.key}>
            <span className="step-mark" role="img" aria-label={`Step ${i + 1}`}>
              {i + 1}
            </span>
            <div className="row" style={{ justifyContent: "space-between", flex: 1 }}>
              <div style={{ flex: "1 1 260px" }}>
                <strong>{s.title}</strong>
                <p className="secondary" style={{ fontSize: "0.9rem" }}>
                  {s.why}
                </p>
              </div>
              {s.action}
            </div>
          </li>
        ))}
      </ol>
      <Failure text={failure} />
    </section>
  );
}

/** What a piece of gear is, in a few short words. */
function chips(item: GearItem, weight: (kg: number) => string): string[] {
  return [
    item.kind === "suit" && item.thicknessMm && item.thicknessLimbsMm
      ? `${item.thicknessMm} mm torso · ${item.thicknessLimbsMm} mm limbs`
      : item.thicknessMm
        ? `${item.thicknessMm} mm`
        : null,
    item.undergarment ?? null,
    item.size ? `size ${item.size}` : null,
    item.ageYears !== undefined ? `${item.ageYears} y old` : null,
    item.volumeL ? `${item.volumeL} L` : null,
    item.workingPressureBar ? `${item.workingPressureBar} bar` : null,
    item.emptyBuoyancyKg !== undefined ? `empty ${item.emptyBuoyancyKg > 0 ? "+" : "−"}${weight(Math.abs(item.emptyBuoyancyKg))}` : null,
    item.weightKg !== undefined ? `${weight(item.weightKg)} on land` : null,
  ].filter((c): c is string => !!c);
}

function typeLine(item: GearItem): string {
  const kind = item.kind === "suit" && item.suitType ? { wetsuit: "Wetsuit", semidry: "Semi-dry", drysuit: "Drysuit" }[item.suitType] : KIND_LABEL[item.kind];
  const extra = item.kind === "bcd" && item.plate ? (item.plate === "none" ? "jacket" : `${item.plate} plate`) : item.kind === "tank" && item.material ? item.material : null;
  return [kind, extra, item.brand && item.brand !== item.name ? item.brand : null].filter(Boolean).join(" · ");
}

function GearCard({ item, part, onEdit, action }: { item: GearItem; part: Part | undefined; onEdit: () => void; action?: React.ReactNode }) {
  const { show } = useUnits();
  const list = chips(item, (kg) => show("weight", kg));
  return (
    <article className={`card gear-card ${part?.status === "unknown" ? "warn" : ""}`}>
      <div className="gear-card-head">
        <KindIcon kind={item.kind} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{item.name}</strong>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            {typeLine(item)}
          </div>
        </div>
        <BuoyancyPill part={part} />
      </div>
      {list.length > 0 && (
        <div className="chip-list">
          {list.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      )}
      {item.notes && (
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          {item.notes}
        </p>
      )}
      <div className="row" style={{ gap: "0.4rem", marginTop: "auto" }}>
        <button className="button small" type="button" onClick={onEdit}>
          Edit
        </button>
        {action}
      </div>
    </article>
  );
}

function ItemsSection({
  kit,
  set,
  parts,
  editing,
  setEditing,
  onSaved,
}: {
  kit: Kit;
  set: GearSet | null;
  parts: Part[];
  editing: ItemForm | null;
  setEditing: (form: ItemForm | null) => void;
  onSaved: () => void;
}) {
  const { show } = useUnits();
  const { save, failure } = useSave();
  const inSet = set ? kit.items.filter((i) => set.itemIds.includes(i.id)) : kit.items;
  const others = set ? kit.items.filter((i) => !set.itemIds.includes(i.id)) : [];
  const landWeight = inSet.reduce((s, i) => s + (i.weightKg ?? 0), 0);
  const done = () => {
    setEditing(null);
    onSaved();
  };
  const grid = (items: GearItem[], other = false) => (
    <div className="gear-grid">
      {items.map((item) =>
        editing?.id === item.id ? (
          <div key={item.id} style={{ gridColumn: "1 / -1" }}>
            <ItemEditor initial={editing} set={set} onDone={done} />
          </div>
        ) : (
          <GearCard
            key={item.id}
            item={item}
            part={parts.find((p) => p.itemId === item.id)}
            onEdit={() => setEditing(toForm(item))}
            action={
              other && set ? (
                <button
                  className="button small"
                  type="button"
                  onClick={async () => {
                    if (await save({ sets: [{ id: set.id, items: [...set.itemIds, item.id] }] })) onSaved();
                  }}
                >
                  Add to {set.name}
                </button>
              ) : undefined
            }
          />
        ),
      )}
    </div>
  );
  return (
    <section className="stack" style={{ gap: "0.75rem" }} aria-labelledby="items-h">
      <div className="chart-head">
        <h2 id="items-h" style={{ margin: 0 }}>
          {set ? "In this set" : "Your gear"}
        </h2>
        {landWeight > 0 && <span className="muted">{show("weight", landWeight)} on land, without tank and lead</span>}
      </div>
      {editing && editing.id === "" && <ItemEditor key={`new-${editing.kind}`} initial={editing} set={set} onDone={done} />}
      {!kit.items.length && <p className="muted">No gear yet. Start with your suit, BCD and tank: they matter most for weighting.</p>}
      {GROUPS.map((g) => {
        const items = inSet.filter((i) => g.kinds.includes(i.kind));
        return items.length ? (
          <div key={g.title} className="stack" style={{ gap: "0.5rem" }}>
            <h3 className="group-title">{g.title}</h3>
            {grid(items)}
          </div>
        ) : null;
      })}
      {others.length > 0 && (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <h3 className="group-title">Your other gear</h3>
          {grid(others, true)}
        </div>
      )}
      {parts.length > 0 && (
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
          <span className="pill floats">+ floats</span> <span className="pill sinks">− sinks</span> <span className="pill zero typical">≈ dashed</span>: a typical figure, not yours.
        </p>
      )}
      <Failure text={failure} />
    </section>
  );
}

function SitesCard({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const { save, failure } = useSave();
  const names = [...new Set([...data.siteNames, ...data.sites.map((s) => s.name)])].sort((a, b) => a.localeCompare(b));
  const waterAt = (name: string) => data.sites.find((s) => s.name.toLowerCase() === name.toLowerCase())?.water;
  async function choose(name: string, water: Water) {
    if (await save({ sites: [{ name, water: waterAt(name) === water ? null : water }] })) onSaved();
  }
  return (
    <section className="card stack" aria-labelledby="sites-h">
      <h2 id="sites-h" style={{ margin: 0 }}>
        Water at your dive sites
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Salt water carries about 2.5 % more than fresh. Every dive at a site takes its water; click the chosen one again to clear it.
      </p>
      {!names.length ? (
        <p className="muted">No dive sites yet: fill in the site of your dives first.</p>
      ) : (
        <ul className="gear-list">
          {names.map((name) => (
            <li key={name}>
              <strong>{name}</strong>
              <div className="segmented small" role="radiogroup" aria-label={`Water at ${name}`}>
                {WATERS.map((w) => (
                  <button key={w} type="button" role="radio" aria-checked={waterAt(name) === w} onClick={() => choose(name, w)}>
                    {WATER_LABEL[w]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Failure text={failure} />
    </section>
  );
}

export default function GearPage() {
  const { data, error, loading, reload } = useLive<Data>("/api/kit");
  const [setId, setSetId] = useState<string | null>(null);
  const [waterChoice, setWaterChoice] = useState<Water | null>(null);
  const [editingItem, setEditingItem] = useState<ItemForm | null>(null);
  const [editingSet, setEditingSet] = useState<GearSet | "new" | null>(null);
  const [editYou, setEditYou] = useState(0);
  if (error && !data) return <div className="error">Couldn&apos;t load your gear: {error}</div>;
  if (!data) return <p className="muted">Loading your gear…</p>;

  const set = data.sets.find((s) => s.id === setId) ?? data.sets[0] ?? null;
  const water = waterChoice ?? set?.water ?? "salt";
  const estimate = set ? data.estimates[set.id]?.[water] : undefined;
  const hasTank = !!set?.itemIds.some((id) => data.items.find((i) => i.id === id)?.kind === "tank");
  const you = estimate?.parts.find((p) => p.label === "You");
  const addItem = (kind: GearKind = "suit") => setEditingItem({ ...EMPTY_ITEM, kind, material: "aluminium" });

  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Gear</h1>
        <div className="row" style={{ gap: "0.5rem" }}>
          <button className="button" type="button" onClick={() => addItem()}>
            Add gear
          </button>
          <button className="button primary" type="button" onClick={() => setEditingSet("new")}>
            New set
          </button>
        </div>
      </div>

      <YouStrip key={editYou} kit={data} you={you} water={water} startEditing={editYou > 0} onSaved={reload} />

      <div className="tabs set-tabs" role="tablist" aria-label="Sets">
        {data.sets.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === set?.id}
            onClick={() => {
              setSetId(s.id);
              setWaterChoice(null);
              setEditingSet(null);
            }}
          >
            {s.name} <span className="muted">· {s.itemIds.length} items</span>
          </button>
        ))}
        <button type="button" role="tab" aria-selected={false} className="new-set" onClick={() => setEditingSet("new")}>
          + New set
        </button>
      </div>

      {editingSet && (
        <SetEditor
          key={editingSet === "new" ? "new" : editingSet.id}
          kit={data}
          initial={editingSet === "new" ? null : editingSet}
          onDone={(id) => {
            setEditingSet(null);
            if (id !== undefined) setSetId(id || null);
            reload();
          }}
        />
      )}

      {set && !editingSet && (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="secondary">
            {[set.ballastKg !== undefined ? `usually ${set.ballastKg} kg of lead` : null, set.water ? `meant for ${set.water} water` : null, set.notes].filter(Boolean).join(" · ") ||
              "No usual lead or water noted for this set."}
          </span>
          <button className="button small" type="button" onClick={() => setEditingSet(set)}>
            Edit set
          </button>
        </div>
      )}

      {!set && !editingSet && (
        <div className="notice row" style={{ justifyContent: "space-between" }}>
          <span>Put your gear together in a set (what you dive with in a lake, in warm water…): the page then shows how much lead it needs in each water.</span>
          <button className="button small" type="button" onClick={() => setEditingSet("new")}>
            Create a set
          </button>
        </div>
      )}

      {set && estimate && (
        <div className="balance-grid">
          <BalanceCard estimate={estimate} hasTank={hasTank} water={water} setWater={setWaterChoice} />
          <ResultCard estimate={estimate} hasTank={hasTank} />
        </div>
      )}

      {set && estimate && (
        <MakeItSure
          kit={data}
          set={set}
          estimate={estimate}
          hasTank={hasTank}
          onAddTank={() => addItem("tank")}
          onEditYou={() => setEditYou((n) => n + 1)}
          onSaved={reload}
        />
      )}

      <ItemsSection kit={data} set={set} parts={estimate?.parts ?? []} editing={editingItem} setEditing={setEditingItem} onSaved={reload} />

      <SitesCard data={data} onSaved={reload} />
    </div>
  );
}
