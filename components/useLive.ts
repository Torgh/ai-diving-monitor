"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Answer<T> = { data: T } | { error: string };
type VersionListener = (version: string) => void;

const versionListeners = new Set<VersionListener>();
let source: EventSource | null = null;

/** One connection to /api/events for the page, however many parts of it are live. */
function onVersion(listener: VersionListener): () => void {
  versionListeners.add(listener);
  if (!source) {
    source = new EventSource("/api/events");
    source.addEventListener("version", (e) => {
      for (const l of versionListeners) l((e as MessageEvent<string>).data);
    });
  }
  return () => {
    versionListeners.delete(listener);
    if (!versionListeners.size) {
      source?.close();
      source = null;
    }
  };
}

async function request<T>(url: string): Promise<Answer<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json();
    return res.ok ? { data: body as T } : { error: body.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * Loads `url` and loads it again whenever the dive log changes, also when the MCP server changed it:
 * the server sends the log's new version (/api/events), and a hidden page reloads once it is shown
 * again. The previous data stays on screen while a reload runs, so nothing flashes.
 */
export function useLive<T extends { version: string }>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const version = useRef<string | null>(null);
  const alive = useRef(true);

  const apply = useCallback((answer: Answer<T>) => {
    if (!alive.current) return;
    if ("data" in answer) {
      version.current = answer.data.version;
      setData(answer.data);
      setError(null);
    } else {
      setError(answer.error);
    }
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    apply(await request<T>(url));
  }, [url, apply]);

  useEffect(() => {
    alive.current = true;
    request<T>(url).then(apply);
    let stale = false;
    const load = () => {
      stale = false;
      setLoading(true);
      request<T>(url).then(apply);
    };
    const stop = onVersion((v) => {
      if (v === version.current) return;
      if (document.visibilityState === "visible") load();
      else stale = true;
    });
    const shown = () => {
      if (stale && document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", shown);
    return () => {
      alive.current = false;
      stop();
      document.removeEventListener("visibilitychange", shown);
    };
  }, [url, apply]);

  return { data, error, loading, reload };
}

/** JSON request to the app's API; throws the server's error message. */
export async function api<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}
