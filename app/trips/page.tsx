"use client";

import Link from "next/link";
import { TripPrepHint } from "@/components/TripPrepHint";
import { useLive } from "@/components/useLive";
import { formatDateRange, formatTripWhen } from "@/lib/format";
import type { TripRow } from "@/lib/tripViews";

type Data = { version: string; trips: TripRow[]; next: TripRow | null };

export default function Trips() {
  const { data, error, loading } = useLive<Data>("/api/trips");
  if (error && !data) return <div className="error">Couldn&apos;t load the trips: {error}</div>;
  if (!data) return <p className="muted">Loading the trips…</p>;
  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <h1>Trips</h1>
      {!data.trips.length ? (
        <div className="notice">
          No trips yet.
          <TripPrepHint />
        </div>
      ) : (
        <>
          <div className="card table-scroll">
            <table className="log">
              <thead>
                <tr>
                  <th>Trip</th>
                  <th>Dates</th>
                  <th>When</th>
                  <th className="num">Dive cards</th>
                  <th className="num">Prepared</th>
                  <th className="num">Logged dives</th>
                </tr>
              </thead>
              <tbody>
                {data.trips.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/trips/${t.id}`}>{t.name}</Link>
                      {t.destination && <div className="secondary">{t.destination}</div>}
                    </td>
                    <td className="nowrap">{formatDateRange(t.startDate, t.endDate)}</td>
                    <td className="nowrap">{formatTripWhen(t)}</td>
                    <td className="num">{t.cards}</td>
                    <td className="num">
                      {t.prepared} of {t.cards}
                    </td>
                    <td className="num">{t.loggedDives || <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TripPrepHint />
        </>
      )}
    </div>
  );
}
