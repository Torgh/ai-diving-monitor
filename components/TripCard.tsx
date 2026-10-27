import Link from "next/link";
import { formatDateRange, formatTripWhen } from "@/lib/format";
import type { TripRow } from "@/lib/tripViews";
import { Icon } from "./Icons";
import { useUnits } from "./Units";

/**
 * A trip as a card: when, where, and how far its preparation is (or, once past, the dives logged).
 * Opens the trip.
 */
export function TripCard({ trip: t }: { trip: TripRow }) {
  const { range } = useUnits();
  const left = t.cards - t.prepared;
  const depth = (s: TripRow["chosenSites"][number]) => range("depth", s.minDepthM, s.maxDepthM);
  const past = t.when === "past";
  return (
    <Link href={`/trips/${t.id}`} className="card trip-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="eyebrow">{formatTripWhen(t)}</span>
        {past ? (
          <span className="badge">
            {t.loggedDives} dive{t.loggedDives === 1 ? "" : "s"} logged
          </span>
        ) : (
          t.cards > 0 &&
          (t.toCheck > 0 || left > 0 ? (
            <span className="badge warning">
              {Icon.alert}
              {[t.toCheck ? `${t.toCheck} to check` : null, left ? `${left} to prepare` : null].filter(Boolean).join(" · ")}
            </span>
          ) : (
            <span className="badge good">{Icon.check}All prepared</span>
          ))
        )}
      </div>
      <h2>{t.name}</h2>
      <span className="secondary">
        {[
          formatDateRange(t.startDate, t.endDate),
          t.destination?.toLowerCase() === t.name.toLowerCase() ? null : t.destination,
          t.diveDays ? `${t.diveDays} dive day${t.diveDays === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {!past && t.openTodos > 0 && (
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {t.openTodos} to sort out before you go
        </span>
      )}
      {t.chosenSites.length > 0 && (
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          Dive sites: {t.chosenSites.map((s) => [s.name, depth(s)].filter(Boolean).join(" ")).join(" · ")}
        </span>
      )}
      {!past && t.cards > 0 && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <div className="meter" role="img" aria-label={`${t.prepared} of ${t.cards} dive cards prepared`}>
            <span style={{ width: `${(100 * t.prepared) / t.cards}%` }} />
          </div>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            {t.prepared} of {t.cards} dive cards prepared
          </span>
        </div>
      )}
    </Link>
  );
}
