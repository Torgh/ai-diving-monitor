"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/Findings";
import { Icon } from "@/components/Icons";
import { Sparkline } from "@/components/Sparkline";
import { useUnits } from "@/components/Units";
import { useLive } from "@/components/useLive";
import { formatDate, formatNumber } from "@/lib/format";
import type { DiveRow, LogView } from "@/lib/views";

type Data = LogView & { version: string; dataFolder: string };

const FILTERS: { id: string; label: string; keep: (d: DiveRow, missing: Set<string>) => boolean }[] = [
  { id: "all", label: "All", keep: () => true },
  { id: "watch", label: "To watch", keep: (d) => d.worstSeverity === "warning" || d.worstSeverity === "critical" },
  { id: "debrief", label: "No debrief", keep: (d) => !d.hasReview },
  { id: "missing", label: "Missing details", keep: (d, missing) => missing.has(d.id) },
];

/** Matches the words typed against the dive's number, date, site and gas. */
function matches(d: DiveRow, query: string) {
  const text = `#${d.seq} ${formatDate(d.start)} ${d.site ?? ""} ${d.gases.join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

export default function DiveLog() {
  const { data, error, loading } = useLive<Data>("/api/dives");
  const { show } = useUnits();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  if (error && !data) return <div className="error">Couldn&apos;t load the dive log: {error}</div>;
  if (!data) return <p className="muted">Loading the dive log…</p>;

  // Dives missing a detail other than the debrief (tank size, gas, site).
  const missing = new Set(data.todos.filter((t) => t.kind !== "review").flatMap((t) => t.dives));
  const keep = FILTERS.find((f) => f.id === filter)!.keep;
  const dives = [...data.dives].reverse().filter((d) => keep(d, missing) && matches(d, query));

  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Dive log</h1>
        <Link className="button primary" href="/import">
          Import dives
        </Link>
      </div>
      {!data.dives.length ? (
        <div className="notice">
          No dives yet. <Link href="/import">Import your dives</Link>.
        </div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <span className="visually-hidden">Search</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by site, date, gas or #" />
            </label>
            <div className="chips" role="group" aria-label="Show">
              {FILTERS.map((f) => {
                const count = data.dives.filter((d) => f.keep(d, missing)).length;
                return (
                  <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                    {f.label} <span className="count">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {dives.length ? (
            <ul className="dive-list">
              {dives.map((d) => (
                <li key={d.id}>
                  <Link href={`/dives/${d.id}`} className="card dive-row">
                    <span className="seq">#{d.seq}</span>
                    <Sparkline depths={d.sparkline} />
                    <span className="main">
                      <strong>{d.site || <span className="muted">No site</span>}</strong>
                      <span className="secondary">
                        {[formatDate(d.start), show("depth", d.maxDepthM), formatNumber(d.durationMin, 0, "min"), d.gases.join(", ") || "gas unknown"].join(" · ")}
                      </span>
                    </span>
                    <span className="side">
                      <StatusBadge severity={d.worstSeverity} />
                      {d.hasReview && (
                        <span className="badge good" title="Debriefed">
                          {Icon.check}Debrief
                        </span>
                      )}
                      <span className="score" aria-label={`Score ${d.score}`}>
                        {d.score}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No dive matches. Clear the search or pick another filter.</p>
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            {data.dives.length} dives · {data.dataFolder}
          </p>
        </>
      )}
    </div>
  );
}
