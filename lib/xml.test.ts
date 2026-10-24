import { describe, expect, it } from "vitest";
import { find, findAll, findText, iter, parseXml, XmlError } from "./xml";

const DOC = `<?xml version="1.0"?>
<!-- a comment -->
<u:uddf xmlns:u="http://www.streit.cc/uddf/3.2/" version="3.2.1">
  <diver><owner><equipment><divecomputer id="dc"><name> Peregrine </name><model/></divecomputer></equipment></owner></diver>
  <notes>First <b>bold</b> then <![CDATA[raw & text]]></notes>
  <mix id="m1"/><group><mix id="m2"/></group>
  <n>5</n><n>6</n>
</u:uddf>`;

describe("xml", () => {
  const root = parseXml(DOC);

  it("strips namespace prefixes and keeps attributes as strings", () => {
    expect(root.tag).toBe("uddf");
    expect(root.attrs.version).toBe("3.2.1");
  });

  it("finds children by path and reads their text like ElementTree", () => {
    expect(findText(root, "./diver/owner/equipment/divecomputer/name")).toBe("Peregrine");
    expect(findText(root, "diver/owner/equipment/divecomputer/model")).toBe("");
    expect(findText(root, "diver/missing")).toBeNull();
    expect(find(null, "a")).toBeNull();
    expect(findAll(root, "n").map((e) => e.text)).toEqual(["5", "6"]);
    expect(findAll(null, "n")).toEqual([]);
  });

  it("keeps the text before the first child and all text pieces in order", () => {
    const notes = find(root, "notes")!;
    expect(notes.text).toBe("First");
    expect(notes.texts).toEqual(["First", "bold", "then", "raw & text"]);
  });

  it("iterates all descendants with a tag", () => {
    expect([...iter(root, "mix")].map((e) => e.attrs.id)).toEqual(["m1", "m2"]);
  });

  it("rejects text that isn't well-formed XML", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(XmlError);
    expect(() => parseXml("not xml")).toThrow(XmlError);
  });
});
