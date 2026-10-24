import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROVIDER, isProviderId, PROVIDERS, type Provider, type ProviderId } from "../providers";
import { writeFileAtomic } from "./files";
import { dataDir } from "./paths";

/**
 * The settings file shared with the Python version: `AI_DIVING_MONITOR_CONFIG`, else `config.json`
 * in the data folder. API keys are stored in plain text, outside the repository (mode 600 where the
 * OS allows it); the git hooks refuse to commit them.
 */
export interface Settings {
  provider?: string;
  models?: Record<string, string>;
  api_keys?: Record<string, string>;
}

export function configPath(): string {
  return process.env.AI_DIVING_MONITOR_CONFIG?.trim() || path.join(dataDir(), "config.json");
}

export function readSettings(): Settings {
  try {
    const data = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await writeFileAtomic(configPath(), JSON.stringify(settings, null, 2));
}

/** The chosen provider and model: saved settings, then environment variables, then Claude. */
export function selected(): { provider: Provider; model: string } {
  const settings = readSettings();
  let id: ProviderId = DEFAULT_PROVIDER;
  let model: string | undefined;
  if (isProviderId(settings.provider)) {
    id = settings.provider;
    model = settings.models?.[id];
  } else {
    const env = process.env.AI_DIVING_MONITOR_PROVIDER;
    if (isProviderId(env)) id = env;
    model = process.env.AI_DIVING_MONITOR_MODEL;
  }
  const provider = PROVIDERS[id];
  return { provider, model: model || provider.models[0] || "" };
}

export async function select(id: ProviderId, model?: string): Promise<void> {
  const settings = readSettings();
  settings.provider = id;
  if (model !== undefined) settings.models = { ...settings.models, [id]: model.trim() };
  await writeSettings(settings);
}

/** A saved key wins over the environment variable. */
export function apiKey(id: ProviderId): { key: string; source: "saved" | string } | null {
  const saved = readSettings().api_keys?.[id]?.trim();
  if (saved) return { key: saved, source: "saved" };
  const envVar = PROVIDERS[id].envVar;
  const env = envVar ? process.env[envVar]?.trim() : undefined;
  return env && envVar ? { key: env, source: envVar } : null;
}

/** Saves a key, or removes the saved one with null (an environment variable then applies again). */
export async function setApiKey(id: ProviderId, key: string | null): Promise<void> {
  const settings = readSettings();
  const keys = { ...settings.api_keys };
  if (key?.trim()) keys[id] = key.trim();
  else delete keys[id];
  settings.api_keys = keys;
  await writeSettings(settings);
}
