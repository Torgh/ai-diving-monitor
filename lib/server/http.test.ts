import { describe, expect, it } from "vitest";
import { z } from "zod";
import { UddfParseError } from "../uddf";
import { DiveNotFoundError } from "./diveStore";
import { LockTimeoutError } from "./files";
import { assertLocal, assertSameOrigin, handle, HttpError, readBody } from "./http";

const req = (url: string, headers: Record<string, string> = {}, init: RequestInit = {}) =>
  new Request(url, { ...init, headers: { host: new URL(url).host, ...headers } });
const status = (fn: () => void) => {
  try {
    fn();
    return 200;
  } catch (err) {
    return (err as HttpError).status;
  }
};

describe("assertLocal", () => {
  it.each(["http://localhost:3001/api/dives", "http://127.0.0.1:3001/api/dives", "http://[::1]:3001/api/dives"])("allows %s", (url) => {
    expect(status(() => assertLocal(req(url)))).toBe(200);
    expect(status(() => assertLocal(req(url, { origin: "http://localhost:3001" })))).toBe(200);
  });

  it("refuses other hosts, DNS rebinding and cross-site pages", () => {
    expect(status(() => assertLocal(req("http://evil.example/api/dives")))).toBe(403);
    expect(status(() => assertLocal(req("http://localhost:3001/api/dives", { host: "evil.example" })))).toBe(403);
    expect(status(() => assertLocal(req("http://localhost:3001/api/dives", { origin: "https://evil.example" })))).toBe(403);
    expect(status(() => assertLocal(req("http://localhost:3001/api/dives", { origin: "null" })))).toBe(403);
  });

  it("requires an Origin for uploads", () => {
    expect(status(() => assertSameOrigin(req("http://localhost:3001/api/import")))).toBe(403);
    expect(status(() => assertSameOrigin(req("http://localhost:3001/api/import", { origin: "http://localhost:3001" })))).toBe(200);
  });
});

describe("readBody", () => {
  const schema = z.object({ site: z.string() });
  const post = (body: string, type = "application/json") =>
    req("http://localhost:3001/x", { "content-type": type }, { method: "POST", body });

  it("parses JSON that matches the schema", async () => {
    await expect(readBody(post('{"site":"Koparki"}'), schema)).resolves.toEqual({ site: "Koparki" });
  });

  it("refuses form posts, broken JSON and wrong fields", async () => {
    await expect(readBody(post("site=x", "application/x-www-form-urlencoded"), schema)).rejects.toMatchObject({ status: 415 });
    await expect(readBody(post("{"), schema)).rejects.toMatchObject({ status: 400 });
    await expect(readBody(post('{"site":1}'), schema)).rejects.toMatchObject({ status: 400 });
  });
});

describe("handle", () => {
  const run = async (err: Error) => {
    const res = await handle(async () => {
      throw err;
    })(req("http://localhost:3001/x"), {});
    return [res.status, (await res.json()).error];
  };

  it("turns errors into JSON answers with a status, hiding unexpected details", async () => {
    expect(await run(new HttpError(418, "teapot"))).toEqual([418, "teapot"]);
    expect(await run(new DiveNotFoundError("gone"))).toEqual([404, "gone"]);
    expect(await run(new UddfParseError("bad"))).toEqual([422, "bad"]);
    expect(await run(new LockTimeoutError("busy"))).toEqual([503, "busy"]);
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(await run(new Error("secret detail"))).toEqual([500, "Unexpected server error."]);
    } finally {
      console.error = quiet;
    }
  });

  it("passes results and responses through", async () => {
    const res = await handle(async () => ({ ok: true }))(req("http://localhost:3001/x"), {});
    expect(await res.json()).toEqual({ ok: true });
    const raw = await handle(async () => new Response("hi"))(req("http://localhost:3001/x"), {});
    expect(await raw.text()).toBe("hi");
  });
});
