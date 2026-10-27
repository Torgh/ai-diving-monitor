"use client";

import Link from "next/link";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Findings } from "@/components/Findings";
import { Icon } from "@/components/Icons";
import { siteFacts } from "@/components/TripSites";
import { useUnits } from "@/components/Units";
import { api } from "@/components/useLive";
import { formatDate, formatDateRange, formatNumber, formatTripWhen } from "@/lib/format";
import { REFRESHER_DAYS } from "@/lib/prep";
import type { TripSite } from "@/lib/trip";
import type { LoggedDiveLink, TripCardView, TripView } from "@/lib/tripViews";

/**
 * A trip's preparation, shared by the web app and the phone app. `edit` (the web app) adds what changes
 * the trip: picking a card's site and linking the logged dives; without it the phone only shows them.
 */
export interface TripEdit {
  tripId: string;
  onChange: () => void;
}

/** Where and when, how many dive days: the line under the trip's name. */
export function tripLine(data: TripView): string {
  const dives = data.dives.reduce((n, d) => n + (d.dives ?? 1), 0);
  return [
    data.destination?.toLowerCase() === data.name.toLowerCase() ? null : data.destination,
    formatDateRange(data.startDate, data.endDate),
    formatTripWhen(data).toLowerCase(),
    data.cards ? `${data.diveDays} dive day${data.diveDays === 1 ? "" : "s"}, ${dives} dive${dives === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

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
  const { range } = useUnits();
  const line = siteFacts(site, (min, max) => range("depth", min, max));
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

function DayCard({ card, sites, open, edit }: { card: TripCardView; sites: TripSite[]; open: boolean; edit?: TripEdit }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function call(path: string, body: unknown) {
    if (!edit) return;
    setBusy(true);
    setFailure(null);
    try {
      await api(`/api/trips/${edit.tripId}/${path}`, "POST", body);
      edit.onChange();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const link = (diveId: string, linked: boolean) => call("dives", { itemId: card.itemId, diveId, linked });
  const pickSite = (siteId: string) => call("cards", { itemId: card.itemId, siteId: siteId || null });

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
  // Without edit, only the dives already linked: the ones logged that day wait for a choice on the PC.
  const thatDay = edit ? card.loggedThatDay : [];

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
          <span className="row" style={{ gap: "0.35rem" }}>
            {card.openTodos > 0 && (
              <a className="badge" href="#todos">
                {card.openTodos} to do
              </a>
            )}
            <CardStatus card={card} />
          </span>
        </div>
        <span className="secondary" style={{ fontSize: "0.9rem" }}>
          {plan.join(" · ") || "No depth or gas on the card yet"}
        </span>
        {card.siteInfo && <CardSite site={card.siteInfo} />}
        {edit && sites.length > 0 && (
          <label className="card-site-pick">
            <span className="muted">Dive site</span>
            <select value={card.siteId ?? ""} disabled={busy} onChange={(e) => pickSite(e.target.value)}>
              <option value="">{card.siteId ? "Find it by name" : `By name${card.siteInfo ? `: ${card.siteInfo.name}` : ": none found"}`}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status === "chosen" ? " (chosen)" : s.status === "dropped" ? " (not for this trip)" : ""}
                </option>
              ))}
              <option value="none">No site</option>
            </select>
          </label>
        )}
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

        {(card.logged.length > 0 || thatDay.length > 0) && (
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
                  {edit && (
                    <button className="button" disabled={busy} onClick={() => link(d.id, false)}>
                      Unlink
                    </button>
                  )}
                </li>
              ))}
              {thatDay.map((d) => (
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
export function BeforeYouGo({ data, edit }: { data: TripView; edit?: boolean }) {
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
        <div className="note">
          {g.rmvLMin !== null ? `your RMV, from ${g.rmvDives} dive${g.rmvDives === 1 ? "" : "s"}` : edit ? <Link href="/">add your tank sizes</Link> : "add your tank sizes on the PC"}
        </div>
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

/** The problems that repeat in the dives before the trip. */
export function RecurringIssues({ data }: { data: TripView }) {
  if (!data.recurringIssues.length) return null;
  return (
    <section className="card" aria-labelledby="recurring-h">
      <h2 id="recurring-h">Keeps coming back in your dives</h2>
      <Findings findings={data.recurringIssues.map((r) => ({ severity: r.severity, title: r.title, detail: `${r.dives} of the last ${r.of} dives before the trip` }))} />
    </section>
  );
}

/** The dive cards by date, with the days without diving between them; unscheduled ones last. */
export function DiveDays({ data, edit }: { data: TripView; edit?: TripEdit }) {
  if (!data.dives.length) return <div className="notice">The trip has no dive cards. Add dives to it in TripDeck and run the preparation again.</div>;
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
            <DayCard card={card} sites={data.sites} open={card.itemId === openFirst} edit={edit} />
          </div>
        );
      })}
      {undated.length > 0 && (
        <>
          {dated.length > 0 && <div className="gap-divider">Not scheduled yet</div>}
          {undated.map((card) => (
            <DayCard key={card.itemId} card={card} sites={data.sites} open={card.itemId === openFirst} edit={edit} />
          ))}
        </>
      )}
    </section>
  );
}
