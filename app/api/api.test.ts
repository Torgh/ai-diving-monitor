import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getDive, PATCH as patchDive } from "./dives/[id]/route";
import { GET as getDives } from "./dives/route";
import { POST as importFiles } from "./import/route";
import { POST as importSamples } from "./import/samples/route";
import { GET as migrateStatus, POST as migrate } from "./migrate/route";
import { POST as linkDive } from "./trips/[id]/dives/route";
import { DELETE as deleteTrip, GET as getTrip } from "./trips/[id]/route";
import { GET as getTrips } from "./trips/route";
import { GET as getVersion } from "./version/route";
import { TripStore } from "../../lib/server/tripStore";
import { restoreEnv } from "../../test-env";

/** The route handlers, called as Next.js calls them, against a temporary data folder. */

const ROOT = path.resolve(__dirname, "..", "..");
const URL_BASE = "http://localhost:3001";
const saved = { ...process.env };
let home: string;

const req = (p: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request(URL_BASE + p, { ...init, headers: { host: "localhost:3001", ...init.headers } });
const json = (p: string, method: string, body: unknown) =>
  req(p, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", origin: URL_BASE } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const read = async (res: Response) => [res.status, await res.json()] as const;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-api-"));
  process.env.AI_DIVING_MONITOR_HOME = home;
  process.env.AI_DIVING_MONITOR_DB = path.join(home, "no-such.db");
});

afterEach(() => {
  restoreEnv(saved);
  fs.rmSync(home, { recursive: true, force: true });
});

function upload(files: { name: string; data: Uint8Array | string }[], origin: string | null = URL_BASE) {
  const form = new FormData();
  for (const f of files) form.append("files", new File([f.data as BlobPart], f.name));
  return req("/api/import", { method: "POST", body: form, headers: origin ? { origin } : {} });
}

