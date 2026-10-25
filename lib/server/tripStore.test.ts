import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TripPlanInput } from "../trip";
import { FolderBackend } from "./backends";
import { updateSettings } from "./config";
import { switchStorage } from "./storage";
import { copyTrips, TripStore } from "./tripStore";
import { logVersion } from "./version";
import { isolateEnv, restoreEnv } from "../../test-env";

const saved = { ...process.env };
let home: string;

const trip = (over: Partial<TripPlanInput> = {}): TripPlanInput => ({
  id: "dahab",
  name: "Dahab",
  startDate: "2027-03-01",
  dives: [{ itemId: "c1", title: "Blue Hole", date: "2027-03-02", prepMarkdown: "## Ready" }],
  ...over,
});

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-trips-"));
  for (const name of Object.keys(process.env)) if (/^ONEDRIVE/i.test(name)) delete process.env[name];
  isolateEnv(home);
});

afterEach(() => {
  restoreEnv(saved);
  fs.rmSync(home, { recursive: true, force: true });
});

describe("TripStore", () => {
  it("saves one file per trip, renamed with the trip, and lists the next trip first", async () => {
    const store = new TripStore();
    expect(await store.list()).toEqual([]);
    await store.save(trip());
    await store.save(trip({ id: "malta", name: "Malta", startDate: "2026-11-01", dives: [] }));
    await store.save(trip({ id: "later", name: "Someday", startDate: undefined, dives: [] }));
    expect((await store.list()).map((p) => p.id)).toEqual(["malta", "dahab", "later"]);

    await store.save(trip({ name: "Dahab 2027", dives: [{ itemId: "c1", title: "Blue Hole" }] }));
    expect(fs.readdirSync(path.join(home, "trips")).sort()).toEqual(["(later).trip.json".replace("(", "Someday ("), "Dahab 2027 (dahab).trip.json", "Malta (malta).trip.json"].sort());
    const dahab = await store.get("dahab");
    expect(dahab?.dives[0].prep?.markdown).toBe("## Ready");
    expect(await store.get("nope")).toBeUndefined();
  });

  it("reads the newer of two copies and skips files that aren't trips", async () => {
    const store = new TripStore();
    const plan = await store.save(trip());
    const dir = path.join(home, "trips");
    fs.writeFileSync(path.join(dir, "Dahab (dahab) conflict.trip.json"), JSON.stringify({ ...plan, name: "Old", updatedAt: "2000-01-01T00:00:00.000Z" }));
    fs.writeFileSync(path.join(dir, "broken.trip.json"), "{");
    fs.writeFileSync(path.join(dir, "other.trip.json"), JSON.stringify({ format: "something-else" }));
    expect((await store.list()).map((p) => p.name)).toEqual(["Dahab"]);
    // The next save removes the conflict copy.
    await store.update("dahab", (p) => (p.dives[0].loggedDiveIds = ["d1"]));
    expect(fs.readdirSync(dir).sort()).toEqual(["Dahab (dahab).trip.json", "broken.trip.json", "other.trip.json"]);
    expect((await store.get("dahab"))?.dives[0].loggedDiveIds).toEqual(["d1"]);
  });

  it("changes and deletes only saved trips with valid ids", async () => {
    const store = new TripStore();
    await expect(store.update("nope", () => {})).rejects.toThrow("No saved trip with id nope");
    await expect(store.save(trip({ id: "../x" }))).rejects.toThrow("Invalid trip id");
    expect(fs.existsSync(path.join(home, "x.lock"))).toBe(false);
    await store.save(trip());
    expect(await store.delete("dahab")).toBe(true);
    expect(await store.delete("dahab")).toBe(false);
    expect(await store.list()).toEqual([]);
  });
});

describe("trips in another place", () => {
  it("are copied when the storage changes, the newer copy winning", async () => {
    const local = new TripStore();
    await local.save(trip());
    const oneDrive = path.join(home, "OneDrive");
    fs.mkdirSync(oneDrive);
    process.env.OneDrive = oneDrive;
    await switchStorage("onedrive");
    const there = new TripStore();
    expect(there.backend.kind).toBe("onedrive");
    expect((await there.get("dahab"))?.dives[0].prep?.markdown).toBe("## Ready");

    await there.save(trip({ dives: [{ itemId: "c1", title: "Blue Hole", prepMarkdown: "## Newer" }] }));
    expect(await copyTrips(there, local)).toEqual({ trips: 1 });
    expect(await copyTrips(there, local)).toEqual({ trips: 0 });
    expect((await local.get("dahab"))?.dives[0].prep?.markdown).toBe("## Newer");
    await updateSettings({ storage: "local" });
  });

  it("change the tag the browser polls", async () => {
    const backend = new FolderBackend("local", home);
    const before = await logVersion(backend);
    await new TripStore(backend).save(trip());
    expect(await logVersion(backend)).not.toBe(before);
  });
});
