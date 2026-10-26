"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DetailsForm } from "@/components/DetailsForm";
import { headline, MetricCards, ScoreRing } from "@/components/DiveSummary";
import { FindingBadge, Findings } from "@/components/Findings";
import { FoldedMarkdown } from "@/components/FoldedMarkdown";
import { ProfileCharts } from "@/components/ProfileCharts";
import { api, useLive } from "@/components/useLive";
import { useUnits } from "@/components/Units";
import { useSettings } from "@/components/useSettings";
import { formatDate } from "@/lib/format";
import type { Kit, Water } from "@/lib/kit";
import type { WeightingEstimate } from "@/lib/weighting";
import type { DiveView } from "@/lib/views";
import { Command } from "@/components/Command";

type Data = DiveView & { version: string };

/** The companion's debrief, and a way to ask for one: here with an API key, or in Claude Code / Codex. */
function Debrief({ data, onSaved }: { data: Data; onSaved: () => void }) {
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
    <div className="review">
      {data.review ? (
        <>
          <FoldedMarkdown key={data.review.savedAt} markdown={data.review.markdown} />
          <p className="muted">Saved {formatDate(data.review.savedAt.slice(0, 19))}</p>
        </>
      ) : (
        <p className="muted">No debrief yet.</p>
      )}
      {provider?.usesApi ? (
        <div className="row">
          <button className="button" disabled={busy} onClick={ask}>
            {busy ? "Your companion is debriefing the dive…" : data.review ? "Get a new debrief" : "Get a debrief"}
          </button>
          <span className="muted">{provider.name}, billed per use</span>
        </div>
      ) : provider ? (
        <p className="muted">
          Ask your companion in {provider.app}: <Command text={`/mcp__divedeck__dive-review ${data.seq}`} />
        </p>
      ) : null}
      {failure && <div className="error">{failure}</div>}
    </div>
  );
}

/** Debrief and findings in one panel, as two tabs. */
function DebriefAndFindings({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const [tab, setTab] = useState<"debrief" | "findings">("debrief");
  const tabs = [
    { id: "debrief", label: "Debrief" },
    { id: "findings", label: `Findings (${data.findings.length})` },
  ] as const;
  return (
    <section className="card" aria-label="Debrief and findings">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "debrief" ? <Debrief data={data} onSaved={onSaved} /> : <Findings findings={data.findings} />}
      </div>
    </section>
  );
}

export default function DivePage() {
  const { id } = useParams<{ id: string }>();
  const { show } = useUnits();
  const { data, error, loading, reload } = useLive<Data>(`/api/dives/${id}`);
  const kit = useLive<Kit & { version: string; estimates: Record<string, Record<Water, WeightingEstimate>> }>("/api/kit").data;
  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading the dive…</p>;
  const { dive, metrics } = data;
  const site = [dive.site, dive.location].filter(Boolean).join(", ");
  const shown = data.findings;

  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="dive-head">
        <div>
          <Link className="back" href="/dives">
            ‹ Dive log
          </Link>
          <h1>Dive #{data.seq}</h1>
          <div className="secondary">
            {[formatDate(dive.start), metrics.gases.join(", ") || "gas unknown", dive.computer, data.details.buddy ? `with ${data.details.buddy}` : null]
              .filter(Boolean)
              .join(" · ")}
            {" · "}
            {site || <a href="#details">add site</a>}
          </div>
        </div>
        <nav className="row" aria-label="Other dives">
          {data.prevId ? (
            <Link className="button" href={`/dives/${data.prevId}`} aria-label={`Previous dive, #${data.seq - 1}`}>
              ‹ #{data.seq - 1}
            </Link>
          ) : (
            <span className="button" aria-disabled="true">
              ‹
            </span>
          )}
          {data.nextId ? (
            <Link className="button" href={`/dives/${data.nextId}`} aria-label={`Next dive, #${data.seq + 1}`}>
              #{data.seq + 1} ›
            </Link>
          ) : (
            <span className="button" aria-disabled="true">
              ›
            </span>
          )}
        </nav>
      </div>

      <section className="card verdict" aria-label="Score">
        <ScoreRing score={metrics.score} />
        <div style={{ flex: "1 1 320px" }}>
          <p className="headline">{headline(shown)}</p>
          <div className="row" style={{ gap: "0.5rem" }}>
            {shown.map((f, i) => (
              <FindingBadge key={`${f.title}${i}`} finding={f} />
            ))}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="profile-h">
        <h2 id="profile-h">Profile</h2>
        <ProfileCharts view={data} />
      </section>

      <MetricCards data={data} detailsHref="#details" />

      <DebriefAndFindings data={data} onSaved={reload} />

      <section className="card" id="details" aria-labelledby="details-h">
        <h2 id="details-h">Details</h2>
        <p className="muted">What the dive computer doesn&apos;t record. Your companion can fill these in too.</p>
        <DetailsForm key={JSON.stringify(data.details) + (kit ? "k" : "")} id={data.id} details={data.details} site={data.dive.site} kit={kit} onSaved={reload} />
        {data.tanks.length > 0 && (
          <p className="muted">
            Tanks:{" "}
            {data.tanks
              .map((t) => `${t.volumeL ? show("volume", t.volumeL) : "volume unknown"}, ${t.startBar !== null ? `${show("pressure", t.startBar)} → ${show("pressure", t.endBar)}` : "no pressure"}${t.gas ? `, ${t.gas}` : ""}`)
              .join("; ")}
          </p>
        )}
        <p className="muted">
          Imported from {data.source.fileName} on {formatDate(data.importedAt.slice(0, 19), false)} · id <code>{data.id}</code>
        </p>
      </section>
    </div>
  );
}
