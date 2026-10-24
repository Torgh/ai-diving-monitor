"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 3000;

type Answer<T> = { data: T } | { error: string };

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
 * the cheap /api/version tag is polled while the page is visible. The previous data stays on screen
 * while a reload runs, so nothing flashes.
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
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      request<{ version: string }>("/api/version").then((answer) => {
        if ("data" in answer && answer.data.version !== version.current) {
          setLoading(true);
          request<T>(url).then(apply);
        }
      });
    }, POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
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
