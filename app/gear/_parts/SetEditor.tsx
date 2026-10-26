import { type FormEvent, useState } from "react";
import { type GearSet, type Kit, type Water, WATERS } from "@/lib/kit";
import { Failure, num, str, useSave, WATER_LABEL } from "./shared";

export function SetEditor({ kit, initial, onDone }: { kit: Kit; initial: GearSet | null; onDone: (setId?: string) => void }) {
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
