"use client";

import Link from "next/link";
import { useState } from "react";
import { Findings } from "@/components/Findings";
import { Icon } from "@/components/Icons";
import { TripCard } from "@/components/TripCard";
import { LineChart } from "@/components/LineChart";
import { api, useLive } from "@/components/useLive";
import { useSettings } from "@/components/useSettings";
import { formatDate, formatMinutes, formatNumber } from "@/lib/format";
import type { TodoKind } from "@/lib/record";
import type { TripRow } from "@/lib/tripViews";
import type { LogView, ProgressSeries } from "@/lib/views";
import { Command } from "@/components/Command";

type Data = LogView & { version: string; dataFolder: string };
type Todo = Data["todos"][number];

const UNIT: Record<string, string> = { rmvLMin: "L/min", maxAscentRateMMin: "m/min", safetyStopS: "s", score: "" };

/** The trips under way or coming, each with how far its preparation is. */
function UpcomingTrips() {
  const { data } = useLive<{ version: string; trips: TripRow[] }>("/api/trips");
  const trips = data?.trips.filter((t) => t.when === "now" || t.when === "upcoming") ?? [];
  if (!trips.length) return null;
  return (
    <section className="trip-cards" aria-label="Upcoming trips">
      {trips.map((t) => (
        <TripCard key={t.id} trip={t} />
      ))}
    </section>
  );
}

const TODO_COPY: Record<TodoKind, { title: string; why: string }> = {
  "tank-volume": { title: "Tank size", why: "Needed for your gas consumption (RMV)." },
  gas: { title: "Gas", why: "Needed to check ppO2, CNS and END." },
  site: { title: "Dive site", why: "Lets trip preparation find your dives at the same site." },
  review: { title: "Debrief", why: "Your companion's look at the dive." },
};

function DiveLinks({ todo }: { todo: Todo }) {
  return (
    <span className="why">
      {todo.seqs.slice(0, 8).map((seq, i) => (
        <span key={seq}>
          {i ? ", " : ""}
          <Link href={`/dives/${todo.dives[i]}`}>#{seq}</Link>
        </span>
      ))}
      {todo.seqs.length > 8 ? ` and ${todo.seqs.length - 8} more` : ""}
    </span>
  );
}

