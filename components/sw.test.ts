import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** public/sw.js run against a fake service worker scope: its own cache, and a network the test controls. */

const SOURCE = fs.readFileSync(path.resolve(__dirname, "..", "public", "sw.js"), "utf8");
const ORIGIN = "http://localhost:3001";

type Handler = (event: unknown) => void;
let handlers: Record<string, Handler>;
let store: Map<string, Response>;
let network: (req: Request) => Promise<Response>;
let deleted: string[];

function load() {
  handlers = {};
  store = new Map();
  deleted = [];
  const cache = {
    match: async (req: Request) => store.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => void store.set(req.url, res),
    keys: async () => [...store.keys()].map((url) => new Request(url)),
    delete: async (req: Request) => store.delete(req.url),
  };
  const scope = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => {}) },
  };
  const caches = {
    open: async () => cache,
    keys: async () => ["divedeck-v0", "divedeck-v1"],
    delete: async (key: string) => void deleted.push(key),
  };
  new Function("self", "caches", "fetch", SOURCE)(scope, caches, (req: Request) => network(req));
  return scope;
}

/** Dispatches a fetch; resolves with the service worker's answer, or undefined when it lets it through. */
async function fetchVia(url: string, init: RequestInit & { navigate?: boolean } = {}) {
  let answer: Promise<Response> | undefined;
  const waits: Promise<unknown>[] = [];
  const request = new Request(ORIGIN + url, init);
  // Only a browser makes navigation requests; the constructor refuses the mode.
  if (init.navigate) Object.defineProperty(request, "mode", { value: "navigate" });
  handlers.fetch({ request, respondWith: (p: Promise<Response>) => (answer = p), waitUntil: (p: Promise<unknown>) => waits.push(p) });
  const res = await answer;
  await Promise.all(waits);
  return res;
}

const ok = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  network = async () => ok("fresh");
});

describe("service worker", () => {
  it("takes over at once and drops the caches of earlier versions", async () => {
    const scope = load();
    handlers.install({});
    expect(scope.skipWaiting).toHaveBeenCalled();
    let done: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(deleted).toEqual(["divedeck-v0"]);
    expect(scope.clients.claim).toHaveBeenCalled();
  });

  it("lets the live stream, signing in, the companion, writes, other sites and client-side navigations through", async () => {
    load();
    expect(await fetchVia("/api/events")).toBeUndefined();
    expect(await fetchVia("/api/auth/google/start")).toBeUndefined();
    expect(await fetchVia("/api/coach")).toBeUndefined();
    expect(await fetchVia("/api/kit", { method: "PUT", body: "{}" })).toBeUndefined();
    expect(await fetchVia("/dives", { headers: { RSC: "1" } })).toBeUndefined();
    handlers.fetch({ request: new Request("https://example.com/x"), respondWith: () => expect.unreachable() });
  });

  it("answers from the server and keeps a copy, marked with when it was kept", async () => {
    load();
    const res = await fetchVia("/api/dives");
    expect(await res!.text()).toBe("fresh");
    expect(res!.headers.get("x-divedeck-saved")).toBeNull();
    expect(store.get(`${ORIGIN}/api/dives`)!.headers.get("x-divedeck-saved")).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("answers with the kept copy when the server fails or can't be reached, and with the error when there is none", async () => {
    load();
    await fetchVia("/api/dives");
    network = async () => new Response('{"error":"Drive"}', { status: 500 });
    const failed = await fetchVia("/api/dives");
    expect(await failed!.text()).toBe("fresh");
    expect(failed!.headers.get("x-divedeck-saved")).not.toBeNull();
    expect((await fetchVia("/api/trips"))!.status).toBe(500);

    network = async () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await (await fetchVia("/api/dives"))!.text()).toBe("fresh");
    await expect(fetchVia("/api/kit")).rejects.toThrow("Failed to fetch");
  });

  it("doesn't keep answers that aren't fine, and shows a page saying so for a page never opened", async () => {
    load();
    network = async () => new Response("missing", { status: 404 });
    expect((await fetchVia("/api/dives/x"))!.status).toBe(404);
    expect(store.size).toBe(0);
    network = async () => Promise.reject(new TypeError("Failed to fetch"));
    const page = await fetchVia("/dives/abc", { navigate: true });
    expect(page!.status).toBe(503);
    expect(await page!.text()).toContain("Can't reach your log");
  });

  it("keeps at most 400 copies, dropping the oldest", async () => {
    load();
    for (let i = 0; i < 401; i++) store.set(`${ORIGIN}/old/${i}`, ok("old"));
    await fetchVia("/api/dives");
    expect(store.size).toBe(400);
    expect(store.has(`${ORIGIN}/old/0`)).toBe(false);
    expect(store.has(`${ORIGIN}/old/1`)).toBe(false);
    expect(store.has(`${ORIGIN}/api/dives`)).toBe(true);
  });
});
