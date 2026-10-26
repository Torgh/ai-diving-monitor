// DiveDeck's service worker. The pages and data you open are kept, so they stay readable when your
// log can't be reached: DiveDeck isn't running, or the server has no connection to Google Drive.
// Everything is asked from the server first; the kept copy only answers when the server doesn't, or
// answers with an error.

const CACHE = "divedeck-v1";
/** Kept copies beyond this are dropped, oldest first. */
const MAX_ENTRIES = 400;
/** The live stream, signing in, the companion and model lists are never kept. */
const SKIP = ["/api/events", "/api/auth/", "/api/coach", "/api/settings/models", "/sw.js"];
/** When the copy was kept: tells the page it is showing a kept copy, and from when. */
const SAVED_HEADER = "x-divedeck-saved";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (SKIP.some((p) => url.pathname.startsWith(p))) return;
  // A client-side navigation: when it fails, Next.js loads the page in full, and that one is kept.
  if (req.headers.get("RSC")) return;
  event.respondWith(answer(event, req));
});

async function answer(event, req) {
  const cache = await caches.open(CACHE);
  let res;
  try {
    res = await fetch(req);
  } catch (err) {
    const kept = await cache.match(req, { ignoreVary: true });
    if (kept) return kept;
    if (req.mode === "navigate") return notKept();
    throw err;
  }
  if (res.status >= 500) return (await cache.match(req, { ignoreVary: true })) ?? res;
  if (res.ok) event.waitUntil(keep(cache, req, res.clone()));
  return res;
}

async function keep(cache, req, res) {
  const headers = new Headers(res.headers);
  headers.set(SAVED_HEADER, new Date().toISOString());
  await cache.put(req, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers }));
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(old);
}

/** A page that was never opened while the log could be reached. */
function notKept() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DiveDeck</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#0f172a;background:#f8fafc}a{color:#0e7490}@media (prefers-color-scheme:dark){body{color:#e2e8f0;background:#0b1220}a{color:#22d3ee}}</style></head>
<body><h1>Can't reach your log</h1><p>DiveDeck isn't running, or it has no connection to where your log is kept. This page wasn't opened before, so there is no copy of it here.</p><p><a href="/">Open the dashboard</a> to see what was kept.</p></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
