"use client";

import { useCallback, useEffect, useState } from "react";
import type { Provider, ProviderId } from "@/lib/providers";
import type { AppStatus } from "@/lib/server/agentApps";
import { api } from "./useLive";

export type ProviderView = Provider & { model: string; key: { source: string; masked: string } | null };

export interface SettingsView {
  provider: ProviderId;
  model: string;
  providers: ProviderView[];
  apps: { claudeCode: AppStatus; codex: AppStatus };
  configPath: string;
  dataFolder: string;
}

/** The coach settings, and a way to change them. */
export function useSettings() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!alive) return;
        if (res.ok) setSettings(body);
        else setError(body.error);
      })
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (patch: object) => {
    const next = await api<SettingsView>("/api/settings", "PUT", patch);
    setSettings(next);
    return next;
  }, []);

  return { settings, error, save };
}
