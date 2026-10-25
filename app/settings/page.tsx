"use client";

import { useState } from "react";
import { StorageSettings } from "@/components/StorageSettings";
import { type ProviderView, useSettings } from "@/components/useSettings";
import { api } from "@/components/useLive";
import type { AppStatus } from "@/lib/server/agentApps";
import { Command } from "@/components/Command";

function Commands({ status }: { status: AppStatus }) {
  const name = status.app === "claude-code" ? "Claude Code" : "Codex";
  if (status.runs === "typescript") return <p className="secondary">✅ Connected: {name} reads this dive log.</p>;
  return (
    <div className="stack" style={{ gap: "0.4rem" }}>
      <p className="secondary">
        {status.runs === "python"
          ? `⚠️ ${name} still runs the Python version's server, which reads the old database. Switch it over in a terminal:`
          : status.registered
            ? `⚠️ ${name} has a server called divedeck that isn't this app's. Replace it in a terminal:`
            : `Connect the dive log to ${name} once, in a terminal:`}
      </p>
      <Command block text={status.commands.join("\n")} />
      <p className="muted">Then restart {name}. Your settings and the data folder carry over through the environment variables above.</p>
    </div>
  );
}

function ApiProvider({ p, onSave }: { p: ProviderView; onSave: (patch: object) => Promise<unknown> }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(p.model);
  const [models, setModels] = useState<string[]>(p.models);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
    } catch (err) {
      setMessage(`⛔ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <label className="wide">
        API key {p.key ? `(${p.key.source === "saved" ? "saved" : `from ${p.key.source}`}: ${p.key.masked})` : "(none yet)"}
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.key ? "Enter a new key to replace it" : "Paste your key"} />
      </label>
      <div className="row wide">
        <button className="button primary" disabled={busy || !key.trim()} onClick={() => run(() => onSave({ key: { provider: p.id, value: key } }).then(() => setKey("")), "Key saved.")}>
          Save key
        </button>
        {p.key?.source === "saved" && (
          <button className="button" disabled={busy} onClick={() => run(() => onSave({ key: { provider: p.id, value: null } }), "Saved key removed.")}>
            Remove saved key
          </button>
        )}
        <a href={p.keyUrl} target="_blank" rel="noreferrer">
          Get a key
        </a>
      </div>
      <label>
        Model
        <input list={`models-${p.id}`} value={model} onChange={(e) => setModel(e.target.value)} />
        <datalist id={`models-${p.id}`}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <div className="row" style={{ alignSelf: "end" }}>
        <button className="button" disabled={busy || !model.trim()} onClick={() => run(() => onSave({ provider: p.id, model }), `Model set to ${model}.`)}>
          Use this model
        </button>
        <button
          className="button"
          disabled={busy || !p.key}
          onClick={() =>
            run(async () => {
              const { models: list } = await api<{ models: string[] }>("/api/settings/models", "POST", { provider: p.id });
              setModels(list);
            }, "Loaded the models your key can use.")
          }
        >
          Load models from the API
        </button>
      </div>
      {message && (
        <p className="wide secondary" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { settings, error, save } = useSettings();
  const [installed, setInstalled] = useState<string | null>(null);
  if (error) return <div className="error">{error}</div>;
  if (!settings) return <p className="muted">Loading settings…</p>;
  const active = settings.providers.find((p) => p.id === settings.provider)!;

  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="card stack">
        <h2>AI companion</h2>
        <p className="secondary">
          Your companion reads your dives through tools that return the parsed numbers, so its advice rests on your data. With your subscription it runs
          in Claude Code or Codex at no extra cost; with an API key it runs here and the provider bills each use.
        </p>
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: "0.4rem" }}>
          <legend className="muted">How should your companion run?</legend>
          {settings.providers.map((p) => (
            <label key={p.id} className="row" style={{ gap: "0.5rem" }}>
              <input type="radio" name="provider" checked={p.id === settings.provider} onChange={() => save({ provider: p.id })} />
              <span>
                {p.name}
                {p.usesApi ? <span className="muted"> · billed per use</span> : <span className="muted"> · no key, no extra cost</span>}
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="card stack">
        <h2>{active.name}</h2>
        {active.usesApi ? (
          <ApiProvider key={active.id} p={active} onSave={save} />
        ) : (
          <>
            <Commands status={active.id === "claude-code" ? settings.apps.claudeCode : settings.apps.codex} />
            {active.id === "claude-code" && (
              <div className="row">
                {settings.apps.claudeCode.reviewCommandInstalled ? (
                  <span className="secondary">✅ The /dive-review command is installed.</span>
                ) : (
                  <button
                    className="button"
                    onClick={() =>
                      api("/api/settings/review-command", "POST")
                        .then(() => setInstalled("Installed: run /dive-review in any Claude Code session."))
                        .catch((err: Error) => setInstalled(`⛔ ${err.message}`))
                    }
                  >
                    Install the /dive-review command
                  </button>
                )}
                {installed && <span className="secondary">{installed}</span>}
              </div>
            )}
            <p className="muted">
              Then ask in {active.app}: “Debrief my latest dive and save it”, or run <Command text="/mcp__divedeck__dive-review" />. Debriefs
              appear here within seconds.
            </p>
          </>
        )}
      </div>

      <StorageSettings />

      <div className="card">
        <h2>On this computer</h2>
        <p className="secondary">
          Settings and API keys (plain text, never synced): <code>{settings.configPath}</code>
          <br />
          Data folder (settings, sign-in, locks): <code>{settings.dataFolder}</code>
        </p>
      </div>
    </div>
  );
}
