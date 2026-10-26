import { assertLocal, handle } from "@/lib/server/http";
import { liveVersion } from "@/lib/server/liveVersion";
import { logVersion } from "@/lib/server/version";

/** A comment now and then keeps the connection from being closed as idle. */
const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events for the open pages: `version` with the log's version when they connect and
 * whenever a dive, trip or the kit changes (also by the MCP server), so they reload right away.
 */
export const GET = handle(async (req) => {
  assertLocal(req);
  const encoder = new TextEncoder();
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (text: string) => {
        if (open) controller.enqueue(encoder.encode(text));
      };
      const version = (v: string) => send(`event: version\ndata: ${v}\n\n`);
      const unsubscribe = liveVersion.subscribe(version);
      const heartbeat = setInterval(() => send(": still here\n\n"), HEARTBEAT_MS);
      close = () => {
        if (!open) return;
        open = false;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already cancelled by the browser going away.
        }
      };
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) return close();
      send("retry: 2000\n\n");
      const now = await logVersion().catch(() => null);
      if (now) version(now);
    },
    cancel() {
      close();
    },
  });
  // no-transform: the response isn't compressed, which would hold the events back.
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
});
