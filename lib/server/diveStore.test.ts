import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprint } from "../dive";
import { analyzeRecord } from "../record";
import { PARSER_VERSION, parseUddf, UddfParseError } from "../uddf";
import { DiveNotFoundError, DiveStore } from "./diveStore";
import { LockTimeoutError, withLock } from "./files";
import { migrateFromPython } from "./migrate";
import { dataDir, divesDir, pythonDbPath } from "./paths";
import { restoreEnv } from "../../test-env";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (...p: string[]) => new Uint8Array(fs.readFileSync(path.join(ROOT, ...p)));
const SPRING = read("examples", "spring-2026.uddf");
const SHEARWATER = read("fixtures", "uddf", "shearwater-style.uddf");

let home: string;
let store: DiveStore;
const saved = { ...process.env };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-store-"));
  process.env.AI_DIVING_MONITOR_HOME = home;
  store = new DiveStore();
});

afterEach(() => {
  restoreEnv(saved);
  fs.rmSync(home, { recursive: true, force: true });
});

describe("DiveStore", () => {
  it("imports a file once, keeping the original and one file per dive", async () => {
    const first = await store.importFile("spring-2026.uddf", SPRING);
    expect(first.added).toHaveLength(5);
    const again = await store.importFile("spring-2026.uddf", SPRING);
    expect(again).toEqual({ fileName: "spring-2026.uddf", added: [], duplicates: first.added });

    const files = fs.readdirSync(divesDir());
    expect(files).toHaveLength(5);
    expect(files[0]).toMatch(/^2026-03-14 1005 Koparki \([0-9a-f]{24}\)\.dive\.json$/);
    expect(fs.readdirSync(path.join(home, "originals"))).toHaveLength(1);

    const dives = await store.list();
    expect(dives.map((d) => d.dive.start)).toEqual([...dives.map((d) => d.dive.start)].sort());
    expect(await store.get(first.added[0])).toMatchObject({ id: first.added[0], review: null, details: {} });
  });

  it("doesn't keep a copy of a file that brings no new dive", async () => {
    await store.importFile("spring.uddf", SPRING);
    const reexport = new TextEncoder().encode(new TextDecoder().decode(SPRING).replace("<uddf ", "<uddf data-export=\"2\" "));
    expect((await store.importFile("spring-again.uddf", reexport)).added).toEqual([]);
    expect(fs.readdirSync(path.join(home, "originals"))).toHaveLength(1);
  });

  it("refuses files that aren't UDDF, writing nothing", async () => {
    await expect(store.importFile("x.uddf", new TextEncoder().encode("<html/>"))).rejects.toThrow(UddfParseError);
    expect(fs.existsSync(divesDir())).toBe(false);
  });

  it("fills in details, renames the file when the site changes, and removes details again", async () => {
    const [id] = (await store.importFile("sw.uddf", SHEARWATER)).added;
    expect(analyzeRecord((await store.get(id))!).metrics.rmvLMin).toBeNull();

    const updated = await store.updateDetails(id, { site: " Zakrzówek ", tankVolumeL: 12, buddy: "Ola" });
    expect(updated.details).toEqual({ site: "Zakrzówek", tankVolumeL: 12, buddy: "Ola" });
    expect(analyzeRecord(updated).metrics.rmvLMin).toBeGreaterThan(0);
    expect(fs.readdirSync(divesDir())).toEqual([`2026-09-12 1015 Zakrzówek (${id}).dive.json`]);

    const cleared = await store.updateDetails(id, { site: "", buddy: null, tankVolumeL: undefined });
    expect(cleared.details).toEqual({ tankVolumeL: 12 });
    expect(fs.readdirSync(divesDir())).toEqual([`2026-09-12 1015 (${id}).dive.json`]);
  });

  it("saves reviews and reports unknown dives", async () => {
    const [id] = (await store.importFile("sw.uddf", SHEARWATER)).added;
    const record = await store.saveReview(id, "## Review");
    expect(record.review?.markdown).toBe("## Review");
    expect((await store.get(id))?.review?.markdown).toBe("## Review");
    await expect(store.saveReview("nope", "x")).rejects.toThrow(DiveNotFoundError);
    expect(await store.get("nope")).toBeUndefined();
  });

  it("parses dives again when a newer parser is installed, keeping details and the review", async () => {
    const [id] = (await store.importFile("sw.uddf", SHEARWATER)).added;
    await store.updateDetails(id, { site: "Koparki" });
    await store.saveReview(id, "kept");
    const file = path.join(divesDir(), fs.readdirSync(divesDir())[0]);
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...old, parserVersion: 1, dive: { ...old.dive, samples: [] } }));

    const [record] = await store.list();
    expect(record.parserVersion).toBe(PARSER_VERSION);
    expect(record.dive.samples.length).toBeGreaterThan(0);
    expect(record.details.site).toBe("Koparki");
    expect(record.review?.markdown).toBe("kept");
  });

  it("keeps an outdated dive as it is when its original file is gone", async () => {
    const [id] = (await store.importFile("sw.uddf", SHEARWATER)).added;
    const file = path.join(divesDir(), fs.readdirSync(divesDir())[0]);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), parserVersion: 1 }));
    fs.rmSync(path.join(home, "originals"), { recursive: true });
    expect((await store.get(id))?.parserVersion).toBe(1);
  });

  it("ignores files that aren't dive records", async () => {
    fs.mkdirSync(divesDir(), { recursive: true });
    fs.writeFileSync(path.join(divesDir(), "notes (abc).dive.json"), "{ not json");
    fs.writeFileSync(path.join(divesDir(), "other (def).dive.json"), JSON.stringify({ format: "something-else" }));
    expect(await store.list()).toEqual([]);
    expect(await store.get("def")).toBeUndefined();
  });
});

