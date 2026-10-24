"use client";

import { type FormEvent, useState } from "react";
import { gasLabel } from "@/lib/dive";
import type { DiveDetails } from "@/lib/record";
import { api } from "./useLive";

/** What the dive computer doesn't record, filled in by the diver. Empty fields are removed. */
export function DetailsForm({ id, details, onSaved }: { id: string; details: DiveDetails; onSaved: () => void }) {
  const initial = {
    site: details.site ?? "",
    location: details.location ?? "",
    buddy: details.buddy ?? "",
    tankVolumeL: details.tankVolumeL?.toString() ?? "",
    gas: details.gas ? gasLabel({ id: "", name: "", ...details.gas }) : "",
    notes: details.notes ?? "",
  };
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    const volume = form.tankVolumeL.trim().replace(",", ".");
    if (volume && !(Number(volume) > 0)) {
      setStatus({ ok: false, text: "The tank volume is a number of litres, e.g. 12." });
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
