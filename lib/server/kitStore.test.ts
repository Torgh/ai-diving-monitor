import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateSettings } from "./config";
import { copyKit, KitStore } from "./kitStore";
import { switchStorage } from "./storage";
import { isolateEnv, restoreEnv } from "../../test-env";

const saved = { ...process.env };
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "adm-kit-"));
  for (const name of Object.keys(process.env)) if (/^ONEDRIVE/i.test(name)) delete process.env[name];
  isolateEnv(home);
});

afterEach(() => {
  restoreEnv(saved);
  fs.rmSync(home, { recursive: true, force: true });
});

describe("KitStore", () => {
  it("starts empty, saves changes in kit.json and reads them back", async () => {
    const store = new KitStore();
    expect(await store.get()).toMatchObject({ diver: {}, items: [], sets: [], sites: [] });
    await store.update({ diver: { massKg: 82 }, items: [{ name: "Fins", kind: "fins" }] });
    const kit = await new KitStore().get();
    expect(kit.diver.massKg).toBe(82);
    expect(kit.items.map((i) => i.id)).toEqual(["fins"]);
    expect(fs.existsSync(path.join(home, "kit", "kit.json"))).toBe(true);
  });

  it("reads a broken file as an empty kit", async () => {
    fs.mkdirSync(path.join(home, "kit"), { recursive: true });
    fs.writeFileSync(path.join(home, "kit", "kit.json"), "{ half");
    expect((await new KitStore().get()).items).toEqual([]);
  });

  it("is copied when the storage changes, the newer copy winning", async () => {
    const local = new KitStore();
    await local.update({ diver: { massKg: 80 } });
    const oneDrive = path.join(home, "OneDrive");
    fs.mkdirSync(oneDrive);
    process.env.OneDrive = oneDrive;
    await switchStorage("onedrive");
    const there = new KitStore();
    expect(there.backend.kind).toBe("onedrive");
    expect((await there.get()).diver.massKg).toBe(80);

    await there.update({ diver: { massKg: 81 } });
    expect(await copyKit(there, local)).toBe(true);
    expect(await copyKit(there, local)).toBe(false);
    expect((await local.get()).diver.massKg).toBe(81);
    expect(await copyKit(new KitStore(local.backend), there)).toBe(false);
    await updateSettings({ storage: "local" });
  });
});
