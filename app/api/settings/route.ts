import { z } from "zod";
import { isProviderId, maskKey, PROVIDERS, type ProviderId } from "@/lib/providers";
import { agentAppStatus } from "@/lib/server/agentApps";
import { apiKey, configPath, readSettings, select, selected, setApiKey } from "@/lib/server/config";
import { assertLocal, handle, readBody } from "@/lib/server/http";
import { dataDir } from "@/lib/server/paths";

function settingsView() {
  const { provider, model } = selected();
  const saved = readSettings();
  return {
    provider: provider.id,
    model,
    providers: Object.values(PROVIDERS).map((p) => {
      const key = p.usesApi ? apiKey(p.id) : null;
      return {
        ...p,
        model: saved.models?.[p.id] || p.models[0] || "",
        // Never the key itself: whether there is one, where it comes from, and its last characters.
        key: key ? { source: key.source, masked: maskKey(key.key) } : null,
      };
    }),
    apps: { claudeCode: agentAppStatus("claude-code"), codex: agentAppStatus("codex") },
    configPath: configPath(),
    dataFolder: dataDir(),
  };
}

export const GET = handle(async (req) => {
  assertLocal(req);
  return settingsView();
});

const patch = z.object({
  provider: z.string().refine(isProviderId, "Unknown provider").optional(),
  model: z.string().max(100).optional(),
  key: z.object({ provider: z.enum(["anthropic", "openai"]), value: z.string().max(500).nullable() }).optional(),
});

/** Chooses how the coach runs and with which model, and saves or removes an API key. */
export const PUT = handle(async (req) => {
  assertLocal(req);
  const body = await readBody(req, patch);
  if (body.key) await setApiKey(body.key.provider, body.key.value);
  if (body.provider) await select(body.provider as ProviderId, body.model);
  return settingsView();
});
