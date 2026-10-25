"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DetailsForm } from "@/components/DetailsForm";
import { Findings } from "@/components/Findings";
import { ProfileCharts } from "@/components/ProfileCharts";
import { api, useLive } from "@/components/useLive";
import { useSettings } from "@/components/useSettings";
import type { DiveMetrics } from "@/lib/analysis";
import { formatDate, formatNumber, formatSeconds } from "@/lib/format";
import type { DiveView } from "@/lib/views";

type Data = DiveView & { version: string };

const TILES: { key: keyof DiveMetrics; label: string; format: (v: number) => string }[] = [
  { key: "maxDepthM", label: "Max depth", format: (v) => formatNumber(v, 1, "m") },
  { key: "durationMin", label: "Duration", format: (v) => formatNumber(v, 0, "min") },
  { key: "rmvLMin", label: "Gas consumption (RMV)", format: (v) => formatNumber(v, 1, "L/min") },
  { key: "maxAscentRateMMin", label: "Peak ascent rate", format: (v) => formatNumber(v, 1, "m/min") },
  { key: "safetyStopS", label: "Time at 3–6 m on the way up", format: formatSeconds },
  { key: "endPressureBar", label: "Gas left", format: (v) => formatNumber(v, 0, "bar") },
  { key: "cnsPercent", label: "CNS", format: (v) => formatNumber(v, 1, "%") },
  { key: "score", label: "Dive score", format: (v) => formatNumber(v, 0) },
];

/** The coach's review, and a way to ask for one: here with an API key, or in Claude Code / Codex. */
function CoachReview({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const { settings } = useSettings();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const provider = settings?.providers.find((p) => p.id === settings.provider);

  async function ask() {
    setBusy(true);
    setFailure(null);
    try {
      await api("/api/coach/review", "POST", { diveId: data.id });
      onSaved();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card review">
      <h2>Coach review</h2>
      {data.review ? (
        <>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.review.markdown}</ReactMarkdown>
          <p className="muted">Saved {formatDate(data.review.savedAt.slice(0, 19))}</p>
        </>
      ) : (
        <p className="muted">No review yet.</p>
      )}
      {provider?.usesApi ? (
        <div className="row">
          <button className="button" disabled={busy} onClick={ask}>
            {busy ? "The coach is reviewing the dive…" : data.review ? "Ask for a new review" : "Ask the coach for a review"}
          </button>
          <span className="muted">
            {provider.name}, billed per use
          </span>
        </div>
      ) : provider ? (
        <p className="muted">
          Ask your coach in {provider.app}: <code>/mcp__divedeck__dive-review {data.seq}</code>
        </p>
      ) : null}
      {failure && <div className="error">{failure}</div>}
    </div>
  );
}

export default function DivePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useLive<Data>(`/api/dives/${id}`);
  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading the dive…</p>;
  const { dive, metrics } = data;
  const missing = metrics.rmvLMin === null && data.tanks.some((t) => t.startBar && t.endBar !== null && !t.volumeL);

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>
            Dive #{data.seq} · {formatDate(dive.start)}
          </h1>
          <div className="secondary">
            {[dive.site, dive.location].filter(Boolean).join(", ") || "Site not filled in"}
            {data.details.buddy ? ` · with ${data.details.buddy}` : ""} · {metrics.gases.join(", ") || "gas unknown"}
            {dive.computer ? ` · ${dive.computer}` : ""}
          </div>
        </div>
        <div className="row">
          {data.prevId && (
            <Link className="button" href={`/dives/${data.prevId}`}>
              ← Previous
            </Link>
          )}
          {data.nextId && (
            <Link className="button" href={`/dives/${data.nextId}`}>
              Next →
            </Link>
          )}
        </div>
      </div>

      {missing && (
        <div className="notice">
          The tank volume is missing, so gas consumption (RMV) can&apos;t be computed. Fill it in under <a href="#details">Details</a>.
        </div>
      )}

      <div className="tiles">
        {TILES.map((t) => {
          const value = metrics[t.key];
          const avg = data.averages[t.key];
          return (
            <div className="card tile" key={t.key}>
              <div className="label">{t.label}</div>
              <div className="value">{typeof value === "number" ? t.format(value) : "–"}</div>
              {avg !== undefined && <div className="note">your average {t.format(avg)}</div>}
            </div>
          );
        })}
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Findings</h2>
          <Findings findings={data.findings} />
        </div>
        <CoachReview data={data} onSaved={reload} />
      </div>

      <div className="card">
        <h2>Profile</h2>
        <ProfileCharts view={data} />
      </div>

      <div className="card" id="details">
        <h2>Details</h2>
        <p className="muted">What the dive computer doesn&apos;t record. Your coach can fill these in too.</p>
        <DetailsForm key={JSON.stringify(data.details)} id={data.id} details={data.details} onSaved={reload} />
        {data.tanks.length > 0 && (
          <p className="muted">
            Tanks:{" "}
            {data.tanks
              .map((t) => `${t.volumeL ? `${formatNumber(t.volumeL, 1)} L` : "volume unknown"}, ${t.startBar !== null ? `${formatNumber(t.startBar, 0)} → ${formatNumber(t.endBar, 0)} bar` : "no pressure"}${t.gas ? `, ${t.gas}` : ""}`)
              .join("; ")}
          </p>
        )}
        <p className="muted">
          Imported from {data.source.fileName} on {formatDate(data.importedAt.slice(0, 19), false)} · id <code>{data.id}</code>
        </p>
      </div>
    </div>
  );
}