/** One value for every dive that misses it: most divers use the same tank and gas all along. */
function SaveForAll({ todo, field, label, placeholder, onSaved }: { todo: Todo; field: "tankVolumeL" | "gas"; label: string; placeholder: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const n = todo.dives.length;

  async function save() {
    const raw = value.trim().replace(",", ".");
    if (field === "tankVolumeL" && !(Number(raw) > 0)) {
      setFailure("The tank size is a number of litres, e.g. 12.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      for (const id of todo.dives) await api(`/api/dives/${id}`, "PATCH", { [field]: field === "tankVolumeL" ? Number(raw) : raw });
      setValue("");
      onSaved();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label>
        {label}
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} inputMode={field === "tankVolumeL" ? "decimal" : "text"} />
      </label>
      <button className="button primary" type="button" disabled={busy || !value.trim()} onClick={save}>
        {busy ? "Saving…" : `Save for ${n === 1 ? "this dive" : `${n} dives`}`}
      </button>
      {failure && (
        <span role="alert" style={{ color: "var(--critical)", flexBasis: "100%" }}>
          {failure}
        </span>
      )}
    </>
  );
}

/** A debrief here with an API key; with a subscription, the command to run in Claude Code or Codex. */
function DebriefAction({ todo, onSaved }: { todo: Todo; onSaved: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const provider = settings?.providers.find((p) => p.id === settings.provider);
  if (!provider) return null;
  const last = todo.dives.length - 1;
  if (!provider.usesApi || !provider.key) {
    return (
      <span className="muted">
        In {provider.app}: <Command text={`/mcp__divedeck__dive-review ${todo.seqs[last]}`} />
      </span>
    );
  }
  async function ask() {
    setBusy(true);
    setFailure(null);
    try {
      await api("/api/coach/review", "POST", { diveId: todo.dives[last] });
      onSaved();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="button" type="button" disabled={busy} onClick={ask}>
        {busy ? "Debriefing…" : `Get a debrief of #${todo.seqs[last]}`}
      </button>
      {failure && (
        <span role="alert" style={{ color: "var(--critical)", flexBasis: "100%" }}>
          {failure}
        </span>
      )}
    </>
  );
}

function SortOut({ todos, onSaved }: { todos: Todo[]; onSaved: () => void }) {
  return (
    <section className="card" aria-labelledby="todo-h">
      <h2 id="todo-h">To sort out</h2>
      {todos.map((t) => (
        <div key={t.kind} className="todo-row">
          <div className="what">
            <strong>{TODO_COPY[t.kind].title}</strong>
            <span className="why">{TODO_COPY[t.kind].why}</span>
            <DiveLinks todo={t} />
          </div>
          {t.kind === "tank-volume" && <SaveForAll todo={t} field="tankVolumeL" label="Tank (L)" placeholder="12" onSaved={onSaved} />}
          {t.kind === "gas" && <SaveForAll todo={t} field="gas" label="Gas" placeholder="air, EAN32" onSaved={onSaved} />}
          {t.kind === "site" && (
            <Link className="button" href={`/dives/${t.dives[0]}#details`}>
              Fill in #{t.seqs[0]}
            </Link>
          )}
          {t.kind === "review" && <DebriefAction todo={t} onSaved={onSaved} />}
        </div>
      ))}
      <p className="muted" style={{ marginBottom: 0 }}>
        Or ask your companion in Claude Code: <Command text="/mcp__divedeck__sort-out" />
      </p>
    </section>
  );
}

/** "worsening · 4.2 → 9.6 m/min", with an arrow for the direction and a colour for good or bad. */
function TrendNote({ p }: { p: ProgressSeries }) {
  if (!p.trend) return <span className="trend">trend after 3 dives</span>;
  const { verdict, earlyAvg, recentAvg } = p.trend;
  if (verdict === "stable") return <span className="trend">stable</span>;
  const tone = verdict === "improving" ? "good" : verdict === "worsening" ? "warning" : "";
  const unit = UNIT[p.metric];
  return (
    <span className={`trend ${tone}`}>
      {recentAvg > earlyAvg ? Icon.up : recentAvg < earlyAvg ? Icon.down : null}
      {verdict} · {formatNumber(earlyAvg, 1, "")} → {formatNumber(recentAvg, 1, unit)}
    </span>
  );
}

function ProgressChart({ p }: { p: ProgressSeries }) {
  const x = p.points.map((pt) => pt.seq);
  const fit = p.fit;
  // The score can't leave 0–100, so neither does its trend line (nor the axis with it).
  const clamp = (v: number) => (p.metric === "score" ? Math.min(100, Math.max(0, v)) : v);
  const fitAt = (seq: number) => (fit ? clamp(fit[0].value + ((fit[1].value - fit[0].value) * (seq - fit[0].seq)) / (fit[1].seq - fit[0].seq || 1)) : null);
  const unit = UNIT[p.metric];
  return (
    <div className="card">
      <div className="chart-head">
        <h3>{p.label}</h3>
        <TrendNote p={p} />
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
        refLines={p.metric === "maxAscentRateMMin" ? [{ y: 10, label: "10 m/min limit" }] : []}
      />
      <p className="muted" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
        {p.better !== "neutral" ? `${p.better === "lower" ? "Lower" : "Higher"} is better.` : ""}
      </p>
    </div>
  );
}

function Progress({ data }: { data: Data }) {
  const charted = data.progress.filter((p) => p.points.length >= 2);
  const waiting = data.progress.filter((p) => p.points.length < 2);
  // The trends of the charted metrics are on their charts; the rest (recurring issues…) stays a list.
  const labels = charted.map((p) => `${p.label}:`);
  const other = data.insights.filter((f) => !labels.some((l) => f.title.startsWith(l)));
  return (
    <section className="stack" aria-labelledby="prog-h">
      <div className="chart-head">
        <h2 id="prog-h" style={{ margin: 0 }}>
          Progress
        </h2>
        {waiting.length > 0 && (
          <span className="muted">
            {waiting
              .map((p) =>
                p.metric === "rmvLMin" && p.points.length === 0 ? `${p.label} shows up once tank sizes are filled in` : `${p.label} starts with the second dive`,
              )
              .join(" · ")}
          </span>
        )}
      </div>
      {other.length > 0 && (
        <div className="card">
          <Findings findings={other} />
        </div>
      )}
      <div className="grid cols-2">
        {charted.map((p) => (
          <ProgressChart key={p.metric} p={p} />
        ))}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useLive<Data>("/api/dives");
  if (error && !data) return <div className="error">Couldn&apos;t load the dive log: {error}</div>;
  if (!data) return <p className="muted">Loading the dive log…</p>;
  const head = (
    <div className="page-head">
      <h1>Dashboard</h1>
      <Link className="button primary" href="/import">
        Import dives
      </Link>
    </div>
  );
  if (!data.dives.length) {
    return (
      <div className="stack">
        {head}
        <UpcomingTrips />
        <div className="notice">
          Your dive log is empty. <Link href="/import">Import your dives</Link> from a UDDF export, migrate the Python version&apos;s log, or
          load the sample dives.
        </div>
        <p className="muted">Data folder: {data.dataFolder}</p>
      </div>
    );
  }
  const { totals, dives } = data;
  const latest = dives[dives.length - 1];
  const deepest = dives.reduce((a, b) => (b.maxDepthM > a.maxDepthM ? b : a));
  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      {head}
      <UpcomingTrips />
      <section className="tiles" aria-label="Summary">
        <div className="card tile">
          <div className="label">Dives</div>
          <div className="value">{totals.dives}</div>
          <div className="note">{dives[0].start ? `since ${formatDate(dives[0].start, false)}` : ""}</div>
        </div>
        <div className="card tile">
          <div className="label">Time underwater</div>
          <div className="value">{formatMinutes(totals.minutes)}</div>
          <div className="note">{formatMinutes(totals.minutes / totals.dives)} on average</div>
        </div>
        <div className="card tile">
          <div className="label">Deepest</div>
          <div className="value">{formatNumber(totals.deepestM, 1, "m")}</div>
          <div className="note">
            <Link href={`/dives/${deepest.id}`}>dive #{deepest.seq}</Link>
          </div>
        </div>
        <div className="card tile">
          <div className="label">Latest score</div>
          <div className="value">{totals.latestScore ?? "–"}</div>
          <div className="note">
            <Link href={`/dives/${latest.id}`}>dive #{latest.seq} ›</Link>
          </div>
        </div>
      </section>

      {data.todos.length > 0 && <SortOut todos={data.todos} onSaved={reload} />}

      <Progress data={data} />
    </div>
  );
}
