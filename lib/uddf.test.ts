import { describe, expect, it } from "vitest";
import { fingerprint, gasLabel, nitrogen } from "./dive";
import { cnsScale, decodeXml, parseUddf, UddfParseError } from "./uddf";

const MINIMAL = `<?xml version="1.0"?>
<uddf xmlns="http://www.streit.cc/uddf/3.2/" version="3.2.1">
  <gasdefinitions><mix id="m1"><name>EAN32</name><o2>0.32</o2></mix></gasdefinitions>
  <divesite><site id="s1"><name>Reef</name><geography><location>Red Sea</location></geography></site></divesite>
  <profiledata><repetitiongroup><dive id="d1">
    <informationbeforedive><link ref="s1"/><divenumber>7</divenumber><datetime>2026-01-02T09:30:00</datetime></informationbeforedive>
    <tankdata><link ref="m1"/><tankvolume>0.012</tankvolume><tankpressurebegin>20000000</tankpressurebegin><tankpressureend>7000000</tankpressureend></tankdata>
    <samples>
      <waypoint><divetime>0</divetime><depth>0</depth><temperature>298.15</temperature></waypoint>
      <waypoint><divetime>60</divetime><depth>15</depth><temperature>296.15</temperature></waypoint>
      <waypoint><divetime>600</divetime><depth>15</depth></waypoint>
      <waypoint><divetime>720</divetime><depth>0</depth></waypoint>
    </samples>
  </dive></repetitiongroup></profiledata>
</uddf>`;

describe("parseUddf", () => {
  it("parses a minimal file and converts units", () => {
    const [dive] = parseUddf(MINIMAL);
    expect(dive).toMatchObject({ number: 7, site: "Reef", location: "Red Sea", start: "2026-01-02T09:30:00" });
    expect(dive.maxDepthM).toBe(15);
    expect(dive.durationS).toBe(720);
    expect(dive.minTempC).toBeCloseTo(23);
    expect(dive.tanks[0].volumeL).toBeCloseTo(12);
    expect([dive.tanks[0].startBar, dive.tanks[0].endBar]).toEqual([200, 70]);
    expect(gasLabel(dive.gasMixes.m1)).toBe("EAN32");
    expect(nitrogen(dive.gasMixes.m1)).toBeCloseTo(0.68);
  });

  it("reads bytes in the encoding the XML declaration names", () => {
    // é is the single byte 0xE9 in ISO-8859-1, and two bytes in UTF-8 (the default without a declaration).
    const text = MINIMAL.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="ISO-8859-1"?>').replace("Reef", "Récif");
    const latin1 = Uint8Array.from(text, (ch) => ch.charCodeAt(0));
    const utf8 = new TextEncoder().encode(MINIMAL.replace("Reef", "Récif"));
    expect(parseUddf(latin1)[0].site).toBe("Récif");
    expect(parseUddf(utf8)[0].site).toBe("Récif");
  });

  it("reads ISO-8859-1 byte for byte, like Python (not as windows-1252)", () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0" encoding="ISO-8859-1"?><uddf>x</uddf>');
    const withC1 = Uint8Array.from([...bytes.subarray(0, -11), 0x85, 0x9c, ...bytes.subarray(-11)]);
    expect(decodeXml(withC1)).toContain("");
  });

  it("reads UTF-16 files with a byte order mark", () => {
    const le = [0xff, 0xfe, ...[...MINIMAL].flatMap((ch) => [ch.charCodeAt(0), 0])];
    const be = [0xfe, 0xff, ...[...MINIMAL].flatMap((ch) => [0, ch.charCodeAt(0)])];
    expect(decodeXml(Uint8Array.from(le))).toBe(MINIMAL);
    expect(decodeXml(Uint8Array.from(be))).toBe(MINIMAL);
  });

  it("falls back to UTF-8 for an unknown encoding", () => {
    expect(decodeXml(new TextEncoder().encode('<?xml version="1.0" encoding="no-such-codec"?><uddf/>'))).toContain("<uddf/>");
  });

  it("rejects files that aren't UDDF or have no dives", () => {
    expect(() => parseUddf("<html></html>")).toThrow(UddfParseError);
    expect(() => parseUddf("not xml")).toThrow(/Not a valid XML\/UDDF file/);
    expect(() => parseUddf("<uddf><profiledata/></uddf>")).toThrow(/does not contain any <dive>/);
  });

  it("decides once per dive whether CNS is a fraction or whole percent", () => {
    expect(cnsScale([0, 1, 3])).toBe(1);
    expect(cnsScale([0.01, 0.04])).toBe(100);
    expect(cnsScale([0, 1])).toBe(1);
    expect(cnsScale([])).toBe(1);
  });

  it("fingerprints dives without a date from their first samples", () => {
    const [dive] = parseUddf(MINIMAL.replace("<datetime>2026-01-02T09:30:00</datetime>", ""));
    expect(dive.start).toBeNull();
    const other = { ...dive, samples: dive.samples.map((s) => ({ ...s, depthM: s.depthM + 1 })) };
    expect(fingerprint(dive)).toMatch(/^[0-9a-f]{24}$/);
    expect(fingerprint(other)).not.toBe(fingerprint(dive));
  });

  it("names gases like the Python version", () => {
    const mix = (o2: number, he = 0) => gasLabel({ id: "x", name: "x", o2, he });
    expect([mix(0.21), mix(0.32), mix(1), mix(0.18, 0.45)]).toEqual(["Air", "EAN32", "Oxygen", "Tx 18/45"]);
  });
});