describe("withLock", () => {
  it("runs one holder at a time and recovers a lock left by a crashed process", async () => {
    const order: string[] = [];
    await Promise.all([
      withLock("x", async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 50));
        order.push("a-end");
      }),
      new Promise((r) => setTimeout(r, 10)).then(() => withLock("x", async () => void order.push("b"))),
    ]);
    expect(order).toEqual(["a-start", "a-end", "b"]);

    const stale = path.join(home, "locks", "y.lock");
    fs.writeFileSync(stale, "12345");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(stale, old, old);
    expect(await withLock("y", async () => "ran")).toBe("ran");
  });

  it("gives up when another process holds the lock too long", async () => {
    fs.mkdirSync(path.join(home, "locks"), { recursive: true });
    fs.writeFileSync(path.join(home, "locks", "z.lock"), "busy");
    const realNow = Date.now;
    let shift = 0;
    Date.now = () => realNow() + (shift += 5_000);
    try {
      await expect(withLock("z", async () => "never")).rejects.toThrow(LockTimeoutError);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("paths", () => {
  it("uses AI_DIVING_MONITOR_HOME, else the Python database's folder, else ~/.ai-diving-monitor", () => {
    expect(dataDir()).toBe(home);
    delete process.env.AI_DIVING_MONITOR_HOME;
    process.env.AI_DIVING_MONITOR_DB = path.join(home, "py", "dives.db");
    expect(dataDir()).toBe(path.join(home, "py"));
    expect(pythonDbPath()).toBe(path.join(home, "py", "dives.db"));
    delete process.env.AI_DIVING_MONITOR_DB;
    expect(dataDir()).toBe(path.join(os.homedir(), ".ai-diving-monitor"));
    expect(pythonDbPath()).toBe(path.join(os.homedir(), ".ai-diving-monitor", "dives.db"));
  });
});

/** A database with the Python version's schema (src/ai_diving_monitor/storage.py). */
function pythonDatabase(file: string, files: { name: string; content: Uint8Array; summaries?: Record<number, string> }[]) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, format TEXT NOT NULL,
      sha256 TEXT NOT NULL UNIQUE, content BLOB NOT NULL, imported_at TEXT NOT NULL);
    CREATE TABLE dives (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER NOT NULL, fingerprint TEXT NOT NULL UNIQUE,
      start TEXT, site TEXT, max_depth_m REAL, duration_s REAL, data TEXT NOT NULL, analysis TEXT NOT NULL, ai_summary TEXT);`);
  for (const [i, f] of files.entries()) {
    db.prepare("INSERT INTO files (filename, format, sha256, content, imported_at) VALUES (?, 'uddf', ?, ?, '2026-10-01')").run(
      f.name, String(i), f.content,
    );
    const fileId = Number(db.prepare("SELECT max(id) AS id FROM files").get()!.id);
    let dives: ReturnType<typeof parseUddf> = [];
    try {
      dives = parseUddf(f.content);
    } catch {
      // A file the Python version stored but no parser reads any more: no dive rows.
    }
    dives.forEach((dive, n) => {
      db.prepare("INSERT INTO dives (file_id, fingerprint, data, analysis, ai_summary) VALUES (?, ?, '{}', '{}', ?)").run(
        fileId, fingerprint(dive), f.summaries?.[n] ?? null,
      );
    });
  }
  db.close();
}

describe("migrateFromPython", () => {
  it("copies every dive and review once, and leaves the database as it was", async () => {
    const database = path.join(home, "dives.db");
    pythonDatabase(database, [
      { name: "spring-2026.uddf", content: SPRING, summaries: { 1: "Python review" } },
      { name: "broken.uddf", content: new TextEncoder().encode("<html/>") },
      { name: "sw.uddf", content: SHEARWATER },
    ]);
    const before = fs.readFileSync(database);

    const report = await migrateFromPython(store, database);
    expect(report).toMatchObject({ files: 3, added: 6, alreadyThere: 0, reviews: 1 });
    expect(report.failed).toEqual([{ fileName: "broken.uddf", error: expect.stringContaining("expected <uddf>") }]);

    const dives = await store.list();
    expect(dives).toHaveLength(6);
    const reviewed = dives.filter((d) => d.review);
    expect(reviewed.map((d) => [d.review?.markdown, d.legacyId])).toEqual([["Python review", 2]]);

    const again = await migrateFromPython(store, database);
    expect(again).toMatchObject({ added: 0, alreadyThere: 6, reviews: 0 });
    expect(fs.readFileSync(database).equals(before)).toBe(true);
  });

  it("keeps a review written since the migration", async () => {
    const database = path.join(home, "dives.db");
    pythonDatabase(database, [{ name: "sw.uddf", content: SHEARWATER, summaries: { 0: "old" } }]);
    const [id] = (await store.importFile("sw.uddf", SHEARWATER)).added;
    await store.saveReview(id, "new");
    expect((await migrateFromPython(store, database)).reviews).toBe(0);
    expect((await store.get(id))?.review?.markdown).toBe("new");
  });
});
