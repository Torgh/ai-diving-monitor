import { useUnits } from "@/components/Units";
import { type Water, WATERS } from "@/lib/kit";
import type { WeightingEstimate } from "@/lib/weighting";
import { WATER_LABEL } from "./shared";

/** Bars from a centre line: what floats goes right in blue, what sinks goes left in orange. */
export function BalanceCard({ estimate, hasTank, water, setWater }: { estimate: WeightingEstimate; hasTank: boolean; water: Water; setWater: (w: Water) => void }) {
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
