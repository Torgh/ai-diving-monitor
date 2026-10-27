import { useUnits } from "@/components/Units";
import type { GearItem } from "@/lib/kit";
import type { Part } from "@/lib/weighting";
import { BuoyancyPill, KIND_LABEL, KindIcon } from "./shared";

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

/** A piece of gear; without `onEdit` (the phone) only shown. */
export function GearCard({ item, part, onEdit, action }: { item: GearItem; part: Part | undefined; onEdit?: () => void; action?: React.ReactNode }) {
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
      {(onEdit || action) && (
        <div className="row" style={{ gap: "0.4rem", marginTop: "auto" }}>
          {onEdit && (
            <button className="button small" type="button" onClick={onEdit}>
              Edit
            </button>
          )}
          {action}
        </div>
      )}
    </article>
  );
}