describe("API", () => {
  it("starts with an empty log and loads the sample dives once", async () => {
    const [, empty] = await read(await getDives(req("/api/dives"), {}));
    expect(empty).toMatchObject({ dataFolder: home, dives: [] });
    expect(await read(await importSamples(json("/api/import/samples", "POST", {}), {}))).toEqual([200, { added: 9 }]);
    expect(await read(await importSamples(json("/api/import/samples", "POST", {}), {}))).toEqual([200, { added: 0 }]);
    const [, log] = await read(await getDives(req("/api/dives"), {}));
    expect(log.dives).toHaveLength(9);
    expect(log.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("imports uploaded files, reporting unreadable ones", async () => {
    const sw = fs.readFileSync(path.join(ROOT, "fixtures", "uddf", "shearwater-style.uddf"));
    const [status, body] = await read(await importFiles(upload([{ name: "sw.uddf", data: new Uint8Array(sw) }, { name: "x.uddf", data: "<html/>" }]), {}));
    expect(status).toBe(200);
    expect(body.results).toEqual([
      { file: "sw.uddf", added: 1, duplicates: 0 },
      { file: "x.uddf", error: expect.stringContaining("expected <uddf>") },
    ]);
  });

  it("refuses uploads from other sites and empty uploads", async () => {
    expect((await importFiles(upload([{ name: "a.uddf", data: "x" }], null), {})).status).toBe(403);
    expect((await importFiles(upload([{ name: "a.uddf", data: "x" }], "https://evil.example"), {})).status).toBe(403);
    expect((await importFiles(upload([]), {})).status).toBe(400);
  });

  it("shows a dive and saves its details, which changes the log's version", async () => {
    await importSamples(json("/api/import/samples", "POST", {}), {});
    const [, log] = await read(await getDives(req("/api/dives"), {}));
    const id = log.dives[0].id;
    const [, dive] = await read(await getDive(req(`/api/dives/${id}`), ctx(id)));
    expect(dive).toMatchObject({ id, seq: 1, total: 9, dive: { site: "Koparki" } });

    const [, before] = await read(await getVersion(req("/api/version"), {}));
    const [status, saved] = await read(await patchDive(json(`/api/dives/${id}`, "PATCH", { buddy: "Ola", gas: "EAN32", tankVolumeL: 15 }), ctx(id)));
    expect(status).toBe(200);
    expect(saved.details).toEqual({ buddy: "Ola", gas: { o2: 0.32, he: 0 }, tankVolumeL: 15 });
    const [, after] = await read(await getVersion(req("/api/version"), {}));
    expect(after.version).not.toBe(before.version);

    expect((await patchDive(json(`/api/dives/${id}`, "PATCH", { gas: "banana" }), ctx(id))).status).toBe(400);
    expect((await patchDive(json(`/api/dives/${id}`, "PATCH", { tankVolumeL: -1 }), ctx(id))).status).toBe(400);
    expect((await getDive(req("/api/dives/nope"), ctx("nope"))).status).toBe(404);
    expect((await patchDive(json("/api/dives/nope", "PATCH", { buddy: "x" }), ctx("nope"))).status).toBe(404);
  });

  it("says when there is no Python database to migrate", async () => {
    const [, status] = await read(await migrateStatus(req("/api/migrate"), {}));
    expect(status).toEqual({ database: path.join(home, "no-such.db"), available: false });
    expect((await migrate(json("/api/migrate", "POST", {}), {})).status).toBe(404);
  });

  it("shows the saved trips, links logged dives to their cards and forgets a trip", async () => {
    expect(await read(await getTrips(req("/api/trips"), {}))).toEqual([200, expect.objectContaining({ trips: [], next: null })]);
    await importSamples(json("/api/import/samples", "POST", {}), {});
    const [, log] = await read(await getDives(req("/api/dives"), {}));
    const dive = log.dives[5]; // 2026-07-11 in Dahab
    const date = dive.start.slice(0, 10);
    await new TripStore().save({
      id: "dahab",
      name: "Dahab",
      dives: [
        { itemId: "c1", title: "Canyon", date, maxDepthM: 30, gas: "EAN32", prepMarkdown: "## Ready" },
        { itemId: "c2", title: "Blue Hole", date },
      ],
    });

    const [, list] = await read(await getTrips(req("/api/trips"), {}));
    expect(list.trips).toEqual([expect.objectContaining({ id: "dahab", when: "past", cards: 2, prepared: 1 })]);
    const [status, trip] = await read(await getTrip(req("/api/trips/dahab"), ctx("dahab")));
    expect(status).toBe(200);
    expect(trip.version).toBe(list.version);
    expect(trip.dives[0]).toMatchObject({ itemId: "c1", prep: { markdown: "## Ready" }, facts: { experience: { dives: 5 } } });
    expect(trip.dives[0].loggedThatDay.map((d: { id: string }) => d.id)).toEqual([dive.id]);

    const link = (body: unknown) => linkDive(json("/api/trips/dahab/dives", "POST", body), ctx("dahab"));
    expect(await read(await link({ itemId: "c1", diveId: dive.id, linked: true }))).toEqual([200, { loggedDiveIds: [dive.id] }]);
    // A dive belongs to one card: linking it to another card moves it.
    expect(await read(await link({ itemId: "c2", diveId: dive.id, linked: true }))).toEqual([200, { loggedDiveIds: [dive.id] }]);
    const [, moved] = await read(await getTrip(req("/api/trips/dahab"), ctx("dahab")));
    expect(moved.dives.map((d: { logged: unknown[] }) => d.logged.length)).toEqual([0, 1]);
    expect(await read(await link({ itemId: "c2", diveId: dive.id, linked: false }))).toEqual([200, { loggedDiveIds: [] }]);
    expect((await link({ itemId: "c9", diveId: dive.id, linked: true })).status).toBe(404);
    expect((await link({ itemId: "c1", diveId: "nope", linked: true })).status).toBe(404);
    expect((await linkDive(json("/api/trips/x/dives", "POST", { itemId: "c1", diveId: dive.id, linked: true }), ctx("x"))).status).toBe(404);

    expect((await getTrip(req("/api/trips/nope"), ctx("nope"))).status).toBe(404);
    expect((await deleteTrip(req("/api/trips/dahab", { method: "DELETE" }), ctx("dahab"))).status).toBe(415);
    expect(await read(await deleteTrip(json("/api/trips/dahab", "DELETE", {}), ctx("dahab")))).toEqual([200, { deleted: true }]);
    expect((await deleteTrip(json("/api/trips/dahab", "DELETE", {}), ctx("dahab"))).status).toBe(404);
  });

  it("only answers requests addressed to localhost", async () => {
    const foreign = new Request(`${URL_BASE}/api/dives`, { headers: { host: "evil.example" } });
    expect((await getDives(foreign, {})).status).toBe(403);
  });
});
