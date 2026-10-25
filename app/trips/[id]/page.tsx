"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TripPrepHint } from "@/components/TripPrepHint";
import { api, useLive } from "@/components/useLive";
import { formatDate, formatDateRange, formatNumber, formatTripWhen } from "@/lib/format";
import type { LoggedDiveLink, TripCardView, TripView } from "@/lib/tripViews";

type Data = TripView & { version: string };

function DiveLink({ dive }: { dive: LoggedDiveLink }) {
  if (dive.seq === null) return <span className="muted">A dive no longer in the log</span>;
  return (
    <>
      <Link href={`/dives/${dive.id}`}>
        #{dive.seq} · {formatDate(dive.start)}
      </Link>{" "}
      <span className="secondary">
        {[dive.site, formatNumber(dive.maxDepthM, 1, "m"), formatNumber(dive.durationMin, 0, "min"), `score ${dive.score}`].filter(Boolean).join(" · ")}
      </span>
    </>
  );
}

/** The numbers the preparation stands on, from the dives logged before the card's day. */
function Facts({ card }: { card: TripCardView }) {
  const { experience: e, gasPlan: g } = card.facts;
  const depth = card.maxDepthM;
  return (
    <div className="tiles">
      <div className="tile">
        <div className="label">{depth ? `Dives to ${Math.max(0, depth - 3)} m or deeper` : "Dives before this one"}</div>
        <div className="value">{depth ? e.divesNearPlannedDepth : e.dives}</div>
        <div className="note">deepest {formatNumber(e.deepestM, 1, "m")}</div>
      </div>
      <div className="tile">
        <div className="label">Since the last dive</div>
        <div className="value">{e.daysSinceLastDive === null ? "–" : `${e.daysSinceLastDive} days`}</div>
        <div className="note">{e.divesInLast12Months} dives in the 12 months before</div>
      </div>
      <div className="tile">
        <div className="label">Gas at {depth ? `${depth} m` : "depth"}</div>
        <div className="value">{formatNumber(g.consumptionAtMaxDepthLMin, 0, "L/min")}</div>
        <div className="note">your RMV {formatNumber(g.rmvLMin, 1, "L/min")}</div>
      </div>
      <div className="tile">
        <div className="label">ppO2 at max depth</div>
        <div className="value">{formatNumber(g.ppo2AtMaxDepth, 2, "bar")}</div>
        <div className="note">
          {g.modM !== null
            ? `MOD ${formatNumber(g.modM, 1, "m")}`
            : card.facts.gas?.family === "nitrox" && g.bestNitroxPercent !== null
              ? `richest nitrox EAN${g.bestNitroxPercent}`
              : "mix not known yet"}
        </div>
      </div>
    </div>
  );
}

function Card({ card, tripId, onChange }: { card: TripCardView; tripId: string; onChange: () => void }) {
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

  const when = [card.day ? `Day ${card.day}` : null, card.date ? formatDate(card.date, false) : null, card.startTime].filter(Boolean).join(" · ");
  const plan = [
    card.maxDepthM ? `to ${card.maxDepthM} m` : null,
    card.gas,
    card.dives && card.dives > 1 ? `${card.dives} dives` : null,
    card.center ? `with ${card.center}` : null,
  ].filter(Boolean);
  const { notes } = card;
  const { comparable } = card.facts;

  return (
    <section className="card stack" id={`card-${card.itemId}`} aria-labelledby={`title-${card.itemId}`}>
      <div>
        <div className="secondary">{when || "Not scheduled yet"}</div>
        <h2 id={`title-${card.itemId}`}>{card.title}</h2>
        <div className="secondary">
          {[card.site && card.site !== card.title ? card.site : null, ...plan].filter(Boolean).join(" · ") || "No depth or gas on the card yet"}
        </div>
      </div>

      <Facts card={card} />

      {notes.length > 0 && (
        <ul className="findings">
          {notes.map((n) => (
            <li key={n}>
              <span aria-hidden="true">•</span>
              <div className="secondary">{n}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="review">
        <h3>Coach&apos;s preparation</h3>
        {card.prep ? (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.prep.markdown}</ReactMarkdown>
            <p className="muted">Saved {formatDate(card.prep.savedAt.slice(0, 19))}</p>
          </>
        ) : (
          <p className="muted">Not prepared yet.</p>
        )}
      </div>

      {comparable.length > 0 && (
        <div>
          <h3>Your closest dives</h3>
          <ul>
            {comparable.slice(0, 3).map((d) => (
              <li key={d.id}>
                <DiveLink dive={{ ...d, start: d.date }} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {(card.logged.length > 0 || card.loggedThatDay.length > 0) && (
        <div>
          <h3>Logged</h3>
          <ul>
            {card.logged.map((d) => (
              <li key={d.id} className="row">
                <span>
                  ✓ <DiveLink dive={d} />
                </span>
                <button className="button" disabled={busy} onClick={() => link(d.id, false)}>
                  Unlink
                </button>
              </li>
            ))}
            {card.loggedThatDay.map((d) => (
              <li key={d.id} className="row">
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

  return (
    <div className={`stack ${loading ? "loading" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{data.name}</h1>
          <div className="secondary">
            {[data.destination, formatDateRange(data.startDate, data.endDate), formatTripWhen(data)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="row">
          <Link className="button" href="/trips">
            All trips
          </Link>
          <button className="button" onClick={forget}>
            Forget this trip
          </button>
        </div>
      </div>
      {failure && <div className="error">{failure}</div>}

      <div className="card review">
        <h2>Trip notes</h2>
        {data.summary ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary.markdown}</ReactMarkdown> : <p className="muted">No notes for the whole trip yet.</p>}
        <TripPrepHint trip={data.name} />
      </div>

      {data.recurringIssues.length > 0 && (
        <div className="card">
          <h2>Keeps coming back in your dives</h2>
          <ul className="findings">
            {data.recurringIssues.map((r) => (
              <li key={r.title}>
                <span aria-label={r.severity === "critical" ? "Critical" : "Warning"} role="img">
                  {r.severity === "critical" ? "⛔" : "⚠️"}
                </span>
                <div>
                  <div className="title">{r.title}</div>
                  <div className="secondary">
                    {r.dives} of the last {r.of} dives before the trip
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.dives.length ? (
        data.dives.map((card) => <Card key={card.itemId} card={card} tripId={data.id} onChange={reload} />)
      ) : (
        <div className="notice">The trip has no dive cards. Add dives to it in TripDeck and run the preparation again.</div>
      )}
    </div>
  );
}
