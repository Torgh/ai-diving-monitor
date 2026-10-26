import { RESERVE_WARN_BAR } from "@/lib/analysis";
import { formatNumber, formatSeconds } from "@/lib/format";
import type { DiveView } from "@/lib/views";
import { useUnits } from "./Units";

/* A dive's score, headline and metrics. Shared by the web app and the phone app. */

/** The score on a ring, out of 100. */
export function ScoreRing({ score }: { score: number }) {
  const r = 50;
  const length = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 120 120" width="112" height="112" role="img" aria-label={`Dive score ${score} out of 100`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="var(--grid)" strokeWidth="12" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(length * Math.max(0, Math.min(score, 100))) / 100} ${length}`}
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="66" textAnchor="middle" fontSize="30" fontWeight="700">
        {score}
      </text>
      <text className="of" x="60" y="86" textAnchor="middle" fontSize="11">
        of 100
      </text>
    </svg>
  );
}

/** One sentence from the findings: how many things need attention. */
export function headline(findings: DiveView["findings"]) {
  const count = (severity: string) => findings.filter((f) => f.severity === severity).length;
  const [critical, warning] = [count("critical"), count("warning")];
  if (critical) return `${critical} serious problem${critical === 1 ? "" : "s"} to look at${warning ? `, and ${warning} more to watch` : ""}.`;
  if (warning) return `${warning} thing${warning === 1 ? "" : "s"} to watch.`;
  return "A clean dive: nothing to watch.";
}

/**
 * Profile, gas and safety in three cards. `detailsHref` links a missing tank size to the form that
 * fills it in; without it (the phone app) the card only says it is missing.
 */
export function MetricCards({ data, detailsHref }: { data: DiveView; detailsHref?: string }) {
  const { show, system } = useUnits();
  const { metrics: m, averages: avg } = data;
  const missingVolume = m.rmvLMin === null && data.tanks.some((t) => t.startBar && t.endBar !== null && !t.volumeL);
  const lowReserve = m.endPressureBar !== null && m.endPressureBar < RESERVE_WARN_BAR;
  const tank = data.tanks.find((t) => t.startBar !== null);
  const average = [
    avg.maxDepthM !== undefined ? show("depth", avg.maxDepthM) : null,
    avg.durationMin !== undefined ? formatNumber(avg.durationMin, 0, "min") : null,
    avg.maxAscentRateMMin !== undefined ? show("speed", avg.maxAscentRateMMin) : null,
  ].filter(Boolean);
  const safetyFoot = [
    m.ceilingViolationS > 0 ? `deco ceiling broken for ${formatSeconds(m.ceilingViolationS)}` : null,
    m.alarms.length ? `alarms: ${m.alarms.join(", ")}` : null,
  ].filter(Boolean);
  return (
    <section className="metric-cards" aria-label="Metrics">
      <div className="card metric-card">
        <h3>Profile</h3>
        <div className="kv">
          <span>Max depth</span>
          <strong>{show("depth", m.maxDepthM)}</strong>
        </div>
        <div className="kv">
          <span>Duration</span>
          <strong>{formatNumber(m.durationMin, 0, "min")}</strong>
        </div>
        <div className="kv">
          <span>Peak ascent</span>
          <strong>{show("speed", m.maxAscentRateMMin)}</strong>
        </div>
        {average.length > 0 && <span className="foot">Your average: {average.join(" · ")}</span>}
      </div>

      <div className={`card metric-card ${missingVolume || lowReserve ? "warn" : ""}`}>
        <h3>Gas</h3>
        <div className="kv">
          <span>Gas left</span>
          <strong className={lowReserve ? "warn" : ""}>{show("pressure", m.endPressureBar)}</strong>
        </div>
        <div className="kv">
          <span>Consumption (RMV)</span>
          {missingVolume && detailsHref ? (
            <a href={detailsHref} style={{ fontWeight: 600 }}>
              add tank size
            </a>
          ) : missingVolume ? (
            <span className="muted">tank size unknown</span>
          ) : (
            <strong>{show("flow", m.rmvLMin)}</strong>
          )}
        </div>
        <div className="kv">
          <span>CNS</span>
          <strong>{formatNumber(m.cnsPercent, 1, "%")}</strong>
        </div>
        <span className="foot">
          {[
            tank ? `${show("pressure", tank.startBar)} → ${show("pressure", tank.endBar)}` : "no tank pressure",
            m.maxPpo2 !== null ? `max ppO2 ${formatNumber(m.maxPpo2, 2)}` : null,
            m.gases.join(", ") || "gas unknown",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      <div className="card metric-card">
        <h3>Safety</h3>
        <div className="kv">
          <span>Time at {system === "imperial" ? "10–20 ft" : "3–6 m"}</span>
          <strong>{formatSeconds(m.safetyStopS)}</strong>
        </div>
        <div className="kv">
          <span>Lowest NDL</span>
          <strong>{m.minNdlMin !== null ? formatNumber(m.minNdlMin, 0, "min") : "–"}</strong>
        </div>
        <div className="kv">
          <span>Decompression</span>
          <strong>{m.hadDeco ? "yes" : "none"}</strong>
        </div>
        <span className="foot">{safetyFoot.length ? safetyFoot.join(" · ") : "no ceiling breaches or alarms"}</span>
      </div>
    </section>
  );
}
