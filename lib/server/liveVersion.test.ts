import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Backend, FolderBackend, type StoredFile } from "./backends";
import { LiveVersion } from "./liveVersion";

let home: string;
let stops: (() => void)[] = [];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-live-"));
});

afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  fs.rmSync(home, { recursive: true, force: true });
});

/** Subscribes and collects the versions it is told. */
function listen(live: LiveVersion) {
  const seen: string[] = [];
  stops.push(live.subscribe((v) => seen.push(v)));
  return seen;
}

const writeDive = (name: string, text: string) => {
  fs.mkdirSync(path.join(home, "dives"), { recursive: true });
  fs.writeFileSync(path.join(home, "dives", name), text);
};

/** A backend that can't be watched, like Google Drive, with files the test changes. */
function driveLike(files: StoredFile[], fail = { now: false }): Backend {
  return {
    kind: "google",
    location: "My Drive › DiveDeck",
    list: async (area) => {
      if (fail.now) throw new Error("offline");
      return area === "dives" ? files : [];
    },
    read: async () => undefined,
    write: async () => {},
    remove: async () => {},
  };
}

describe("LiveVersion", () => {
  it("tells the version at once and again as soon as a file in the watched folder changes", async () => {
    writeDive("a.dive.json", "{}");
    const live = new LiveVersion({ backend: () => new FolderBackend("local", home), folderMs: 60_000, debounceMs: 10 });
    const seen = listen(live);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    writeDive("b.dive.json", "{}");
    await vi.waitFor(() => expect(seen).toHaveLength(2), { timeout: 5000 });
    expect(seen[1]).not.toBe(seen[0]);
  });

  it("checks Google Drive on a timer and stays quiet while nothing changes or Drive is unreachable", async () => {
    const files: StoredFile[] = [{ name: "a.dive.json", version: "1" }];
    const fail = { now: false };
    const live = new LiveVersion({ backend: () => driveLike(files, fail), driveMs: 10 });
    const seen = listen(live);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    fail.now = true;
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toHaveLength(1);
    fail.now = false;
    files.push({ name: "b.dive.json", version: "1" });
    await vi.waitFor(() => expect(seen).toHaveLength(2));
  });

  it("starts watching once the folder exists", async () => {
    const live = new LiveVersion({ backend: () => new FolderBackend("local", path.join(home, "later")), driveMs: 10, folderMs: 60_000, debounceMs: 10 });
    const seen = listen(live);
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    fs.mkdirSync(path.join(home, "later", "dives"), { recursive: true });
    await new Promise((r) => setTimeout(r, 50)); // the timer finds the folder and watches it
    fs.writeFileSync(path.join(home, "later", "dives", "a.dive.json"), "{}");
    await vi.waitFor(() => expect(seen).toHaveLength(2), { timeout: 5000 });
  });

  it("checks once more after a check that a change interrupted, and stops with the last listener", async () => {
    const files: StoredFile[] = [];
    const backend = vi.fn(() => driveLike(files));
    const live = new LiveVersion({ backend, driveMs: 60_000 });
    const seen: string[] = [];
    const stop = live.subscribe((v) => seen.push(v));
    files.push({ name: "a.dive.json", version: "1" });
    await live.check(); // asked during the first check: runs again after it
    expect(backend).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(1);
    stop();
    files.push({ name: "b.dive.json", version: "1" });
    await live.check();
    expect(seen).toHaveLength(1);
  });
});
