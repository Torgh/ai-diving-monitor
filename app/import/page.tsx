"use client";

import Link from "next/link";
import { type DragEvent, useEffect, useState } from "react";
import { api } from "@/components/useLive";

type Result = { file: string; added?: number; duplicates?: number; error?: string };

export default function ImportPage() {
  const [results, setResults] = useState<Result[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [python, setPython] = useState<{ database: string; available: boolean } | null>(null);

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
      <h1>Import dives</h1>
      <div
        className={`card dropzone ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <p>Drop .uddf files here, exported from Subsurface, Shearwater Cloud, Garmin Dive, Suunto DM5, MacDive or DiveMate.</p>
        <label className="button primary">
          {busy ? "Importing…" : "Choose files"}
          <input type="file" accept=".uddf,.xml" multiple hidden disabled={busy} onChange={(e) => e.target.files && upload(e.target.files)} />
        </label>
        <p className="muted">Dives already in your log are skipped. The original files are kept, so dives are parsed again when the parser improves.</p>
      </div>

      {results && (
        <div className="card">
          <h2>Imported</h2>
          <ul>
            {results.map((r) => (
              <li key={r.file}>
                {r.file}: {r.error ? <span style={{ color: "var(--critical)" }}>⛔ {r.error}</span> : `${r.added} new, ${r.duplicates} already in the log`}
              </li>
            ))}
          </ul>
          <Link href="/dives">Open the dive log →</Link>
        </div>
      )}
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
