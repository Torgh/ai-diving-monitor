"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/Findings";
import { useLive } from "@/components/useLive";
import { formatDate, formatNumber } from "@/lib/format";
import type { LogView } from "@/lib/views";

type Data = LogView & { version: string; dataFolder: string };

export default function DiveLog() {
  const { data, error, loading } = useLive<Data>("/api/dives");
  if (error && !data) return <div className="error">Couldn&apos;t load the dive log: {error}</div>;
  if (!data) return <p className="muted">Loading the dive log…</p>;
  const dives = [...data.dives].reverse();
  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Dive log</h1>
        <span className="muted">
          {data.dives.length} dives · {data.dataFolder}
        </span>
      </div>
      {!dives.length ? (
        <div className="notice">
          No dives yet. <Link href="/import">Import your dives</Link>.
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="log">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Site</th>
                <th className="num">Max depth</th>
                <th className="num">Time</th>
                <th className="num">RMV</th>
                <th className="num">Peak ascent</th>
                <th>Gas</th>
                <th className="num">Score</th>
                <th>Status</th>
                <th>Debrief</th>
              </tr>
            </thead>
            <tbody>
              {dives.map((d) => (
                <tr key={d.id}>
                  <td>{d.seq}</td>
                  <td className="nowrap">
                    <Link href={`/dives/${d.id}`}>{formatDate(d.start)}</Link>
                  </td>
                  <td>{d.site || <span className="muted">–</span>}</td>
                  <td className="num">{formatNumber(d.maxDepthM, 1, "m")}</td>
                  <td className="num">{formatNumber(d.durationMin, 0, "min")}</td>
                  <td className="num">{formatNumber(d.rmvLMin, 1, "L/min")}</td>
                  <td className="num">{formatNumber(d.maxAscentRateMMin, 1, "m/min")}</td>
                  <td>{d.gases.join(", ") || <span className="muted">unknown</span>}</td>
                  <td className="num">{d.score}</td>
                  <td>
                    <StatusBadge severity={d.worstSeverity} />
                  </td>
                  <td>{d.hasReview ? "✓" : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
