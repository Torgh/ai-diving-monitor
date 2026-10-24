import type { Finding, Severity } from "@/lib/analysis";

const ICON: Record<Severity, string> = { critical: "⛔", warning: "⚠️", info: "ℹ️", good: "✅" };
const LABEL: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Note", good: "Good" };

/** A status is never colour alone: a dot, an icon and a word. */
export function StatusBadge({ severity }: { severity: Severity }) {
  return (
    <span className="status">
      <span className={`dot ${severity}`} aria-hidden="true" />
      <span className="secondary">{LABEL[severity]}</span>
    </span>
  );
}

export function Findings({ findings }: { findings: Finding[] }) {
  if (!findings.length) return <p className="muted">No findings for this dive.</p>;
  return (
    <ul className="findings">
      {findings.map((f, i) => (
        <li key={`${f.title}${i}`}>
          <span aria-label={LABEL[f.severity]} role="img">
            {ICON[f.severity]}
          </span>
          <div>
            <div className="title">{f.title}</div>
            <div className="secondary">{f.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
