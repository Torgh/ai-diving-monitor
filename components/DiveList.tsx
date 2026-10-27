import Link from "next/link";
import { useState } from "react";
import { formatDate, formatNumber } from "@/lib/format";
import type { DiveRow, LogView } from "@/lib/views";
import { StatusBadge } from "./Findings";
import { Icon } from "./Icons";
import { Sparkline } from "./Sparkline";
import { useUnits } from "./Units";

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

/** The dives, newest first, with a search and filters. Shared by the web app and the phone app. */
export function DiveList({ log }: { log: Pick<LogView, "dives" | "todos"> }) {
  const { show } = useUnits();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");

  // Dives missing a detail other than the debrief (tank size, gas, site).
  const missing = new Set(log.todos.filter((t) => t.kind !== "review").flatMap((t) => t.dives));
  const keep = FILTERS.find((f) => f.id === filter)!.keep;
  const dives = [...log.dives].reverse().filter((d) => keep(d, missing) && matches(d, query));

  return (
    <>
      <div className="toolbar">
        <label className="search">
          <span className="visually-hidden">Search</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by site, date, gas or #" />
        </label>
        <div className="chips" role="group" aria-label="Show">
          {FILTERS.map((f) => {
            const count = log.dives.filter((d) => f.keep(d, missing)).length;
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
    </>
  );
}
