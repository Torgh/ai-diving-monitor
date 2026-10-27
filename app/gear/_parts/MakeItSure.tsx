import Link from "next/link";
import { useState } from "react";
import type { GearSet, Kit } from "@/lib/kit";
import type { WeightingEstimate } from "@/lib/weighting";
import { Failure, num, useSave } from "@/components/gear/shared";

/** The few things that would make the estimate sure, each with a way to do it here. */
export function MakeItSure({
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
