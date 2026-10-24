import { NextResponse } from "next/server";
import { z } from "zod";
import { DiveRefError } from "../coach";
import { UddfParseError } from "../uddf";
import { DiveNotFoundError } from "./diveStore";
import { LockTimeoutError } from "./files";

/** An error with an HTTP status, turned into a `{ error }` answer by handle(). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The dive log lives on this computer: only answer requests addressed to localhost (defeats DNS
 * rebinding) and, when the browser says where a request comes from, coming from this app's own pages.
 */
export function assertLocal(req: Request) {
  const host = new URL(req.url).hostname;
  const hostHeader = req.headers.get("host")?.replace(/:\d+$/, "") ?? "";
  if (!LOCAL_HOSTS.has(host) || !LOCAL_HOSTS.has(hostHeader)) {
    throw new HttpError(403, "This endpoint is only available on localhost.");
  }
  const origin = req.headers.get("origin");
  // "null" is the Origin of sandboxed frames and local files, which are not this app's pages.
  if (origin !== null && (origin === "null" || !LOCAL_HOSTS.has(new URL(origin).hostname))) {
    throw new HttpError(403, "Cross-site request blocked.");
  }
}

/**
 * Parses and validates a JSON body. Requiring the JSON content type also blocks cross-site form posts
 * (they can't set it without a CORS preflight).
 */
export async function readBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json.");
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, `Invalid request: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/**
 * A request that changes the log. Uploads are multipart forms, which any page could post; a form
 * post from another site carries its Origin, so a missing or foreign Origin is refused.
 */
export function assertSameOrigin(req: Request) {
  assertLocal(req);
  if (!req.headers.get("origin")) throw new HttpError(403, "Cross-site request blocked.");
}

function statusOf(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (err instanceof DiveNotFoundError || err instanceof DiveRefError) return 404;
  if (err instanceof UddfParseError) return 422;
  if (err instanceof LockTimeoutError) return 503;
  return 500;
}

/** Wraps a route handler so thrown errors become `{ error }` JSON answers. */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<unknown>) {
  return async (req: Request, ctx: C) => {
    try {
      const result = await fn(req, ctx);
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      const status = statusOf(err);
      if (status === 500) console.error(err);
      const message = status === 500 ? "Unexpected server error." : (err as Error).message;
      return NextResponse.json({ error: message }, { status });
    }
  };
}
