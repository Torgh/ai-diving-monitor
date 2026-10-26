"use client";

import { useState } from "react";
import { Command } from "@/components/Command";
import { FoldedMarkdown } from "@/components/FoldedMarkdown";
import { useUnits } from "@/components/Units";
import { api } from "@/components/useLive";
import { formatDate } from "@/lib/format";
import type { SavedText, SiteStatus, TripShop, TripSite } from "@/lib/trip";

/** Depth range, distance, type and entry, in a few words. */
export function siteFacts(site: Pick<TripSite, "minDepthM" | "maxDepthM" | "distanceKm" | "type" | "entry">, depth: (m: number) => string): string {
  const range =
    site.minDepthM !== undefined && site.maxDepthM !== undefined
      ? `${depth(site.minDepthM)}–${depth(site.maxDepthM)}`
      : site.maxDepthM !== undefined
        ? `to ${depth(site.maxDepthM)}`
        : null;
  return [range, site.distanceKm !== undefined ? `${site.distanceKm} km from the shop` : null, site.type, site.entry ? `${site.entry} entry` : null]
    .filter(Boolean)
    .join(" · ");
}

/** A link to where the site's facts come from, when it is a web page. */
function SourceLink({ site }: { site: TripSite }) {
  if (!site.source?.startsWith("http")) return null;
  return (
    <a className="muted" href={site.source} target="_blank" rel="noreferrer" style={{ marginLeft: "auto", fontSize: "0.85rem" }}>
      Source
    </a>
  );
}

function SiteCard({ site, busy, onChoose }: { site: TripSite; busy: boolean; onChoose: (status: SiteStatus) => void }) {
  const { show } = useUnits();
  const line = siteFacts(site, (m) => show("depth", m));
  return (
    <article className={`card site-card ${site.status}`} id={`site-${site.id}`}>
      <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <strong>{site.name}</strong>
          {line && (
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              {line}
            </div>
          )}
        </div>
        {site.status === "chosen" && <span className="pill chosen">Chosen</span>}
      </div>
      <p style={{ margin: 0 }}>{site.why}</p>
      <div className="row" style={{ gap: "0.4rem", marginTop: "auto" }}>
        {site.status !== "chosen" && (
          <button className="button small primary" type="button" disabled={busy} onClick={() => onChoose("chosen")}>
            Choose
          </button>
        )}
        {site.status === "proposed" && (
          <button className="button small" type="button" disabled={busy} onClick={() => onChoose("dropped")}>
            Not this one
          </button>
        )}
        {site.status === "chosen" && (
          <button className="button small" type="button" disabled={busy} onClick={() => onChoose("proposed")}>
            Undo
          </button>
        )}
        <SourceLink site={site} />
      </div>
    </article>
  );
}

/** A chosen site: what was proposed (facts, why it suits you, source) stays, and the profile follows. */
function ChosenSite({ site, busy, onUndo }: { site: TripSite; busy: boolean; onUndo: () => void }) {
  const { show } = useUnits();
  const line = siteFacts(site, (m) => show("depth", m));
  return (
    <article className="card stack site-profile" id={`site-${site.id}`} aria-labelledby={`site-h-${site.id}`}>
      <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h3 id={`site-h-${site.id}`} style={{ margin: 0, fontSize: "1.05rem" }}>
            {site.name}
          </h3>
          {line && (
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              {line}
            </div>
          )}
        </div>
        <button className="button small" type="button" disabled={busy} onClick={onUndo}>
          Undo choice
        </button>
      </div>
      <div className="row" style={{ gap: "0.5rem", alignItems: "baseline" }}>
        <p style={{ margin: 0, flex: "1 1 260px" }}>{site.why}</p>
        <SourceLink site={site} />
      </div>
      {site.profile ? (
        <div className="review">
          <FoldedMarkdown markdown={site.profile.markdown} />
          <p className="muted">Researched {formatDate(site.profile.savedAt.slice(0, 19))}</p>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Not researched yet.
        </p>
      )}
    </article>
  );
}

/**
 * The dive sites your companion proposed around the trip's dive shop. You choose; it then researches
 * only the chosen ones, and their profiles show here.
 */
export function TripSites({
  tripId,
  trip,
  shop,
  sites,
  notes,
  onChange,
}: {
  tripId: string;
  trip: string;
  shop: TripShop | null;
  sites: TripSite[];
  notes: SavedText | null;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const scout = <Command text={`/mcp__divedeck__site-scout ${trip}`} />;

  async function choose(siteId: string, status: SiteStatus) {
    setBusy(true);
    setFailure(null);
    try {
      await api(`/api/trips/${tripId}/sites`, "POST", { siteId, status });
      onChange();
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!sites.length)
    return (
      <section className="card stack" id="sites" aria-labelledby="sites-h">
        <h2 id="sites-h" style={{ margin: 0 }}>
          Dive sites
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Your companion can propose the dive sites around your dive shop that suit your log; you choose, and it then finds out what each chosen one takes. Ask it in Claude
          Code or Codex: {scout}.
        </p>
      </section>
    );

  const chosen = sites.filter((s) => s.status === "chosen");
  const proposed = sites.filter((s) => s.status === "proposed");
  const dropped = sites.filter((s) => s.status === "dropped");
  const waiting = chosen.filter((s) => !s.profile);
  return (
    <section className="stack" id="sites" style={{ gap: "0.75rem" }} aria-labelledby="sites-h">
      <div className="chart-head">
        <h2 id="sites-h" style={{ margin: 0 }}>
          Dive sites
        </h2>
        {shop && <span className="muted">around {shop.name}</span>}
      </div>

      {notes && (
        <section className="card review" aria-labelledby="site-notes-h">
          <h3 id="site-notes-h" style={{ marginTop: 0 }}>
            What your companion weighed
          </h3>
          <FoldedMarkdown markdown={notes.markdown} />
          <p className="muted">Saved {formatDate(notes.savedAt.slice(0, 19))}</p>
        </section>
      )}

      {chosen.map((site) => (
        <ChosenSite key={site.id} site={site} busy={busy} onUndo={() => choose(site.id, "proposed")} />
      ))}

      {waiting.length > 0 && (
        <div className="notice">
          {waiting.length === 1 ? `${waiting[0].name} is` : `${waiting.length} chosen sites are`} waiting for your companion to find out the conditions and what it
          takes: {scout}.
        </div>
      )}

      {proposed.length > 0 && (
        <>
          <h3 className="group-title">{chosen.length ? "More proposals" : "Proposed for you: choose the ones you want to dive"}</h3>
          <div className="gear-grid">
            {proposed.map((site) => (
              <SiteCard key={site.id} site={site} busy={busy} onChoose={(status) => choose(site.id, status)} />
            ))}
          </div>
        </>
      )}

      {dropped.length > 0 && (
        <details>
          <summary className="muted">
            {dropped.length} not for this trip: {dropped.map((s) => s.name).join(", ")}
          </summary>
          <div className="gear-grid" style={{ marginTop: "0.6rem" }}>
            {dropped.map((site) => (
              <SiteCard key={site.id} site={site} busy={busy} onChoose={(status) => choose(site.id, status)} />
            ))}
          </div>
        </details>
      )}

      {failure && <div className="error">{failure}</div>}
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
        Sites: ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>{" "}
        (mapped by volunteers) and the web; sea forecast: Open-Meteo. The dive centre&apos;s briefing decides on the day.
      </p>
    </section>
  );
}
