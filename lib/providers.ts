/**
 * How the coach runs: on the diver's subscription in Claude Code or Codex (through the MCP server,
 * no key, no extra cost), or in the app with a Claude or ChatGPT API key (billed per use).
 * The ids match the Python version's settings file, so both read the same choice.
 */

export type ProviderId = "anthropic" | "openai" | "claude-code" | "codex";

export interface Provider {
  id: ProviderId;
  name: string;
  /** The coach runs in this app and needs an API key. */
  usesApi: boolean;
  envVar?: string;
  models: string[];
  keyUrl?: string;
  /** For the subscription modes: the app the diver asks, and the plan it runs on. */
  app?: string;
  plan?: string;
}

export const PROVIDERS: Record<ProviderId, Provider> = {
  "claude-code": {
    id: "claude-code",
    name: "Claude Pro/Max plan (via Claude Code)",
    usesApi: false,
    models: [],
    app: "Claude Code",
    plan: "Claude Pro/Max plan",
  },
  codex: {
    id: "codex",
    name: "ChatGPT Plus/Pro plan (via Codex)",
    usesApi: false,
    models: [],
    app: "Codex",
    plan: "ChatGPT Plus/Pro plan",
  },
  anthropic: {
    id: "anthropic",
    name: "Claude API key (Anthropic)",
    usesApi: true,
    envVar: "ANTHROPIC_API_KEY",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    id: "openai",
    name: "ChatGPT API key (OpenAI)",
    usesApi: true,
    envVar: "OPENAI_API_KEY",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
};

export const DEFAULT_PROVIDER: ProviderId = "anthropic";

export const isProviderId = (id: unknown): id is ProviderId => typeof id === "string" && Object.hasOwn(PROVIDERS, id);

/** "…1234": enough to recognise a key, never enough to use it. */
export const maskKey = (key: string) => `…${key.slice(-4)}`;
