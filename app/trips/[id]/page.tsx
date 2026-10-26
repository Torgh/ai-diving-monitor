"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Findings } from "@/components/Findings";
import { Icon } from "@/components/Icons";
import { TripPrepHint } from "@/components/TripPrepHint";
import { siteFacts, TripSites } from "@/components/TripSites";
import { useUnits } from "@/components/Units";
import { api, useLive } from "@/components/useLive";
import { formatDate, formatDateRange, formatNumber, formatTripWhen } from "@/lib/format";
import { REFRESHER_DAYS } from "@/lib/prep";
import type { TripSite } from "@/lib/trip";
import type { LoggedDiveLink, TripCardView, TripView } from "@/lib/tripViews";

type Data = TripView & { version: string };

function DiveLink({ dive }: { dive: LoggedDiveLink }) {
  const { show } = useUnits();
  if (dive.seq === null) return <span className="muted">A dive no longer in the log</span>;
  return (
    <>
      <Link href={`/dives/${dive.id}`}>
        #{dive.seq} · {formatDate(dive.start)}
      </Link>{" "}
      <span className="secondary">
        {[dive.site, show("depth", dive.maxDepthM), formatNumber(dive.durationMin, 0, "min"), `score ${dive.score}`].filter(Boolean).join(" · ")}
      </span>
    </>
  );
}

/** The numbers the preparation stands on, from the dives logged before the card's day. */
function Facts({ card }: { card: TripCardView }) {
  const { show } = useUnits();
  const { experience: e, gasPlan: g } = card.facts;
  const depth = card.maxDepthM;
  return (
    <div className="tiles">
      <div className="tile">
        <div className="label">{depth ? `Dives to ${show("depth", Math.max(0, depth - 3), 0)} or deeper` : "Dives before this one"}</div>
        <div className="value">{depth ? e.divesNearPlannedDepth : e.dives}</div>
        <div className="note">deepest {show("depth", e.deepestM)}</div>
      </div>
      <div className="tile">
        <div className="label">Since the last dive</div>
        <div className="value">{e.daysSinceLastDive === null ? "–" : `${e.daysSinceLastDive} days`}</div>
        <div className="note">{e.divesInLast12Months} dives in the 12 months before</div>
      </div>
      <div className="tile">
        <div className="label">Gas at {depth ? show("depth", depth, 0) : "depth"}</div>
        <div className="value">{show("flow", g.consumptionAtMaxDepthLMin, 0)}</div>
        <div className="note">your RMV {show("flow", g.rmvLMin)}</div>
      </div>
      <div className="tile">
        <div className="label">ppO2 at max depth</div>
        <div className="value">{formatNumber(g.ppo2AtMaxDepth, 2, "bar")}</div>
        <div className="note">
          {g.modM !== null
            ? `MOD ${show("depth", g.modM)}`
            : card.facts.gas?.family === "nitrox" && g.bestNitroxPercent !== null
              ? `richest nitrox EAN${g.bestNitroxPercent}`
              : "mix not known yet"}
        </div>
      </div>
    </div>
  );
}


/** TripDeck's web app, for the "Open in TripDeck" link. */
const TRIPDECK_URL = process.env.NEXT_PUBLIC_TRIPDECK_URL ?? "http://localhost:3000";

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const dayPart = (date: string, part: "month" | "weekday") => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { [part]: "short", timeZone: "UTC" });

/** The card's verdict as on TripDeck (ready / check), else whether it is prepared at all. */
function CardStatus({ card }: { card: TripCardView }) {
  if (card.verdict?.status === "check" || !card.prep)
    return (
      <span className="badge warning">
        {Icon.alert}
        {card.verdict?.status === "check" ? "Check" : "Not prepared"}
      </span>
    );
  return (
    <span className="badge good">
      {Icon.check}
      {card.verdict?.status === "ready" ? "Ready" : "Prepared"}
    </span>
  );
}

const flightTime = (f: { date: string; time?: string }) => `${formatDate(f.date, false)}${f.time ? `, ${f.time}` : ""}`;

