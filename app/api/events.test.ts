import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as events } from "./events/route";
import { GET as getVersion } from "./version/route";
import { isolateEnv, restoreEnv } from "../../test-env";

const URL_BASE = "http://localhost:3001";
const saved = { ...process.env };
let home: string;

const req = (p: string, signal?: AbortSignal, host = "localhost:3001") => new Request(URL_BASE + p, { headers: { host }, signal });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-events-"));
  isolateEnv(home);
});

afterEach(() => {
  restoreEnv(saved);
  fs.rmSync(home, { recursive: true, force: true });
});

/** Reads server-sent events one `version` at a time, keeping what came before it. */
function eventReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  return {
    reader,
    text: () => text,
    async nextVersion(): Promise<string | null> {
      for (;;) {
        const match = /event: version\ndata: (\S+)\n\n/.exec(buffer);
        if (match) {
          buffer = buffer.slice(match.index + match[0].length);
          return match[1];
        }
        const { value, done } = await reader.read();
        if (done) return null;
        const chunk = decoder.decode(value);
        buffer += chunk;
        text += chunk;
      }
    },
  };
}

describe("/api/events", () => {
  it("streams the log's version, then the new one when a dive file changes, and ends when the page goes away", async () => {
    const abort = new AbortController();
    const res = await events(req("/api/events", abort.signal), {});
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-transform");
    const { version } = await (await getVersion(req("/api/version"), {})).json();

    const stream = eventReader(res);
    expect(await stream.nextVersion()).toBe(version);
    expect(stream.text()).toContain("retry: 2000");

    fs.mkdirSync(path.join(home, "dives"), { recursive: true });
    // On Linux a recursive watch reaches a new subfolder a moment later: write until the change comes.
    let text = "{}";
    const writing = setInterval(() => fs.writeFileSync(path.join(home, "dives", "a.dive.json"), (text += " ")), 100);
    let next = await stream.nextVersion();
    while (next === version) next = await stream.nextVersion(); // the server's own first check may repeat it
    clearInterval(writing);
    expect(next).toMatch(/^[0-9a-f]{16}$/);

    abort.abort();
    expect((await stream.reader.read()).done).toBe(true);
  });

  it("closes at once when the request is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const res = await events(req("/api/events", abort.signal), {});
    expect(await eventReader(res).nextVersion()).toBeNull();
  });

  it("only answers on localhost", async () => {
    const res = await events(req("/api/events", undefined, "evil.example"), {});
    expect(res.status).toBe(403);
  });
});
