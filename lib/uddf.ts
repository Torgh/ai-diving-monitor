/**
 * Parser for UDDF (Universal Dive Data Format) files, ported from src/ai_diving_monitor/uddf.py.
 *
 * UDDF stores values in SI units: depth in metres, time in seconds, temperature in kelvin, pressure
 * in pascal and volume in cubic metres. Everything is converted here to diver units (m, s, °C, bar,
 * litres).
 */

import type { Dive, GasMix, Sample, Tank } from "./dive";
import { pyMax, pyMin } from "./py";
import { paToBar, parseNumber, toCelsius, toLitres } from "./units";
import { find, findAll, findText, iter, parseXml, XmlError, type XmlElement } from "./xml";

/** Bump when parsing changes, so stored dives are parsed again from their original files. */
export const PARSER_VERSION = 2;

export class UddfParseError extends Error {}

const numberOf = (el: XmlElement | null) => parseNumber(el?.text);

/** Python's int() of a string: an optional sign and digits, surrounded by whitespace. */
function intOf(text: string | null): number | null {
  return text !== null && /^\s*[+-]?\d+\s*$/.test(text) ? Number(text.trim()) : null;
}

/** Text in the encoding its XML declaration names (UTF-8 by default), as Python's XML parser reads it. */
export function decodeXml(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data);
  const head = new TextDecoder("latin1").decode(data.subarray(0, 200));
  const label = /^\s*<\?xml[^>]*encoding=["']([A-Za-z0-9._-]+)["']/.exec(head)?.[1] ?? "utf-8";
  // TextDecoder reads ISO-8859-1 as windows-1252 (the web's rule); Python reads it byte for byte.
  if (/^(iso-?8859-1|latin-?1|l1)$/i.test(label)) return Array.from(data, (b) => String.fromCharCode(b)).join("");
  try {
    return new TextDecoder(label).decode(data);
  } catch {
    return new TextDecoder("utf-8").decode(data);
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Python's datetime(...).isoformat(), or null when the values are not a valid date and time. */
function isoDateTime(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, micro = 0): string | null {
  const valid =
    y >= 1 && y <= 9999 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo) && h <= 23 && mi <= 59 && s <= 59;
  if (!valid) return null;
  const time = `${pad(h)}:${pad(mi)}:${pad(s)}${micro ? `.${pad(micro, 6)}` : ""}`;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${time}`;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?(?:[+-]\d{2}:?\d{2}(?::?\d{2})?)?$/;

/** datetime.fromisoformat(text) with the time zone dropped (the wall-clock time is kept). */
function fromIsoFormat(text: string): string | null {
  const m = ISO.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((v) => (v === undefined ? 0 : Number(v)));
  return isoDateTime(y, mo, d, h, mi, s, m[7] ? Number(m[7].padEnd(6, "0")) : 0);
}

function parseDateTime(info: XmlElement | null): string | null {
  if (!info) return null;
  const dt = find(info, "datetime");
  if (dt?.text) {
    const raw = dt.text.trim().replace("Z", "+00:00");
    for (const candidate of [raw, raw.slice(0, 19), raw.slice(0, 16), raw.slice(0, 10)]) {
      const parsed = fromIsoFormat(candidate);
      if (parsed) return parsed;
    }
  }
  // UDDF 2.x style: <date><year/><month/><day/></date><time><hour/><minute/></time>
  const date = find(info, "date");
  const time = find(info, "time");
  if (date) {
    const part = (el: XmlElement | null, tag: string) => (el ? intOf(findText(el, tag) ?? "0") : 0);
    const values = [part(date, "year"), part(date, "month"), part(date, "day"), part(time, "hour"), part(time, "minute")];
    if (values.some((v) => v === null)) return null;
    const [y, mo, d, h, mi] = values as number[];
    return isoDateTime(y, mo, d, h, mi);
  }
  return null;
}

/** Parse a UDDF document and return all dives it contains. */
export function parseUddf(data: string | Uint8Array): Dive[] {
  const text = typeof data === "string" ? data : decodeXml(data);
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (error) {
    if (error instanceof XmlError) throw new UddfParseError(`Not a valid XML/UDDF file: ${error.message}`);
    throw error;
  }
  if (root.tag.toLowerCase() !== "uddf") throw new UddfParseError(`Root element is <${root.tag}>, expected <uddf>`);

  const join = (parts: (string | null)[]) => parts.filter(Boolean).join(" ") || null;
  let computer: string | null = null;
  const dc = find(root, "diver/owner/equipment/divecomputer");
  if (dc) computer = join([findText(dc, "manufacturer/name"), findText(dc, "model"), findText(dc, "name")]);
  if (computer === null) {
    const gen = find(root, "generator");
    if (gen) computer = join([findText(gen, "name"), findText(gen, "version")]);
  }

  const mixes = new Map<string, GasMix>();
  for (const mix of iter(root, "mix")) {
    const id = mix.attrs.id;
    if (!id) continue;
    const o2 = numberOf(find(mix, "o2"));
    mixes.set(id, { id, name: findText(mix, "name") || id, o2: o2 ?? 0.21, he: numberOf(find(mix, "he")) || 0 });
  }

  const sites = new Map<string, [string | null, string | null]>();
  for (const site of iter(root, "site")) {
    const id = site.attrs.id;
    if (id) sites.set(id, [findText(site, "name"), findText(site, "geography/location")]);
  }

  const dives = [...iter(root, "dive")].map((el) => parseDive(el, mixes, sites, computer));
  if (dives.length === 0) throw new UddfParseError("The file does not contain any <dive> elements");
  return dives;
}

/** Factor that turns a dive's raw CNS values into percent: fractions (0..1) have decimals, whole percent doesn't. */
export function cnsScale(values: number[]): number {
  return values.length > 0 && pyMax(values) <= 1.5 && values.some((v) => !Number.isInteger(v)) ? 100 : 1;
}

function parseDive(
  el: XmlElement,
  mixes: Map<string, GasMix>,
  sites: Map<string, [string | null, string | null]>,
  computer: string | null,
): Dive {
  const before = find(el, "informationbeforedive");
  const after = find(el, "informationafterdive");

  const numberText = before ? findText(before, "divenumber") : null;
  const number = numberText ? intOf(numberText) : null;

  let site: string | null = null;
  let location: string | null = null;
  for (const link of findAll(before, "link")) {
    const found = sites.get(link.attrs.ref);
    if (found) [site, location] = found;
  }

  let tanks: Tank[] = findAll(el, "tankdata").map((td, i) => ({
    id: td.attrs.id || `tank${i + 1}`,
    mixId: findAll(td, "link").find((l) => mixes.has(l.attrs.ref))?.attrs.ref ?? null,
    volumeL: toLitres(numberOf(find(td, "tankvolume"))),
    startBar: paToBar(numberOf(find(td, "tankpressurebegin"))),
    endBar: paToBar(numberOf(find(td, "tankpressureend"))),
  }));

  const samples: Sample[] = [];
  let currentMix = tanks[0]?.mixId ?? null;
  for (const wp of findAll(find(el, "samples"), "waypoint")) {
    const timeS = numberOf(find(wp, "divetime"));
    const depthM = numberOf(find(wp, "depth"));
    if (timeS === null || depthM === null) continue;
    const switchRef = find(wp, "switchmix")?.attrs.ref || null;
    if (switchRef) currentMix = switchRef;
    const tp = find(wp, "tankpressure");
    const decoDepth = find(wp, "decostop")?.attrs.decodepth;
    samples.push({
      timeS,
      depthM,
      tempC: toCelsius(numberOf(find(wp, "temperature"))),
      pressureBar: paToBar(numberOf(tp)),
      tankRef: tp?.attrs.ref ?? null,
      mixRef: switchRef || (samples.length === 0 ? currentMix : null),
      ppo2: numberOf(find(wp, "calculatedpo2")),
      cns: numberOf(find(wp, "cns")), // raw; scaled to percent below
      ndlS: numberOf(find(wp, "nodecotime")),
      decoDepthM: decoDepth ? parseNumber(decoDepth) : null,
      alarms: findAll(wp, "alarm").flatMap((a) => (a.text?.trim() ? [a.text.trim()] : [])),
    });
  }
  samples.sort((a, b) => a.timeS - b.timeS);
  const scale = cnsScale(samples.flatMap((s) => (s.cns === null ? [] : [s.cns])));
  for (const s of samples) if (s.cns !== null) s.cns *= scale;

  let maxDepthM = after ? numberOf(find(after, "greatestdepth")) : null;
  let durationS = after ? numberOf(find(after, "diveduration")) : null;
  if (maxDepthM === null) maxDepthM = samples.length ? pyMax(samples.map((s) => s.depthM)) : 0;
  if (durationS === null) durationS = samples.length ? samples[samples.length - 1].timeS : 0;

  const temps = samples.flatMap((s) => (s.tempC === null ? [] : [s.tempC]));
  let minTempC = after ? toCelsius(numberOf(find(after, "lowesttemperature"))) : null;
  if (minTempC === null && temps.length) minTempC = pyMin(temps);

  // Fill tank start/end pressure from samples when the summary block is missing.
  for (const tank of tanks) {
    const own = samples.flatMap((s) =>
      s.pressureBar !== null && (s.tankRef === null || s.tankRef === tank.id) ? [s.pressureBar] : [],
    );
    if (own.length) {
      tank.startBar = tank.startBar || own[0];
      tank.endBar = tank.endBar || own[own.length - 1];
    }
  }
  // Dive computers export every tank slot; a slot with no pressure and no volume was not used.
  tanks = tanks.filter((t) => t.startBar || t.endBar || t.volumeL);

  const notes = find(after, "notes");
  return {
    uddfId: el.attrs.id || "",
    number,
    start: parseDateTime(before),
    site,
    location,
    maxDepthM,
    durationS,
    minTempC,
    notes: notes ? notes.texts.join(" ") || null : null,
    gasMixes: Object.fromEntries([...mixes].map(([id, mix]) => [id, { ...mix }])),
    tanks,
    samples,
    computer,
  };
}
