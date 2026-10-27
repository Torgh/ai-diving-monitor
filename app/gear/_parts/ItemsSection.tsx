import { useUnits } from "@/components/Units";
import type { GearItem, GearSet, Kit } from "@/lib/kit";
import type { Part } from "@/lib/weighting";
import { GearCard } from "@/components/gear/GearCard";
import { ItemEditor, type ItemForm, toForm } from "./ItemEditor";
import { Failure, GROUPS, useSave } from "@/components/gear/shared";

export function ItemsSection({
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
