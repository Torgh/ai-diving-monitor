"use client";

import { useEffect, useState } from "react";
import { api } from "./useLive";

interface StorageView {
  active: "local" | "onedrive" | "google";
  chosen: string;
  location: string;
  local: { folder: string };
  onedrive: { folder: string | null; configuredFolder: string | null };
  google: { clientConfigured: boolean; clientId: string | null; account: string | null };
  copied?: number;
}

/** Where the dive log is stored: this PC, the OneDrive folder, or Google Drive. */
export function StorageSettings() {
  const [view, setView] = useState<StorageView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState("");
  const [client, setClient] = useState({ id: "", secret: "" });

  useEffect(() => {
    let alive = true;
    fetch("/api/storage", { cache: "no-store" })
      .then((r) => r.json())
      .then((v: StorageView) => {
        if (!alive) return;
        setView(v);
        // Back from the Google sign-in.
        const params = new URLSearchParams(window.location.search);
        if (params.get("google") === "connected") setMessage(`Google Drive connected. Copied ${params.get("copied") ?? 0} dives there.`);
        if (params.get("google") === "error") setMessage(`⛔ ${params.get("message") ?? "Google sign-in failed."}`);
      })
      .catch((err: Error) => alive && setMessage(`⛔ ${err.message}`));
    return () => {
      alive = false;
    };
  }, []);

  async function post(body: object, done: (v: StorageView) => string) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await api<StorageView>("/api/storage", "POST", body);
      setView(next);
      setMessage(done(next));
    } catch (err) {
      setMessage(`⛔ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!view) return null;
  const copied = (v: StorageView) => (v.copied ? ` Copied ${v.copied} dives there; the old place keeps its copy.` : "");
  const choose = (storage: StorageView["active"]) =>
    post({ storage }, (v) => `Your dives are now stored in ${v.location}.${copied(v)}`);

  return (
    <div className="card stack" id="storage">
      <h2>Where your dives are stored</h2>
      <p className="secondary">
        Now: <code>{view.location}</code>. Each dive is one file, next to the original UDDF file it came from. Switching copies your dives to the new
        place; the dive with the newer changes wins.
      </p>

      <label className="row" style={{ gap: "0.5rem" }}>
        <input type="radio" name="storage" checked={view.active === "local"} disabled={busy} onChange={() => choose("local")} />
        <span>
          This PC <span className="muted">· {view.local.folder}</span>
        </span>
      </label>

      <div className="stack" style={{ gap: "0.4rem" }}>
        <label className="row" style={{ gap: "0.5rem" }}>
          <input type="radio" name="storage" checked={view.active === "onedrive"} disabled={busy || !view.onedrive.folder} onChange={() => choose("onedrive")} />
          <span>
            OneDrive{" "}
            <span className="muted">
              · {view.onedrive.folder ? `${view.onedrive.folder}, synced by the OneDrive app, no sign-in needed` : "OneDrive wasn't found on this PC"}
            </span>
          </span>
        </label>
        <div className="row" style={{ paddingLeft: "1.6rem" }}>
          <input
            className="button"
            style={{ minWidth: "18rem", cursor: "text" }}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={view.onedrive.configuredFolder ?? "Your OneDrive folder, if it isn't found"}
          />
          <button className="button" disabled={busy || !folder.trim()} onClick={() => post({ oneDriveFolder: folder }, (v) => (v.onedrive.folder ? "OneDrive folder saved." : "⛔ That folder doesn't exist."))}>
            Save folder
          </button>
        </div>
      </div>

      <div className="stack" style={{ gap: "0.4rem" }}>
        <label className="row" style={{ gap: "0.5rem" }}>
          <input type="radio" name="storage" checked={view.active === "google"} disabled={busy || view.google.account === null} onChange={() => choose("google")} />
          <span>
            Google Drive{" "}
            <span className="muted">
              · {view.google.account !== null ? `My Drive › AI Diving Monitor${view.google.account ? `, ${view.google.account}` : ""}` : "not connected"}
            </span>
          </span>
        </label>
        <div className="stack" style={{ paddingLeft: "1.6rem", gap: "0.4rem" }}>
          {view.google.account !== null ? (
            <button
              className="button"
              style={{ alignSelf: "start" }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api<{ copied: number }>("/api/auth/google/disconnect", "POST");
                  setMessage(`Google Drive disconnected.${r.copied ? ` Copied ${r.copied} dives to this PC first.` : ""}`);
                  setView(await (await fetch("/api/storage", { cache: "no-store" })).json());
                } catch (err) {
                  setMessage(`⛔ ${(err as Error).message}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Disconnect Google Drive
            </button>
          ) : view.google.clientConfigured ? (
            <a className="button primary" style={{ alignSelf: "start", textDecoration: "none" }} href="/api/auth/google/start">
              Connect Google Drive
            </a>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>
                Google needs your own OAuth client, once: in Google Cloud enable the Google Drive API, set the audience to External and publish the app,
                then create an OAuth client of type Web application with the redirect URI <code>http://localhost:3001/api/auth/google/callback</code>. The
                app only asks for the files it creates.
              </p>
              <div className="form">
                <label>
                  Client ID
                  <input value={client.id} onChange={(e) => setClient({ ...client, id: e.target.value })} />
                </label>
                <label>
                  Client secret
                  <input type="password" autoComplete="off" value={client.secret} onChange={(e) => setClient({ ...client, secret: e.target.value })} />
                </label>
              </div>
              <button
                className="button"
                style={{ alignSelf: "start" }}
                disabled={busy || !client.id.trim() || !client.secret.trim()}
                onClick={() => post({ googleClientId: client.id, googleClientSecret: client.secret }, () => "Google OAuth client saved. Now connect Google Drive.")}
              >
                Save OAuth client
              </button>
            </>
          )}
        </div>
      </div>

      {message && (
        <p className="secondary" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
