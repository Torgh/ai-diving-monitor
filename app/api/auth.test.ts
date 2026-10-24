import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeApiError } from "@/lib/server/coachAgent";
import { readSettings, updateSettings } from "@/lib/server/config";
import { DiveStore } from "@/lib/server/diveStore";
import { GET as callback } from "./auth/google/callback/route";
import { POST as disconnect } from "./auth/google/disconnect/route";
import { GET as start } from "./auth/google/start/route";
import { POST as installCommand } from "./settings/review-command/route";
import { restoreEnv } from "../../test-env";

/** The Google sign-in routes and the /dive-review install, against a temporary data folder and home. */

const ROOT = path.resolve(__dirname, "..", "..");
const BASE = "http://localhost:3001";
const saved = { ...process.env };
let home: string;

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-auth-"));
  for (const name of Object.keys(process.env)) if (/^(AI_DIVING_MONITOR_|GOOGLE_CLIENT_)/i.test(name)) delete process.env[name];
  process.env.AI_DIVING_MONITOR_HOME = home;
  process.env.AI_DIVING_MONITOR_DB = path.join(home, "no-such.db");
  // os.homedir() reads these, so the slash command lands in the temporary folder.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  await updateSettings({ googleClientId: "id-1", googleClientSecret: "secret-1" });
});

afterEach(() => {
  restoreEnv(saved);
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

const get = (url: string, cookies: Record<string, string> = {}) =>
  new NextRequest(url, { headers: { host: "localhost:3001", cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } });
const post = (url: string) =>
  new Request(url, { method: "POST", body: "{}", headers: { host: "localhost:3001", "content-type": "application/json", origin: BASE } });
const backTo = (res: Response) => Object.fromEntries(new URL(res.headers.get("location")!).searchParams);

describe("Google sign-in routes", () => {
  it("starts with a state and a PKCE verifier in short-lived cookies", async () => {
    const res = await start(get(`${BASE}/api/auth/google/start`), {});
    expect(res.status).toBe(307);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/google/callback`);
    const cookies = res.headers.getSetCookie().join("\n");
    expect(cookies).toMatch(/adm_oauth_state=.+HttpOnly/i);
    expect(cookies).toMatch(/adm_oauth_verifier=/);
  });

  it("sends the diver back to Settings when Google refuses or the state doesn't match", async () => {
    expect(backTo(await callback(get(`${BASE}/api/auth/google/callback?error=access_denied`)))).toMatchObject({ google: "error", message: "Access was not granted." });
    const forged = await callback(get(`${BASE}/api/auth/google/callback?code=c&state=other`, { adm_oauth_state: "s1", adm_oauth_verifier: "v" }));
    expect(backTo(forged).message).toMatch(/expired or was tampered/);
  });

  it("connects, moves the log to Drive, and disconnects back to this PC", async () => {
    await new DiveStore().importFile("sw.uddf", new Uint8Array(fs.readFileSync(path.join(ROOT, "fixtures", "uddf", "shearwater-style.uddf"))));
    const idToken = `x.${Buffer.from(JSON.stringify({ email: "diver@example.com" })).toString("base64url")}.y`;
    const drive = new Map<string, { name: string; parents: string[]; body: string }>();
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init: RequestInit = {}) => {
        const url = new URL(input);
        if (url.host === "oauth2.googleapis.com") {
          return Response.json({ access_token: "a", expires_in: 3600, refresh_token: "r", id_token: idToken, scope: "openid https://www.googleapis.com/auth/drive.file" });
        }
        if (url.pathname === "/drive/v3/files" && (init.method ?? "GET") === "GET") {
          const parent = (url.searchParams.get("q") ?? "").match(/'([^']+)' in parents/)?.[1];
          const name = (url.searchParams.get("q") ?? "").match(/name='([^']+)'/)?.[1];
          return Response.json({ files: [...drive].filter(([, f]) => f.parents.includes(parent!) && (!name || f.name === name)).map(([id, f]) => ({ id, name: f.name })) });
        }
        if (url.pathname === "/drive/v3/files") {
          const meta = JSON.parse(String(init.body));
          drive.set(`f${++n}`, { name: meta.name, parents: meta.parents ?? ["root"], body: "" });
          return Response.json({ id: `f${n}` });
        }
        if (url.pathname.startsWith("/upload/")) {
          const text = new TextDecoder().decode(init.body as Uint8Array);
          const meta = JSON.parse(text.split("\r\n\r\n")[1].split("\r\n")[0]);
          drive.set(`f${++n}`, { name: meta.name, parents: meta.parents, body: text });
          return Response.json({});
        }
        return Response.json({});
      }),
    );
    const res = await callback(get(`${BASE}/api/auth/google/callback?code=c&state=s1`, { adm_oauth_state: "s1", adm_oauth_verifier: "v" }));
    expect(backTo(res)).toEqual({ google: "connected", copied: "1" });
    expect(readSettings().storage).toBe("google");
    expect([...drive.values()].map((f) => f.name)).toEqual(expect.arrayContaining(["AI Diving Monitor", "dives", "originals"]));

    expect(await (await disconnect(post(`${BASE}/api/auth/google/disconnect`), {})).json()).toEqual({ ok: true, copied: 0 });
    expect(readSettings().storage).toBe("local");
    expect(fs.existsSync(path.join(home, "google-token.json"))).toBe(false);
  });
});

describe("other settings routes", () => {
  it("installs /dive-review into the diver's Claude Code commands", async () => {
    expect(await (await installCommand(post(`${BASE}/api/settings/review-command`), {})).json()).toEqual({ installed: true });
    expect(fs.existsSync(path.join(home, ".claude", "commands", "dive-review.md"))).toBe(true);
  });

  it("turns AI provider errors into messages a diver can act on", () => {
    const headers = new Headers();
    expect(describeApiError(new Anthropic.AuthenticationError(401, {}, "bad key", headers))?.status).toBe(401);
    expect(describeApiError(new OpenAI.RateLimitError(429, {}, "slow down", headers))?.status).toBe(429);
    expect(describeApiError(new Anthropic.NotFoundError(404, {}, "no model", headers))?.message).toMatch(/model wasn't found/);
    expect(describeApiError(new OpenAI.APIConnectionError({ message: "offline" }))?.status).toBe(502);
    expect(describeApiError(new Anthropic.InternalServerError(500, {}, "boom", headers))?.message).toMatch(/answered with an error/);
    expect(describeApiError(new Error("other"))).toBeNull();
  });
});
