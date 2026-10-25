"use client";

import { type FormEvent, useState } from "react";
import { gasLabel } from "@/lib/dive";
import { type Kit, waterOf } from "@/lib/kit";
import type { DiveDetails } from "@/lib/record";
import { api } from "./useLive";

/** What the dive computer doesn't record, filled in by the diver. Empty fields are removed. */
export function DetailsForm({ id, details, site, kit, onSaved }: { id: string; details: DiveDetails; site: string | null; kit: Kit | null; onSaved: () => void }) {
  const initial = {
    site: details.site ?? "",
    location: details.location ?? "",
    buddy: details.buddy ?? "",
    tankVolumeL: details.tankVolumeL?.toString() ?? "",
    gas: details.gas ? gasLabel({ id: "", name: "", ...details.gas }) : "",
    notes: details.notes ?? "",
    gearSetId: details.gearSetId ?? "",
    ballastKg: details.ballastKg?.toString() ?? "",
    water: details.water ?? "",
    weighting: details.weighting ?? "",
  };
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // The site's water, shown as what an unset dive takes.
  const siteWater = kit ? (waterOf(kit, {}, site)?.water ?? null) : null;
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const volume = form.tankVolumeL.trim().replace(",", ".");
    if (volume && !(Number(volume) > 0)) {
      setStatus({ ok: false, text: "The tank volume is a number of litres, e.g. 12." });
      return;
    }
    const lead = form.ballastKg.trim().replace(",", ".");
    if (lead && !(Number(lead) >= 0)) {
      setStatus({ ok: false, text: "The lead is a number of kilograms, e.g. 8." });
      return;
    }
    setSaving(true);
    try {
      await api(`/api/dives/${id}`, "PATCH", {
        site: form.site,
        location: form.location,
        buddy: form.buddy,
        notes: form.notes,
        tankVolumeL: volume ? Number(volume) : null,
        gas: form.gas.trim() || null,
        gearSetId: form.gearSetId || null,
        ballastKg: lead ? Number(lead) : null,
        water: form.water || null,
        weighting: form.weighting || null,
      });
      setStatus({ ok: true, text: "Saved. The analysis below uses it now." });
      onSaved();
    } catch (err) {
      setStatus({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label>
        Dive site
        <input value={form.site} onChange={set("site")} placeholder="e.g. Koparki" />
      </label>
      <label>
        Location
        <input value={form.location} onChange={set("location")} placeholder="Region or country" />
      </label>
      <label>
        Buddy
        <input value={form.buddy} onChange={set("buddy")} />
      </label>
      <label>
        Tank volume (L)
        <input value={form.tankVolumeL} onChange={set("tankVolumeL")} inputMode="decimal" placeholder="e.g. 12, or 24 for twin 12s" />
      </label>
      <label>
        Gas
        <input value={form.gas} onChange={set("gas")} placeholder="air, EAN32, Tx 18/45" />
      </label>
      <label>
        Gear set
        <select value={form.gearSetId} onChange={set("gearSetId")}>
          <option value="">{kit?.sets.length ? "None" : "No sets yet (Gear page)"}</option>
          {kit?.sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lead carried (kg)
        <input
          value={form.ballastKg}
          onChange={set("ballastKg")}
          inputMode="decimal"
          placeholder={(() => {
            const usual = kit?.sets.find((s) => s.id === form.gearSetId)?.ballastKg;
            return usual !== undefined ? `usually ${usual}` : "e.g. 8";
          })()}
        />
      </label>
      <label>
        Water
        <select value={form.water} onChange={set("water")}>
          <option value="">{siteWater ? `As the site: ${siteWater}` : "Not set (set it per site on the Gear page)"}</option>
          <option value="fresh">Fresh</option>
          <option value="brackish">Brackish</option>
          <option value="salt">Salt</option>
        </select>
      </label>
      <label>
        Weighting felt
        <select value={form.weighting} onChange={set("weighting")}>
          <option value="">Not noted</option>
          <option value="light">Too light</option>
          <option value="ok">Just right</option>
          <option value="heavy">Too heavy</option>
        </select>
      </label>
      <label className="wide">
        Notes
        <textarea value={form.notes} onChange={set("notes")} rows={3} />
      </label>
      <div className="row wide">
        <button className="button primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save details"}
        </button>
        {status && (
          <span className={status.ok ? "secondary" : ""} role="status" style={status.ok ? undefined : { color: "var(--critical)" }}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
