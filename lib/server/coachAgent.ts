import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";
import { SYSTEM_PROMPT } from "../coach";
import { callCoachTool, COACH_TOOLS, type ToolContext } from "../coachTools";
import { PROVIDERS, type ProviderId } from "../providers";
import { apiKey } from "./config";
import { envVar } from "./paths";
import { HttpError } from "./http";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** The coach's answer; `complete` is false when it was declined, cut off or empty, so it isn't saved as a review. */
export interface CoachAnswer {
  text: string;
  complete: boolean;
}

/** The in-app coach writes for the screen, in the language the diver writes in. */
const APP_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

Answer in the language the diver writes in, formatted in Markdown, concise enough to read on a phone.`;

/** Claude Opus 5.5 defaults to medium effort; a dive review compares a lot of numbers, so ask for high. */
const EFFORT = (envVar("EFFORT") as "low" | "medium" | "high" | "xhigh" | "max" | undefined) || "high";
const MAX_TOOL_ROUNDS = 25;

/** Models that take server-side fallbacks: a request their safety classifiers decline is re-run on another model. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export interface Clients {
  anthropic?: (key: string) => Anthropic;
  openai?: (key: string) => OpenAI;
}

function keyFor(id: ProviderId): string {
  const found = apiKey(id);
  if (!found) {
    throw new HttpError(400, `No API key for ${PROVIDERS[id].name}. Add one in Settings or set ${PROVIDERS[id].envVar}.`);
  }
  return found.key;
}

async function runClaude(messages: ChatMessage[], model: string, ctx: ToolContext, make: (key: string) => Anthropic): Promise<CoachAnswer> {
  const client = make(keyFor("anthropic"));
  const tools = COACH_TOOLS.map((t) =>
    betaZodTool({
      name: t.name,
      description: t.description,
      inputSchema: t.schema as z.ZodObject,
      run: (args) => callCoachTool(t.name, args, ctx),
    }),
  );
  const final = await client.beta.messages.toolRunner({
    model,
    max_tokens: 16000,
    system: APP_SYSTEM_PROMPT,
    tools,
    messages,
    max_iterations: MAX_TOOL_ROUNDS,
    output_config: { effort: EFFORT },
    ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  if (final.stop_reason === "refusal") return DECLINED;
  const text = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  return finish(text, final.stop_reason === "max_tokens");
}

const DECLINED: CoachAnswer = { text: "The AI coach declined to answer this request.", complete: false };

function finish(text: string, truncated: boolean): CoachAnswer {
  if (!text) return { text: "The coach did not return any text.", complete: false };
  return truncated ? { text: `${text}\n\n_(Answer truncated.)_`, complete: false } : { text, complete: true };
}

const OPENAI_TOOLS: ChatCompletionTool[] = COACH_TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema) as Record<string, unknown> },
}));

async function runChatGpt(messages: ChatMessage[], model: string, ctx: ToolContext, make: (key: string) => OpenAI): Promise<CoachAnswer> {
  const client = make(keyFor("openai"));
  const convo: ChatCompletionMessageParam[] = [{ role: "system", content: APP_SYSTEM_PROMPT }, ...messages];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.chat.completions.create({ model, messages: convo, tools: OPENAI_TOOLS });
    const choice = response.choices[0];
    const message = choice.message;
    if (!message.tool_calls?.length) {
      if (choice.finish_reason === "content_filter") return DECLINED;
      return finish((message.content ?? "").trim(), choice.finish_reason === "length");
    }
    convo.push(message);
    for (const call of message.tool_calls) {
      let content: string;
      if (call.type !== "function") {
        content = JSON.stringify({ error: "Unknown tool" });
      } else {
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments || "{}");
          content = await callCoachTool(call.function.name, args, ctx);
        } catch {
          content = JSON.stringify({ error: "Tool arguments were not valid JSON" });
        }
      }
      convo.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return { text: "The coach used too many tool calls without finishing its answer. Please try again.", complete: false };
}

/** Runs the coach on the chosen API provider and returns its Markdown answer. */
export async function runCoach(
  provider: ProviderId,
  model: string,
  messages: ChatMessage[],
  ctx: ToolContext,
  clients: Clients = {},
): Promise<CoachAnswer> {
  if (provider === "anthropic") return runClaude(messages, model, ctx, clients.anthropic ?? ((apiKey) => new Anthropic({ apiKey })));
  if (provider === "openai") return runChatGpt(messages, model, ctx, clients.openai ?? ((apiKey) => new OpenAI({ apiKey })));
  const { app, plan } = PROVIDERS[provider];
  throw new HttpError(400, `The coach runs in ${app} on your ${plan}: ask there, or choose an API key in Settings.`);
}

/** Model ids the provider offers to this key. */
export async function listModels(provider: ProviderId, clients: Clients = {}): Promise<string[]> {
  if (provider === "anthropic") {
    const client = (clients.anthropic ?? ((apiKey) => new Anthropic({ apiKey })))(keyFor("anthropic"));
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids.sort();
  }
  if (provider === "openai") {
    const client = (clients.openai ?? ((apiKey) => new OpenAI({ apiKey })))(keyFor("openai"));
    const ids: string[] = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return ids.sort();
  }
  return [];
}

/** What went wrong with a provider's API, in words a diver can act on. */
export function describeApiError(err: unknown): HttpError | null {
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) {
    return new HttpError(401, "The API key was rejected. Check it in Settings.");
  }
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    return new HttpError(429, "The AI provider's rate limit was reached. Try again in a moment.");
  }
  if (err instanceof Anthropic.NotFoundError || err instanceof OpenAI.NotFoundError) {
    return new HttpError(400, "The model wasn't found. Pick another model in Settings.");
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) {
    return new HttpError(502, "Couldn't reach the AI provider. Check the internet connection.");
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    return new HttpError(502, `The AI provider answered with an error: ${err.message}`);
  }
  return null;
}
