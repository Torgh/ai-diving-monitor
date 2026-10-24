"use client";

import Link from "next/link";
import { LineChart } from "@/components/LineChart";
import { Findings } from "@/components/Findings";
import { useLive } from "@/components/useLive";
import { formatMinutes, formatNumber } from "@/lib/format";
import type { LogView, ProgressSeries } from "@/lib/views";

type Data = LogView & { version: string; dataFolder: string };

const UNIT: Record<string, string> = { rmvLMin: "L/min", maxAscentRateMMin: "m/min", safetyStopS: "s", score: "" };

function ProgressChart({ p }: { p: ProgressSeries }) {
  if (p.points.length < 2) {
    return (
      <div className="card">
        <h3>{p.label}</h3>
        <p className="muted">{p.points.length ? "One dive so far: the chart starts with the second." : "No dive has this value yet."}</p>
      </div>
    );
  }
  const x = p.points.map((pt) => pt.seq);
  const fit = p.fit;
  const fitAt = (seq: number) => (fit ? fit[0].value + ((fit[1].value - fit[0].value) * (seq - fit[0].seq)) / (fit[1].seq - fit[0].seq || 1) : null);
  const unit = UNIT[p.metric];
  const verdict = p.trend ? `${p.trend.verdict} (${p.trend.changePct > 0 ? "+" : ""}${p.trend.changePct}%)` : "trend after 3 dives";
  return (
    <div className="card">
      <div className="chart-head">
        <h3>{p.label}</h3>
        <span className="muted">
          {verdict}
          {p.better !== "neutral" ? ` · ${p.better} is better` : ""}
          {p.metric === "maxAscentRateMMin" ? " · line: 10 m/min recommended limit" : ""}
        </span>
      </div>
      <LineChart
        title={p.label}
        x={x}
        xUnit="Dive"
        formatX={(v) => `#${Math.round(v)}`}
        formatY={(v) => formatNumber(v, 1, unit)}
        height={180}
        includeY={p.metric === "score" ? [0, 100] : [0]}
        series={[
          { key: "value", label: p.label, color: "var(--series-1)", values: p.points.map((pt) => pt.value), dots: true },
          ...(fit ? [{ key: "trend", label: "Trend", color: "var(--series-muted)", values: x.map(fitAt), muted: true }] : []),
        ]}
        xTicks={x.filter((_, i) => i % Math.ceil(x.length / 8) === 0 || i === x.length - 1)}
        refLines={p.metric === "maxAscentRateMMin" ? [{ y: 10, label: "10 limit" }] : []}
      />
    </div>
  );
}

export default function Dashboard() {
  const { data, error, loading } = useLive<Data>("/api/dives");
  if (error && !data) return <div className="error">Couldn&apos;t load the dive log: {error}</div>;
  if (!data) return <p className="muted">Loading the dive log…</p>;
  if (!data.dives.length) {
    return (
      <div className="stack">
        <h1>Dashboard</h1>
        <div className="notice">
          Your dive log is empty. <Link href="/import">Import your dives</Link> from a UDDF export, migrate the Python version&apos;s log, or
          load the sample dives.
        </div>
        <p className="muted">Data folder: {data.dataFolder}</p>
      </div>
    );
  }
  const { totals } = data;
  const latest = data.dives[data.dives.length - 1];
  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <h1>Dashboard</h1>
      <div className="tiles">
        <div className="card tile">
          <div className="label">Dives logged</div>
          <div className="value">{totals.dives}</div>
        </div>
        <div className="card tile">
          <div className="label">Time underwater</div>
          <div className="value">{formatMinutes(totals.minutes)}</div>
        </div>
        <div className="card tile">
          <div className="label">Deepest dive</div>
          <div className="value">{formatNumber(totals.deepestM, 1, "m")}</div>
        </div>
        <div className="card tile">
          <div className="label">Latest dive score</div>
          <div className="value">{totals.latestScore ?? "–"}</div>
          <div className="note">
            <Link href={`/dives/${latest.id}`}>Dive #{latest.seq}</Link>
          </div>
        </div>
      </div>

      {data.todos.length > 0 && (
        <div className="card">
          <h2>To sort out</h2>
          <ul>
            {data.todos.map((t) => (
              <li key={t.kind}>
                {t.text.split(". ")[0]}:{" "}
                {t.seqs.slice(0, 8).map((seq, i) => (
                  <span key={seq}>
                    {i ? ", " : ""}
                    <Link href={`/dives/${t.dives[i]}`}>#{seq}</Link>
                  </span>
                ))}
                {t.seqs.length > 8 ? ` and ${t.seqs.length - 8} more` : ""}
              </li>
            ))}
          </ul>
          <p className="muted">
            Fill them in on each dive&apos;s page, or ask your coach in Claude Code: <code>/mcp__ai-diving-monitor__sort-out</code>.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Progress</h2>
        <Findings findings={data.insights} />
      </div>

      <div className="grid cols-2">
        {data.progress.map((p) => (
          <ProgressChart key={p.metric} p={p} />
        ))}
      </div>
    </div>
  );
}
