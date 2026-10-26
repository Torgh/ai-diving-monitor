import { useState } from "react";
import { headline, MetricCards, ScoreRing } from "@/components/DiveSummary";
import { DiveList } from "@/components/DiveList";
import { FindingBadge, Findings } from "@/components/Findings";
import { FoldedMarkdown } from "@/components/FoldedMarkdown";
import { ProfileCharts } from "@/components/ProfileCharts";
import { SummaryTiles } from "@/components/SummaryTiles";
import { TripCard } from "@/components/TripCard";
import { useUnits } from "@/components/Units";
import type { DiveDeckExport } from "@/lib/exportFile";
import { formatDate } from "@/lib/format";
import type { DiveRecord } from "@/lib/record";
import type { TripRow } from "@/lib/tripViews";
import { diveView, type LogView } from "@/lib/views";

/** "2026-10-26T21:31:00" in the phone's time zone, for formatDate (the export's time is UTC). */
export function localTime(iso: string): string | null {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  return new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

/** Where the file comes from, said the same way on every screen that asks for it. */
const HOW = (
  <>
    On the PC, open DiveDeck&apos;s <strong>Settings → Export for phone</strong>, then put the file where the phone can open it: Google Drive,
    OneDrive, Downloads or an email.
  </>
);

export function Welcome({ onImport }: { onImport: () => void }) {
  return (
    <div className="stack welcome" style={{ gap: "1.25rem" }}>
      <img src="./icon.svg" alt="" width={72} height={72} />
      <h1>Your dives, offline</h1>
      <p className="secondary">Your log, debriefs and trip preparation from DiveDeck on the PC, on the boat too. {HOW}</p>
      <button type="button" className="button primary" onClick={onImport}>
        Import your DiveDeck file
      </button>
    </div>
  );
}

export function Home({ log, next }: { log: LogView; next: TripRow | null }) {
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>
      {next && <TripCard trip={next} link={false} />}
      {log.dives.length ? <SummaryTiles log={log} /> : <div className="notice">No dives in this file yet.</div>}
    </div>
  );
}

export function LogScreen({ log }: { log: LogView }) {
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Dive log</h1>
      </div>
      {log.dives.length ? <DiveList log={log} /> : <div className="notice">No dives in this file yet.</div>}
    </div>
  );
}

/** One dive, as on the PC, without the forms: the phone only shows the log. */
export function DiveScreen({ records, id }: { records: DiveRecord[]; id: string }) {
  const { show } = useUnits();
  const [tab, setTab] = useState<"debrief" | "findings">("debrief");
  const data = diveView(records, id);
  if (!data) return <div className="notice">This dive isn&apos;t in the file. <a href="#/dives">Back to the dive log</a>.</div>;
  const { dive, metrics, details } = data;
  const site = [dive.site, dive.location].filter(Boolean).join(", ");
  const facts: [string, string | undefined][] = [
    ["Site", site || undefined],
    ["Buddy", details.buddy],
    ["Tank", data.tanks[0]?.volumeL ? show("volume", data.tanks[0].volumeL) : undefined],
    ["Lead", details.ballastKg !== undefined ? `${details.ballastKg} kg` : undefined],
    ["Weighting", details.weighting && { light: "too light", ok: "right", heavy: "too heavy" }[details.weighting]],
    ["Notes", details.notes],
  ];
  const known = facts.filter((f): f is [string, string] => !!f[1]);

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="dive-head">
        <div>
          <a className="back" href="#/dives">
            ‹ Dive log
          </a>
          <h1>Dive #{data.seq}</h1>
          <div className="secondary">{[formatDate(dive.start), metrics.gases.join(", ") || "gas unknown", site || null].filter(Boolean).join(" · ")}</div>
        </div>
        <nav className="row" aria-label="Other dives">
          {data.prevId && (
            <a className="button" href={`#/dives/${data.prevId}`} aria-label={`Previous dive, #${data.seq - 1}`}>
              ‹ #{data.seq - 1}
            </a>
          )}
          {data.nextId && (
            <a className="button" href={`#/dives/${data.nextId}`} aria-label={`Next dive, #${data.seq + 1}`}>
              #{data.seq + 1} ›
            </a>
          )}
        </nav>
      </div>

      <section className="card verdict" aria-label="Score">
        <ScoreRing score={metrics.score} />
        <div style={{ flex: "1 1 320px" }}>
          <p className="headline">{headline(data.findings)}</p>
          <div className="row" style={{ gap: "0.5rem" }}>
            {data.findings.map((f, i) => (
              <FindingBadge key={`${f.title}${i}`} finding={f} />
            ))}
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="profile-h">
        <h2 id="profile-h">Profile</h2>
        <ProfileCharts view={data} />
      </section>

      <MetricCards data={data} />

      <section className="card" aria-label="Debrief and findings">
        <div className="tabs" role="tablist">
          {(
            [
              { id: "debrief", label: "Debrief" },
              { id: "findings", label: `Findings (${data.findings.length})` },
            ] as const
          ).map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === "findings" ? (
            <Findings findings={data.findings} />
          ) : data.review ? (
            <div className="review">
              <FoldedMarkdown key={data.review.savedAt} markdown={data.review.markdown} />
              <p className="muted">Saved {formatDate(data.review.savedAt.slice(0, 19))}</p>
            </div>
          ) : (
            <p className="muted">No debrief yet. Ask your companion on the PC, then export again.</p>
          )}
        </div>
      </section>

      {known.length > 0 && (
        <section className="card metric-card" aria-labelledby="details-h">
          <h3 id="details-h">Details</h3>
          {known.map(([label, value]) => (
            <div key={label} className="kv">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Group({ title, trips }: { title: string; trips: TripRow[] }) {
  if (!trips.length) return null;
  return (
    <section className="stack" style={{ gap: "0.75rem" }} aria-label={title}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <div className="trip-cards">
        {trips.map((t) => (
          <TripCard key={t.id} trip={t} link={false} />
        ))}
      </div>
    </section>
  );
}

export function TripsScreen({ trips }: { trips: TripRow[] }) {
  const of = (...when: TripRow["when"][]) => trips.filter((t) => when.includes(t.when));
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Trips</h1>
      </div>
      {!trips.length ? (
        <div className="notice">No trips in this file. Ask your companion on the PC to prepare a TripDeck trip, then export again.</div>
      ) : (
        <>
          <Group title="Coming up" trips={of("now", "upcoming")} />
          <Group title="No dates yet" trips={of("undated")} />
          <Group title="Past" trips={of("past")} />
        </>
      )}
    </div>
  );
}

/** What was imported, and getting a newer export. */
export function FileScreen({ log, onImport, onForget }: { log: DiveDeckExport; onImport: () => void; onForget: () => void }) {
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Your file</h1>
      </div>
      <div className="card stack">
        <p style={{ margin: 0 }}>
          Exported on <strong>{formatDate(localTime(log.exportedAt))}</strong>: {log.dives.length} dive{log.dives.length === 1 ? "" : "s"},{" "}
          {log.trips.length} trip{log.trips.length === 1 ? "" : "s"}, units {log.units}.
        </p>
        <p className="secondary" style={{ margin: 0 }}>
          The phone shows the log as it was then. To bring new dives, debriefs or trip preparation over, export again. {HOW}
        </p>
        <div className="row">
          <button type="button" className="button primary" onClick={onImport}>
            Import a newer file
          </button>
          <button type="button" className="button" onClick={onForget}>
            Remove from this phone
          </button>
        </div>
      </div>
    </div>
  );
}
