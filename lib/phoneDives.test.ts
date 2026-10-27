import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprint } from "./dive";
import { ExportFileError } from "./exportFile";
import { buildPhoneDives, fromBase64, phoneDivesFileName, phoneFile, readPhoneDives, stillOnPhone, toBase64, withPhoneDives } from "./phoneDives";
import { newRecord } from "./record";
import { parseUddf } from "./uddf";

const ROOT = path.resolve(__dirname, "..");
const bytesOf = (name: string) => new Uint8Array(fs.readFileSync(path.join(ROOT, "examples", name)));
const AT = "2026-10-27T10:00:00.000Z";
const spring = bytesOf("spring-2026.uddf");
const summer = bytesOf("summer-2026.uddf");

describe("dives imported on the phone", () => {
  it("get the records the PC would give them", () => {
    const { file, records } = phoneFile("summer.uddf", summer, AT);
    const hash = createHash("sha256").update(summer).digest("hex");
    expect(file).toMatchObject({ fileName: "summer.uddf", sha256: hash, importedAt: AT });
    expect(records).toEqual(parseUddf(summer).map((d) => newRecord(fingerprint(d), d, "summer.uddf", hash, AT)));
  });

  it("show next to the exported log until an export holds them", () => {
    const exported = phoneFile("spring.uddf", spring, AT).records;
    const phone = phoneFile("summer.uddf", summer, AT);
    const both = withPhoneDives(exported, [phone.file]);
    expect(both.dives).toHaveLength(exported.length + phone.records.length);
    expect([...both.phoneOnly]).toEqual(phone.records.map((r) => r.id));
    expect(both.dives.map((d) => d.dive.start)).toEqual([...both.dives.map((d) => d.dive.start)].sort());

    expect(stillOnPhone([phone.file], exported)).toEqual([phone.file]);
    const newer = [...exported, ...phone.records];
    expect(stillOnPhone([phone.file], newer)).toEqual([]);
    expect(withPhoneDives(newer, [phone.file]).phoneOnly.size).toBe(0);
  });

  it("travel to the PC as their original files", () => {
    const files = [phoneFile("spring.uddf", spring, AT).file, phoneFile("summer.uddf", summer, AT).file];
    const sent = JSON.parse(JSON.stringify(buildPhoneDives(files, AT)));
    expect(readPhoneDives(sent)).toEqual([
      { fileName: "spring.uddf", data: spring },
      { fileName: "summer.uddf", data: summer },
    ]);
    expect(phoneDivesFileName(AT)).toBe("DiveDeck from phone 2026-10-27.divedeck.json");
  });

  it("refuses other files and files from a newer app", () => {
    expect(() => readPhoneDives({ format: "divedeck/export" })).toThrow(ExportFileError);
    expect(() => readPhoneDives({ ...buildPhoneDives([], AT), version: 99 })).toThrow(/newer phone app/);
  });

  it("keeps any bytes through base64", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
