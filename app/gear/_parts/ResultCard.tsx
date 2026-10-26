import { useUnits } from "@/components/Units";
import type { WeightingEstimate } from "@/lib/weighting";

export function ResultCard({ estimate, hasTank }: { estimate: WeightingEstimate; hasTank: boolean }) {
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
