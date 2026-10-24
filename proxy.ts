import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Host header without the port: "localhost:3001" → "localhost", "[::1]:3001" → "[::1]". */
export function hostName(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

/**
 * A personal, local app: the server binds to 127.0.0.1, and every request must also be addressed to
 * this computer by name. A web page that points its own domain at 127.0.0.1 (DNS rebinding) sends
 * its domain as the Host, so it can't read or change the dive log.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (LOCAL_HOSTS.has(hostName(host).toLowerCase())) return NextResponse.next();
  return new NextResponse("AI Diving Monitor only answers requests to localhost.", { status: 403 });
}
