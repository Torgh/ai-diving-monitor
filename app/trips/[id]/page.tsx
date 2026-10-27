"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "@/components/Icons";
import { TripPrepHint } from "@/components/TripPrepHint";
import { BeforeYouGo, DiveDays, RecurringIssues, tripLine } from "@/components/TripPrep";
import { TripSites } from "@/components/TripSites";
import { TripTodos } from "@/components/TripTodos";
import { api, useLive } from "@/components/useLive";
import { formatDate } from "@/lib/format";
import type { TripView } from "@/lib/tripViews";

type Data = TripView & { version: string };

/** TripDeck's web app, for the "Open in TripDeck" link. */
const TRIPDECK_URL = process.env.NEXT_PUBLIC_TRIPDECK_URL ?? "http://localhost:3000";

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

  const edit = { tripId: data.id, onChange: reload };
  return (
    <div className={`stack ${loading ? "loading" : ""}`} style={{ gap: "1.25rem" }}>
      <div className="dive-head">
        <div>
          <Link className="back" href="/trips">
            ‹ Trips
          </Link>
          <h1>{data.name}</h1>
          <div className="secondary">{tripLine(data)}</div>
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

      <TripTodos todos={data.todos} cards={data.dives.map((d) => ({ itemId: d.itemId, title: d.date ? `${d.title} (${formatDate(d.date, false)})` : d.title }))} edit={edit} />

      <BeforeYouGo data={data} edit />

      <RecurringIssues data={data} />

      <section className="card review" aria-labelledby="notes-h">
        <h2 id="notes-h">Trip notes</h2>
        {data.summary ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary.markdown}</ReactMarkdown> : <p className="muted">No notes for the whole trip yet.</p>}
        <TripPrepHint trip={data.name} />
      </section>

      <TripSites trip={data.name} shop={data.shop} sites={data.sites} notes={data.siteNotes} edit={edit} />

      <DiveDays data={data} edit={edit} />
    </div>
  );
}
