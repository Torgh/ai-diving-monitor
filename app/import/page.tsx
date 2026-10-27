"use client";

import Link from "next/link";
import { type DragEvent, useEffect, useState } from "react";
import { Icon } from "@/components/Icons";
import { api } from "@/components/useLive";
import type { LogView } from "@/lib/views";

type Result = { file: string; added?: number; duplicates?: number; error?: string };

/** What the import did, file by file, and where to go next. */
function ImportSummary({ results, after }: { results: Result[]; after: { dives: number; toSortOut: number } | null }) {
  const added = results.reduce((n, r) => n + (r.added ?? 0), 0);
  const known = results.reduce((n, r) => n + (r.duplicates ?? 0), 0);
  const failed = results.filter((r) => r.error).length;
  return (
    <section className="card import-summary" aria-live="polite" aria-labelledby="imported-h">
      <h2 id="imported-h" style={{ margin: 0 }}>
        Imported
      </h2>
      <div>
        <span className="big">
          {added} new dive{added === 1 ? "" : "s"}
        </span>
        <span className="muted">
          {known ? ` · ${known} already in the log` : ""}
          {failed ? ` · ${failed} file${failed === 1 ? "" : "s"} couldn't be read` : ""}
        </span>
      </div>
      <ul>
        {results.map((r) => (
          <li key={r.file}>
            <span className={`severity ${r.error ? "critical" : "good"}`} role="img" aria-label={r.error ? "Failed" : "Read"}>
              {r.error ? Icon.stop : Icon.check}
            </span>
            <span>
              {r.file}: {r.error ? <span style={{ color: "var(--critical)" }}>{r.error}</span> : `${r.added} new, ${r.duplicates} already in the log`}
            </span>
          </li>
        ))}
      </ul>
      {after && after.toSortOut > 0 && (
        <div className="notice">
          {after.toSortOut} of your {after.dives} dives miss a detail (tank size, gas, site or a debrief). Filling them in gives you gas consumption and
          the ppO2 checks.
        </div>
      )}
      <div className="row">
        {after && after.toSortOut > 0 && (
          <Link className="button primary" href="/">
            Sort them out
          </Link>
        )}
        <Link className="button" href="/dives">
          Open the dive log
        </Link>
      </div>
    </section>
  );
}

export default function ImportPage() {
  const [results, setResults] = useState<Result[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [python, setPython] = useState<{ database: string; available: boolean } | null>(null);
  /** The log after an import: how many dives, and how many of them miss something. */
  const [after, setAfter] = useState<{ dives: number; toSortOut: number } | null>(null);

  async function refreshLog() {
    try {
      const res = await fetch("/api/dives", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const log: LogView = await res.json();
      setAfter({ dives: log.dives.length, toSortOut: new Set(log.todos.flatMap((t) => t.dives)).size });
    } catch {
      setAfter(null);
    }
  }

  useEffect(() => {
    fetch("/api/migrate")
      .then((r) => r.json())
      .then(setPython)
      .catch(() => setPython(null));
  }, []);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      for (const f of list) form.append("files", f);
      const res = await fetch("/api/import", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setResults(body.results);
      await refreshLog();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function run(what: "samples" | "migrate") {
    setBusy(true);
    setMessage(null);
    try {
      if (what === "samples") {
        const { added } = await api<{ added: number }>("/api/import/samples", "POST");
        setMessage(added ? `Loaded ${added} sample dives.` : "The sample dives are already in your log.");
      } else {
        const r = await api<{ added: number; alreadyThere: number; reviews: number; failed: { fileName: string }[] }>("/api/migrate", "POST");
        setMessage(
          `Copied ${r.added} dives and ${r.reviews} reviews from the Python version (${r.alreadyThere} were already here)` +
            (r.failed.length ? `; couldn't read ${r.failed.map((f) => f.fileName).join(", ")}.` : "."),
        );
      }
      await refreshLog();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void upload(e.dataTransfer.files);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Import dives</h1>
      </div>
      <div
        className={`card dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <p>
          Drop .uddf files here, exported from Subsurface, Shearwater Cloud, Garmin Dive, Suunto DM5, MacDive or DiveMate, or the .divedeck.json file the phone app sends
          with the dives imported there.
        </p>
        <label className="button primary">
          {busy ? "Importing…" : "Choose files"}
          <input type="file" accept=".uddf,.xml,.json" multiple hidden disabled={busy} onChange={(e) => e.target.files && upload(e.target.files)} />
        </label>
        <p className="muted">Dives already in your log are skipped. The original files are kept, so dives are parsed again when the parser improves.</p>
      </div>

      {results && <ImportSummary results={results} after={after} />}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}

      <div className="grid cols-2">
        {python?.available && (
          <div className="card">
            <h2>From the Python version</h2>
            <p className="secondary">
              Copy every dive and saved review from <code>{python.database}</code>. The database is only read; running it again adds nothing twice.
            </p>
            <button className="button" disabled={busy} onClick={() => run("migrate")}>
              Copy my old log
            </button>
          </div>
        )}
        <div className="card">
          <h2>No dive computer at hand?</h2>
          <p className="secondary">Load nine fictional dives that show a diver&apos;s progression from spring to autumn, including a trimix deco dive.</p>
          <button className="button" disabled={busy} onClick={() => run("samples")}>
            Load sample dives
          </button>
        </div>
      </div>
    </div>
  );
}
