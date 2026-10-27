import { useMemo, useState } from "react";
import { headline, MetricCards, ScoreRing } from "@/components/DiveSummary";
import { DiveList } from "@/components/DiveList";
import { FindingBadge, Findings } from "@/components/Findings";
import { FoldedMarkdown } from "@/components/FoldedMarkdown";
import { BalanceCard } from "@/components/gear/BalanceCard";
import { GearCard } from "@/components/gear/GearCard";
import { ResultCard } from "@/components/gear/ResultCard";
import { GROUPS, type TankChoice } from "@/components/gear/shared";
import { YouStrip } from "@/components/gear/YouStrip";
import { ProfileCharts } from "@/components/ProfileCharts";
import { SummaryTiles } from "@/components/SummaryTiles";
import { BeforeYouGo, DiveDays, RecurringIssues, tripLine } from "@/components/TripPrep";
import { TripSites } from "@/components/TripSites";
import { TripTodos } from "@/components/TripTodos";
import { TripCard } from "@/components/TripCard";
import { useUnits } from "@/components/Units";
import type { DiveDeckExport } from "@/lib/exportFile";
import { formatDate } from "@/lib/format";
import type { Kit, Water } from "@/lib/kit";
import type { DiveRecord } from "@/lib/record";
import type { TripPlan } from "@/lib/trip";
import { type TripRow, tripView } from "@/lib/tripViews";
import { diveView, type LogView } from "@/lib/views";
import { estimateWeighting } from "@/lib/weighting";

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

/** Dives imported on the phone that the PC doesn't have yet, with the way to send them. */
function OnPhoneNotice({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className="notice">
      {count} dive{count === 1 ? " is" : "s are"} only on this phone. <a href="#/file">Send to the PC</a> to keep {count === 1 ? "it" : "them"} and get your
      companion&apos;s debrief.
    </div>
  );
}