/** The proposed site a card is about: its depths and distance, and why it suits you, linked to the site below. */
function CardSite({ site }: { site: TripSite }) {
  const { show } = useUnits();
  const line = siteFacts(site, (m) => show("depth", m));
  return (
    <div className="card-site">
      <a href={`#site-${site.id}`}>
        <strong>{site.name}</strong>
      </a>
      {line && <span className="muted"> · {line}</span>}
      <p style={{ margin: "0.2rem 0 0" }}>{site.why}</p>
    </div>
  );
}

function DayCard({ card, tripId, open, onChange }: { card: TripCardView; tripId: string; open: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function link(diveId: string, linked: boolean) {
    setBusy(true);
    setFailure(null);
    try {
      await api(`/api/trips/${tripId}/dives`, "POST", { itemId: card.itemId, diveId, linked });
      onChange();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const plan = [
    card.site && card.site !== card.title ? card.site : null,
    card.maxDepthM ? `to ${card.maxDepthM} m` : null,
    card.gas,
    card.dives && card.dives > 1 ? `${card.dives} dives` : null,
    card.center,
    card.startTime,
  ].filter(Boolean);
  // The missing RMV is on the trip's "Gas plan" tile once, not on every card.
  const notes = card.facts.gasPlan.rmvLMin === null ? card.notes.filter((n) => !n.startsWith("No gas consumption in the log")) : card.notes;
  // The verdict's line says it best; without one, the first note.
  const [first, ...more] = card.verdict?.summary ? [card.verdict.summary, ...notes] : notes;
  const { comparable } = card.facts;

  return (
    <article className="card day-card" id={`card-${card.itemId}`} aria-labelledby={`title-${card.itemId}`}>
      <div className="date-col" aria-hidden="true">
        {card.date ? (
          <>
            <span className="num">{Number(card.date.slice(8, 10))}</span>
            <span>
              {dayPart(card.date, "month")} · {dayPart(card.date, "weekday")}
            </span>
          </>
        ) : (
          <span>{card.day ? `Day ${card.day}` : "–"}</span>
        )}
      </div>
      <div className="stack" style={{ gap: "0.4rem", flex: "1 1 auto", minWidth: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
          <h3 id={`title-${card.itemId}`} style={{ margin: 0, fontSize: "1.05rem" }}>
            {card.date && <span className="visually-hidden">{formatDate(card.date, false)}: </span>}
            {card.title}
          </h3>
          <CardStatus card={card} />
        </div>
        <span className="secondary" style={{ fontSize: "0.9rem" }}>
          {plan.join(" · ") || "No depth or gas on the card yet"}
        </span>
        {card.siteInfo && <CardSite site={card.siteInfo} />}
        {first && <p style={{ margin: 0 }}>{first}</p>}

        <details open={open}>
          <summary>Full preparation</summary>
          <div className="stack" style={{ marginTop: "0.6rem" }}>
            {card.prep ? (
              <div className="review">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.prep.markdown}</ReactMarkdown>
                <p className="muted">Saved {formatDate(card.prep.savedAt.slice(0, 19))}</p>
              </div>
            ) : (
              <p className="muted">Your companion hasn&apos;t prepared this dive yet.</p>
            )}
            <Facts card={card} />
            {more.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                {more.map((n) => (
                  <li key={n} className="secondary">
                    {n}
                  </li>
                ))}
              </ul>
            )}
            {comparable.length > 0 && (
              <div>
                <h4 style={{ margin: "0 0 0.3rem" }}>Your closest dives</h4>
                <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  {comparable.slice(0, 3).map((d) => (
                    <li key={d.id}>
                      <DiveLink dive={{ ...d, start: d.date }} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>

        {(card.logged.length > 0 || card.loggedThatDay.length > 0) && (
          <div>
            <h4 style={{ margin: "0.3rem 0" }}>Logged</h4>
            <ul className="logged">
              {card.logged.map((d) => (
                <li key={d.id}>
                  <span>
                    <span className="severity good" role="img" aria-label="Linked">
                      {Icon.check}
                    </span>{" "}
                    <DiveLink dive={d} />
                  </span>
                  <button className="button" disabled={busy} onClick={() => link(d.id, false)}>
                    Unlink
                  </button>
                </li>
              ))}
              {card.loggedThatDay.map((d) => (
                <li key={d.id}>
                  <span>
                    <DiveLink dive={d} />
                  </span>
                  <button className="button" disabled={busy} onClick={() => link(d.id, true)}>
                    This was the dive
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {failure && <div className="error">{failure}</div>}
      </div>
    </article>
  );
}

/** A few checks for the whole trip, from the preparation of its first dive. */
function BeforeYouGo({ data }: { data: Data }) {
  const { show } = useUnits();
  const first = data.dives.find((d) => d.date) ?? data.dives[0];
  if (!first) return null;
  const { gasPlan: g } = first.facts;
  const issue = data.recurringIssues[0];
  const { breakBefore: b, flight: f } = data;
  return (
    <section className="tiles" aria-label="Before you go">
      <div className={`card tile ${b && b.days > REFRESHER_DAYS ? "warn" : ""}`}>
        <div className="label">Break before</div>
        <div className="value">{b ? `${b.days} day${b.days === 1 ? "" : "s"}` : "–"}</div>
        <div className="note">
          {!b ? (
            "no dives logged before"
          ) : b.after.kind === "trip" ? (
            <>
              after <Link href={`/trips/${b.after.id}`}>{b.after.name}</Link> ({formatDate(b.after.date, false)})
            </>
          ) : (
            `after your last logged dive, #${b.after.seq}`
          )}
          {b && b.days > REFRESHER_DAYS ? " · worth a check-out dive first" : ""}
        </div>
      </div>
      <div className={`card tile ${issue ? "warn" : ""}`}>
        <div className="label">Keeps coming back</div>
        <div className="value" style={{ fontSize: "1.1rem" }}>
          {issue ? issue.title : "Nothing"}
        </div>
        <div className="note">{issue ? `on ${issue.dives} of your last ${issue.of} dives` : "no problem repeats in your last dives"}</div>
      </div>
      <div className={`card tile ${g.rmvLMin === null ? "warn" : ""}`}>
        <div className="label">Gas plan</div>
        <div className="value">{g.rmvLMin === null ? "No RMV yet" : show("flow", g.rmvLMin)}</div>
        <div className="note">{g.rmvLMin === null ? <Link href="/">add your tank sizes</Link> : `your RMV, from ${g.rmvDives} dive${g.rmvDives === 1 ? "" : "s"}`}</div>
      </div>
      <div className={`card tile ${f && f.hours < f.neededHours ? "warn" : ""}`}>
        <div className="label">Flying after diving</div>
        {f ? (
          <>
            <div className="value">
              {formatNumber(f.hours, 0, "h")}{" "}
              <span className={`severity ${f.hours < f.neededHours ? "warning" : "good"}`} role="img" aria-label={f.hours < f.neededHours ? "Too short" : "Enough"}>
                {f.hours < f.neededHours ? Icon.alert : Icon.check}
              </span>
            </div>
            <div className="note">
              {[f.flight.from && f.flight.to ? `${f.flight.from}→${f.flight.to}` : "flight", flightTime(f.flight)].join(" ")} · DAN: at least {f.neededHours} h
              {f.timeAssumed ? " · a time was missing, so counted cautiously" : ""}
            </div>
          </>
        ) : (
          <>
            <div className="value">–</div>
            <div className="note">no flight after the dives saved; trip-prep brings the flights from TripDeck</div>
          </>
        )}
      </div>
      <div className={`card tile ${data.prepared < data.cards || data.toCheck ? "warn" : ""}`}>
        <div className="label">Prepared</div>
        <div className="value">
          {data.prepared} of {data.cards}
        </div>
        <div className="note">{data.toCheck ? `${data.toCheck} to check` : "dive cards"}</div>
      </div>
    </section>
  );
}

/** The dive cards by date, with the days without diving between them; unscheduled ones last. */
function DiveDays({ data, onChange }: { data: Data; onChange: () => void }) {
  const dated = data.dives.filter((d) => d.date).sort((a, b) => a.date!.localeCompare(b.date!) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  const undated = data.dives.filter((d) => !d.date);
  // Open the first card to check or still to prepare, else the first one.
  const openFirst = (data.dives.find((d) => d.verdict?.status === "check" || !d.prep) ?? dated[0] ?? undated[0])?.itemId;
  return (
    <section className="stack" style={{ gap: "0.75rem" }} aria-labelledby="days-h">
      <h2 id="days-h" style={{ margin: 0 }}>
        Dive days
      </h2>
      {dated.map((card, i) => {
        const gap = i > 0 ? daysBetween(dated[i - 1].date!, card.date!) - 1 : 0;
        return (
          <div key={card.itemId} className="stack" style={{ gap: "0.75rem" }}>
            {gap > 0 && (
              <div className="gap-divider">
                {gap} day{gap === 1 ? "" : "s"} without diving
              </div>
            )}
            <DayCard card={card} tripId={data.id} open={card.itemId === openFirst} onChange={onChange} />
          </div>
        );
      })}
      {undated.length > 0 && (
        <>
          {dated.length > 0 && <div className="gap-divider">Not scheduled yet</div>}
          {undated.map((card) => (
            <DayCard key={card.itemId} card={card} tripId={data.id} open={card.itemId === openFirst} onChange={onChange} />
          ))}
        </>
      )}
    </section>
  );
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useLive<Data>(`/api/trips/${id}`);
  const [failure, setFailure] = useState<string | null>(null);
  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <p className="muted">Loading the trip…</p>;

  async function forget() {
    if (!window.confirm(`Forget "${data!.name}" here, with its preparation? The trip stays in TripDeck.`)) return;
    try {
      await api(`/api/trips/${id}`, "DELETE");
      router.push("/trips");
    } catch (err) {
      setFailure((err as Error).message);
    }
  }

  const dives = data.dives.reduce((n, d) => n + (d.dives ?? 1), 0);
  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="dive-head">
        <div>
          <Link className="back" href="/trips">
            ‹ Trips
          </Link>
          <h1>{data.name}</h1>
          <div className="secondary">
            {[
              data.destination?.toLowerCase() === data.name.toLowerCase() ? null : data.destination,
              formatDateRange(data.startDate, data.endDate),
              formatTripWhen(data).toLowerCase(),
              data.cards ? `${data.diveDays} dive day${data.diveDays === 1 ? "" : "s"}, ${dives} dive${dives === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="row">
          <a className="button" href={`${TRIPDECK_URL}/trip?id=${encodeURIComponent(data.id)}`}>
            {Icon.external}
            <span style={{ marginLeft: "0.4rem" }}>Open in TripDeck</span>
          </a>
          <button className="button" onClick={forget}>
            Forget here
          </button>
        </div>
      </div>
      {failure && <div className="error">{failure}</div>}

      <BeforeYouGo data={data} />

      {data.recurringIssues.length > 0 && (
        <section className="card" aria-labelledby="recurring-h">
          <h2 id="recurring-h">Keeps coming back in your dives</h2>
          <Findings
            findings={data.recurringIssues.map((r) => ({ severity: r.severity, title: r.title, detail: `${r.dives} of the last ${r.of} dives before the trip` }))}
          />
        </section>
      )}

      <section className="card review" aria-labelledby="notes-h">
        <h2 id="notes-h">Trip notes</h2>
        {data.summary ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary.markdown}</ReactMarkdown> : <p className="muted">No notes for the whole trip yet.</p>}
        <TripPrepHint trip={data.name} />
      </section>

      <TripSites tripId={data.id} trip={data.name} shop={data.shop} sites={data.sites} notes={data.siteNotes} onChange={reload} />

      {data.dives.length ? (
        <DiveDays data={data} onChange={reload} />
      ) : (
        <div className="notice">The trip has no dive cards. Add dives to it in TripDeck and run the preparation again.</div>
      )}
    </div>
  );
}
