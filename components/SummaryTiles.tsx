import Link from "next/link";
import { formatDate, formatMinutes } from "@/lib/format";
import type { LogView } from "@/lib/views";
import { useUnits } from "./Units";

/** Dives, time underwater, the deepest and the latest score. Shared by the web app and the phone app. */
export function SummaryTiles({ log }: { log: Pick<LogView, "dives" | "totals"> }) {
  const { show } = useUnits();
  const { totals, dives } = log;
  if (!dives.length) return null;
  const latest = dives[dives.length - 1];
  const deepest = dives.reduce((a, b) => (b.maxDepthM > a.maxDepthM ? b : a));
  return (
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
        <div className="value">{show("depth", totals.deepestM)}</div>
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
  );
}
