"use client";

import { TripCard } from "@/components/TripCard";
import { TripPrepHint } from "@/components/TripPrepHint";
import { useLive } from "@/components/useLive";
import type { TripRow } from "@/lib/tripViews";

type Data = { version: string; trips: TripRow[]; next: TripRow | null };

function Group({ title, trips }: { title: string; trips: TripRow[] }) {
  if (!trips.length) return null;
  return (
    <section className="stack" style={{ gap: "0.75rem" }} aria-label={title}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <div className="trip-cards">
        {trips.map((t) => (
          <TripCard key={t.id} trip={t} />
        ))}
      </div>
    </section>
  );
}

export default function Trips() {
  const { data, error, loading } = useLive<Data>("/api/trips");
  if (error && !data) return <div className="error">Couldn&apos;t load the trips: {error}</div>;
  if (!data) return <p className="muted">Loading the trips…</p>;
  const of = (...when: TripRow["when"][]) => data.trips.filter((t) => when.includes(t.when));
  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Trips</h1>
      </div>
      {!data.trips.length ? (
        <div className="notice">
          No trips yet.
          <TripPrepHint />
        </div>
      ) : (
        <>
          <Group title="Coming up" trips={of("now", "upcoming")} />
          <Group title="No dates yet" trips={of("undated")} />
          <Group title="Past" trips={of("past")} />
          <TripPrepHint />
        </>
      )}
    </div>
  );
}
