"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Command } from "./Command";
import { Icon } from "./Icons";
import { api } from "./useLive";
import { useSettings } from "./useSettings";

const DISMISSED = "divedeck.getStarted.dismissed";
const listeners = new Set<() => void>();

/** Whether the steps were hidden in this browser; hidden on the server, so nothing flashes. */
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type Storage = { active: "local" | "onedrive" | "google"; location: string };

/**
 * The first steps, on the dashboard until they are done or dismissed: where the log lives, the
 * first dives, and a companion that can reach them. Each step says whether it is done.
 */
export function GetStarted({ dives, onImported }: { dives: number; onImported: () => void }) {
  const { settings } = useSettings();
  const [storage, setStorage] = useState<Storage | null>(null);
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/storage", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then(setStorage)
      .catch(() => setStorage(null));
  }, []);

  if (!settings) return null;
  const provider = settings.providers.find((p) => p.id === settings.provider)!;
  const app = settings.provider === "codex" ? settings.apps.codex : settings.apps.claudeCode;
  const connected = provider.usesApi ? !!provider.key : app.runs === "typescript";
  const steps = [true, dives > 0, connected];
  if (dismissed || steps.every(Boolean)) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Without storage the steps can't stay hidden; they go once they are done anyway.
    }
    listeners.forEach((l) => l());
  }

  async function samples() {
    setBusy(true);
    try {
      await api("/api/import/samples", "POST");
      onImported();
    } finally {
      setBusy(false);
    }
  }

  const where = storage ? (storage.active === "google" ? storage.location : storage.active === "onedrive" ? "your OneDrive folder" : "this computer") : "…";
  const mark = (done: boolean, n: number) => (
    <span className={`step-mark ${done ? "done" : ""}`} aria-label={done ? "Done" : `Step ${n}`} role="img">
      {done ? Icon.check : n}
    </span>
  );

  return (
    <section className="card get-started" aria-labelledby="start-h">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="start-h" style={{ margin: 0 }}>
          Get started
        </h2>
        <button type="button" className="fold-all" onClick={dismiss}>
          Hide
        </button>
      </div>
      <ol className="steps">
        <li>
          {mark(steps[0], 1)}
          <div>
            <strong>Where your dives live</strong>
            <p className="secondary">
              Now on {where}. This PC, OneDrive or Google Drive: <Link href="/settings">change it in Settings</Link> any time; your dives are copied over.
            </p>
          </div>
        </li>
        <li>
          {mark(steps[1], 2)}
          <div>
            <strong>Your first dives</strong>
            {steps[1] ? (
              <p className="secondary">
                {dives} dive{dives === 1 ? "" : "s"} in your log.
              </p>
            ) : (
              <div className="row" style={{ marginTop: "0.4rem" }}>
                <Link className="button primary" href="/import">
                  Import UDDF files
                </Link>
                <button className="button" type="button" disabled={busy} onClick={samples}>
                  {busy ? "Loading…" : "Load sample dives"}
                </button>
              </div>
            )}
          </div>
        </li>
        <li>
          {mark(steps[2], 3)}
          <div>
            <strong>Your companion</strong>
            {connected ? (
              <p className="secondary">{provider.usesApi ? `${provider.name} is ready on the Companion page.` : `Connected to ${provider.app}.`}</p>
            ) : provider.usesApi ? (
              <p className="secondary">
                Add your API key in <Link href="/settings">Settings</Link>, or choose your Claude or ChatGPT subscription there.
              </p>
            ) : (
              <>
                <p className="secondary">
                  Connect DiveDeck to {provider.app} once, in a terminal, then restart it and ask for a debrief:
                </p>
                <Command block text={app.commands.join("\n")} />
              </>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}
