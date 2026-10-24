import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as coach } from "./coach/route";
import { POST as review } from "./coach/review/route";
import { POST as importSamples } from "./import/samples/route";
import { POST as models } from "./settings/models/route";
import { GET as getSettings, PUT as putSettings } from "./settings/route";

const URL_BASE = "http://localhost:3001";
const saved = { ...process.env };
let home: string;

const json = (p: string, method: string, body: unknown) =>
  new Request(URL_BASE + p, { method, body: JSON.stringify(body), headers: { host: "localhost:3001", "content-type": "application/json", origin: URL_BASE } });
const read = async (res: Response) => [res.status, await res.json()] as const;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-settings-"));
  for (const name of ["AI_DIVING_MONITOR_CONFIG", "AI_DIVING_MONITOR_PROVIDER", "AI_DIVING_MONITOR_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[name];
  process.env.AI_DIVING_MONITOR_HOME = home;
  process.env.AI_DIVING_MONITOR_DB = path.join(home, "no-such.db");
});

afterEach(() => {
  process.env = { ...saved };
  fs.rmSync(home, { recursive: true, force: true });
});

describe("settings API", () => {
  it("shows the choice, never a key", async () => {
    await putSettings(json("/api/settings", "PUT", { key: { provider: "anthropic", value: "sk-ant-secret-1234" } }), {});
    const [status, body] = await read(await getSettings(new Request(`${URL_BASE}/api/settings`, { headers: { host: "localhost:3001" } }), {}));
    expect(status).toBe(200);
    expect(body).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5", dataFolder: home });
    expect(body.providers.find((p: { id: string }) => p.id === "anthropic").key).toEqual({ source: "saved", masked: "…1234" });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(body.apps.claudeCode).toHaveProperty("commands");
  });

  it("switches the coach and its model", async () => {
    const [, body] = await read(await putSettings(json("/api/settings", "PUT", { provider: "openai", model: "gpt-5-mini" }), {}));
    expect(body).toMatchObject({ provider: "openai", model: "gpt-5-mini" });
    const [, sub] = await read(await putSettings(json("/api/settings", "PUT", { provider: "claude-code" }), {}));
    expect(sub.provider).toBe("claude-code");
    expect((await putSettings(json("/api/settings", "PUT", { provider: "gemini" }), {})).status).toBe(400);
  });

  it("explains what's missing instead of calling an API", async () => {
    expect(await read(await models(json("/api/settings/models", "POST", { provider: "openai" }), {}))).toEqual([
      400,
      { error: expect.stringContaining("No API key for ChatGPT") },
    ]);
    const ask = { messages: [{ role: "user", content: "Hi" }] };
    expect((await coach(json("/api/coach", "POST", ask), {})).status).toBe(400);
    expect((await coach(json("/api/coach", "POST", { messages: [{ role: "assistant", content: "Hi" }] }), {})).status).toBe(400);
    await putSettings(json("/api/settings", "PUT", { provider: "claude-code" }), {});
    expect(await read(await coach(json("/api/coach", "POST", ask), {}))).toEqual([400, { error: expect.stringContaining("runs in Claude Code") }]);
  });

  it("asks for a review only of a dive that exists", async () => {
    expect(await read(await review(json("/api/coach/review", "POST", { diveId: "nope" }), {}))).toEqual([404, { error: expect.stringContaining("No dive") }]);
    await importSamples(json("/api/import/samples", "POST", {}), {});
    expect((await review(json("/api/coach/review", "POST", { diveId: "1" }), {})).status).toBe(400); // no key yet
  });
});