export function Home({ log, next, onPhone }: { log: LogView; next: TripRow | null; onPhone: number }) {
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>
      <OnPhoneNotice count={onPhone} />
      {next && <TripCard trip={next} />}
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
export function DiveScreen({ records, id, onPhone }: { records: DiveRecord[]; id: string; onPhone: boolean }) {
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

      {onPhone && (
        <div className="notice">
          Imported on this phone. <a href="#/file">Send it to the PC</a> to keep it, fill in its details and get your companion&apos;s debrief.
        </div>
      )}

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
            <p className="muted">No debrief yet. {onPhone ? "Send the dive to the PC, ask your companion there" : "Ask your companion on the PC"}, then export again.</p>
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
          <TripCard key={t.id} trip={t} />
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

/** One trip's preparation, as on the PC; the to-dos, sites and logged dives are changed there. */
export function TripScreen({ plans, records, id, now }: { plans: TripPlan[]; records: DiveRecord[]; id: string; now: Date }) {
  const data = tripView(plans, records, id, now);
  if (!data) return <div className="notice">This trip isn&apos;t in the file. <a href="#/trips">Back to the trips</a>.</div>;
  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="dive-head">
        <div>
          <a className="back" href="#/trips">
            ‹ Trips
          </a>
          <h1>{data.name}</h1>
          <div className="secondary">{tripLine(data)}</div>
        </div>
      </div>

      <TripTodos todos={data.todos} cards={data.dives.map((d) => ({ itemId: d.itemId, title: d.date ? `${d.title} (${formatDate(d.date, false)})` : d.title }))} />

      <BeforeYouGo data={data} />

      <RecurringIssues data={data} />

      <section className="card review" aria-labelledby="notes-h">
        <h2 id="notes-h">Trip notes</h2>
        {data.summary ? <FoldedMarkdown markdown={data.summary.markdown} /> : <p className="muted">No notes for the whole trip yet. Ask your companion on the PC, then export again.</p>}
      </section>

      <TripSites trip={data.name} shop={data.shop} sites={data.sites} notes={data.siteNotes} />

      <DiveDays data={data} />
    </div>
  );
}

/** Your sets and the lead each needs, worked out on the phone as on the PC; the gear is changed there. */
export function GearScreen({ kit, records }: { kit: Kit; records: DiveRecord[] }) {
  const [setId, setSetId] = useState<string | null>(null);
  const [waterChoice, setWaterChoice] = useState<Water | null>(null);
  const [tank, setTank] = useState<TankChoice>("own");
  const set = kit.sets.find((s) => s.id === setId) ?? kit.sets[0] ?? null;
  const water = waterChoice ?? set?.water ?? "salt";
  const estimate = useMemo(() => (set ? estimateWeighting(kit, records, set, water, undefined, tank === "own" ? null : tank) : undefined), [kit, records, set, water, tank]);
  const ownTank = set ? kit.items.find((i) => i.kind === "tank" && set.itemIds.includes(i.id)) : undefined;
  const hasTank = tank !== "own" || !!ownTank;
  const inSet = set ? kit.items.filter((i) => set.itemIds.includes(i.id)) : kit.items;
  const parts = estimate?.parts ?? [];

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      <div className="page-head">
        <h1>Gear</h1>
      </div>

      <YouStrip kit={kit} you={parts.find((p) => p.label === "You")} water={water} />

      {kit.sets.length > 1 && (
        <div className="tabs set-tabs" role="tablist" aria-label="Sets">
          {kit.sets.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === set?.id}
              onClick={() => {
                setSetId(s.id);
                setWaterChoice(null);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {set ? (
        <span className="secondary">
          <strong>{set.name}</strong>
          {[set.ballastKg !== undefined ? `usually ${set.ballastKg} kg of lead` : null, set.water ? `meant for ${set.water} water` : null, set.notes]
            .filter(Boolean)
            .map((t) => ` · ${t}`)
            .join("")}
        </span>
      ) : (
        <div className="notice">No gear sets in this file. Put your gear together in a set on the PC, then export again.</div>
      )}

      {set && estimate && (
        <div className="balance-grid">
          <ResultCard estimate={estimate} hasTank={hasTank} />
          <BalanceCard estimate={estimate} hasTank={hasTank} water={water} setWater={setWaterChoice} tank={tank} setTank={setTank} ownTank={ownTank} />
        </div>
      )}

      <section className="stack" style={{ gap: "0.75rem" }} aria-labelledby="items-h">
        <h2 id="items-h" style={{ margin: 0 }}>
          {set ? "In this set" : "Your gear"}
        </h2>
        {!kit.items.length && <p className="muted">No gear in this file yet.</p>}
        {GROUPS.map((g) => {
          const items = inSet.filter((i) => g.kinds.includes(i.kind));
          return items.length ? (
            <div key={g.title} className="stack" style={{ gap: "0.5rem" }}>
              <h3 className="group-title">{g.title}</h3>
              <div className="gear-grid">
                {items.map((item) => (
                  <GearCard key={item.id} item={item} part={parts.find((p) => p.itemId === item.id)} />
                ))}
              </div>
            </div>
          ) : null;
        })}
      </section>

      <p className="muted" style={{ margin: 0 }}>
        An estimate: the weight check in the water decides. Change your gear, sets and the water at your sites on the PC, then export again.
      </p>
    </div>
  );
}

/** What was imported, getting a newer export, and the dives imported here on their way to the PC. */
export function FileScreen({
  log,
  onPhone,
  onImport,
  onSend,
  onForget,
}: {
  log: DiveDeckExport;
  onPhone: number;
  onImport: () => void;
  onSend: () => void;
  onForget: () => void;
}) {
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
      <section className="card stack" aria-labelledby="uddf-h">
        <h2 id="uddf-h" style={{ margin: 0 }}>
          Dives from your dive computer
        </h2>
        <p className="secondary" style={{ margin: 0 }}>
          Away from the PC, import a .uddf file from your dive computer&apos;s app (Shearwater Cloud, Garmin Dive, Suunto, Subsurface…): its dives show in your log
          here at once. Then send them to the PC, import that file on its Import page, and they are in your log for good.
        </p>
        {onPhone > 0 && (
          <p style={{ margin: 0 }}>
            <strong>
              {onPhone} dive{onPhone === 1 ? "" : "s"}
            </strong>{" "}
            only on this phone. They stay here until an export from the PC holds them.
          </p>
        )}
        <div className="row">
          <button type="button" className={`button ${onPhone ? "" : "primary"}`} onClick={onImport}>
            Import a UDDF file
          </button>
          {onPhone > 0 && (
            <button type="button" className="button primary" onClick={onSend}>
              Send to PC
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
