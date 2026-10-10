"""Parser for UDDF (Universal Dive Data Format) files.

UDDF stores values in SI units: depth in metres, time in seconds,
temperature in Kelvin, pressure in Pascal and volume in cubic metres.
Everything is converted here to diver-friendly units (m, s, °C, bar, litres).
"""

from __future__ import annotations

import hashlib
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Optional

PA_PER_BAR = 100_000.0
KELVIN_OFFSET = 273.15


@dataclass
class GasMix:
    id: str
    name: str
    o2: float  # fraction 0..1
    he: float = 0.0

    @property
    def n2(self) -> float:
        return max(0.0, 1.0 - self.o2 - self.he)

    @property
    def label(self) -> str:
        if self.he > 0:
            return f"Tx {round(self.o2 * 100)}/{round(self.he * 100)}"
        if abs(self.o2 - 0.21) < 0.005:
            return "Air"
        if self.o2 >= 0.995:
            return "Oxygen"
        return f"EAN{round(self.o2 * 100)}"


@dataclass
class Tank:
    id: str
    mix_id: Optional[str]
    volume_l: Optional[float]
    start_bar: Optional[float]
    end_bar: Optional[float]


@dataclass
class Sample:
    time_s: float
    depth_m: float
    temp_c: Optional[float] = None
    pressure_bar: Optional[float] = None  # pressure of the tank currently breathed
    tank_ref: Optional[str] = None
    mix_ref: Optional[str] = None  # set when a gas switch happens at this sample
    ppo2: Optional[float] = None
    cns: Optional[float] = None  # percent
    ndl_s: Optional[float] = None
    deco_depth_m: Optional[float] = None
    alarms: list[str] = field(default_factory=list)


@dataclass
class Dive:
    uddf_id: str
    number: Optional[int]
    start: Optional[datetime]
    site: Optional[str]
    location: Optional[str]
    max_depth_m: float
    duration_s: float
    min_temp_c: Optional[float]
    notes: Optional[str]
    gas_mixes: dict[str, GasMix]
    tanks: list[Tank]
    samples: list[Sample]
    computer: Optional[str] = None

    @property
    def fingerprint(self) -> str:
        """Stable identifier used to avoid importing the same dive twice."""
        key = f"{self.start.isoformat() if self.start else ''}|{round(self.duration_s)}|{round(self.max_depth_m, 1)}"
        if not self.start:
            key += "|" + "".join(f"{s.time_s:.0f}:{s.depth_m:.1f}" for s in self.samples[:50])
        return hashlib.sha256(key.encode()).hexdigest()[:24]

    def to_dict(self) -> dict:
        d = asdict(self)
        d["start"] = self.start.isoformat() if self.start else None
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Dive":
        return cls(
            uddf_id=d["uddf_id"],
            number=d.get("number"),
            start=datetime.fromisoformat(d["start"]) if d.get("start") else None,
            site=d.get("site"),
            location=d.get("location"),
            max_depth_m=d["max_depth_m"],
            duration_s=d["duration_s"],
            min_temp_c=d.get("min_temp_c"),
            notes=d.get("notes"),
            gas_mixes={k: GasMix(**v) for k, v in d.get("gas_mixes", {}).items()},
            tanks=[Tank(**t) for t in d.get("tanks", [])],
            samples=[Sample(**s) for s in d.get("samples", [])],
            computer=d.get("computer"),
        )


class UDDFParseError(ValueError):
    pass


def _strip_namespaces(root: ET.Element) -> None:
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]


def _float(el: Optional[ET.Element]) -> Optional[float]:
    if el is None or el.text is None or not el.text.strip():
        return None
    try:
        return float(el.text.strip())
    except ValueError:
        return None


def _text(el: Optional[ET.Element]) -> Optional[str]:
    if el is None:
        return None
    text = " ".join(t.strip() for t in el.itertext() if t.strip())
    return text or None


def _bar(pa: Optional[float]) -> Optional[float]:
    return None if pa is None else pa / PA_PER_BAR


def _celsius(k: Optional[float]) -> Optional[float]:
    if k is None:
        return None
    # Some exporters write Celsius despite the spec; values below 100 cannot be Kelvin.
    return k - KELVIN_OFFSET if k > 100 else k


def _parse_datetime(info: Optional[ET.Element]) -> Optional[datetime]:
    if info is None:
        return None
    dt = info.find("datetime")
    if dt is not None and dt.text:
        raw = dt.text.strip().replace("Z", "+00:00")
        for candidate in (raw, raw[:19], raw[:16], raw[:10]):
            try:
                return datetime.fromisoformat(candidate).replace(tzinfo=None)
            except ValueError:
                continue
    # UDDF 2.x style: <date><year/><month/><day/></date><time><hour/><minute/></time>
    date, time = info.find("date"), info.find("time")
    if date is not None:
        try:
            y, m, d = (int(date.findtext(k, "0")) for k in ("year", "month", "day"))
            hh = int(time.findtext("hour", "0")) if time is not None else 0
            mm = int(time.findtext("minute", "0")) if time is not None else 0
            return datetime(y, m, d, hh, mm)
        except ValueError:
            return None
    return None


def parse_uddf(data: bytes | str) -> list[Dive]:
    """Parse a UDDF document and return all dives it contains."""
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise UDDFParseError(f"Not a valid XML/UDDF file: {exc}") from exc
    _strip_namespaces(root)
    if root.tag.lower() != "uddf":
        raise UDDFParseError(f"Root element is <{root.tag}>, expected <uddf>")

    computer = None
    dc = root.find("./diver/owner/equipment/divecomputer")
    if dc is not None:
        computer = " ".join(filter(None, [dc.findtext("manufacturer/name"), dc.findtext("model"), dc.findtext("name")])) or None
    if computer is None:
        gen = root.find("generator")
        if gen is not None:
            computer = " ".join(filter(None, [gen.findtext("name"), gen.findtext("version")])) or None

    mixes: dict[str, GasMix] = {}
    for mix in root.iter("mix"):
        mid = mix.get("id")
        if not mid:
            continue
        o2 = _float(mix.find("o2"))
        he = _float(mix.find("he")) or 0.0
        mixes[mid] = GasMix(id=mid, name=mix.findtext("name") or mid, o2=o2 if o2 is not None else 0.21, he=he)

    sites: dict[str, tuple[Optional[str], Optional[str]]] = {}
    for site in root.iter("site"):
        sid = site.get("id")
        if sid:
            sites[sid] = (site.findtext("name"), site.findtext("geography/location"))

    dives: list[Dive] = []
    for dive_el in root.iter("dive"):
        dives.append(_parse_dive(dive_el, mixes, sites, computer))
    if not dives:
        raise UDDFParseError("The file does not contain any <dive> elements")
    return dives


def _parse_dive(dive_el: ET.Element, mixes: dict[str, GasMix], sites: dict, computer: Optional[str]) -> Dive:
    before = dive_el.find("informationbeforedive")
    after = dive_el.find("informationafterdive")

    number = None
    if before is not None and before.findtext("divenumber"):
        try:
            number = int(before.findtext("divenumber").strip())
        except ValueError:
            pass

    site = location = None
    if before is not None:
        for link in before.findall("link"):
            if link.get("ref") in sites:
                site, location = sites[link.get("ref")]

    tanks: list[Tank] = []
    for i, td in enumerate(dive_el.findall("tankdata")):
        mix_ref = next((l.get("ref") for l in td.findall("link") if l.get("ref") in mixes), None)
        vol = _float(td.find("tankvolume"))
        tanks.append(
            Tank(
                id=td.get("id") or f"tank{i + 1}",
                mix_id=mix_ref,
                # tankvolume is m³ per spec; tolerate exporters that write litres.
                volume_l=None if vol is None else (vol * 1000 if vol < 1 else vol),
                start_bar=_bar(_float(td.find("tankpressurebegin"))),
                end_bar=_bar(_float(td.find("tankpressureend"))),
            )
        )

    samples: list[Sample] = []
    current_mix = tanks[0].mix_id if tanks else None
    samples_el = dive_el.find("samples")
    if samples_el is not None:
        for wp in samples_el.findall("waypoint"):
            t, d = _float(wp.find("divetime")), _float(wp.find("depth"))
            if t is None or d is None:
                continue
            switch = wp.find("switchmix")
            mix_ref = switch.get("ref") if switch is not None else None
            if mix_ref:
                current_mix = mix_ref
            tp = wp.find("tankpressure")
            deco = wp.find("decostop")
            samples.append(
                Sample(
                    time_s=t,
                    depth_m=d,
                    temp_c=_celsius(_float(wp.find("temperature"))),
                    pressure_bar=_bar(_float(tp)),
                    tank_ref=tp.get("ref") if tp is not None else None,
                    mix_ref=mix_ref or (current_mix if not samples else None),
                    ppo2=_float(wp.find("calculatedpo2")),
                    cns=_cns_percent(_float(wp.find("cns"))),
                    ndl_s=_float(wp.find("nodecotime")),
                    deco_depth_m=float(deco.get("decodepth")) if deco is not None and deco.get("decodepth") else None,
                    alarms=[a.text.strip() for a in wp.findall("alarm") if a.text and a.text.strip()],
                )
            )
    samples.sort(key=lambda s: s.time_s)

    max_depth = _float(after.find("greatestdepth")) if after is not None else None
    duration = _float(after.find("diveduration")) if after is not None else None
    if max_depth is None:
        max_depth = max((s.depth_m for s in samples), default=0.0)
    if duration is None:
        duration = samples[-1].time_s if samples else 0.0

    temps = [s.temp_c for s in samples if s.temp_c is not None]
    min_temp = _celsius(_float(after.find("lowesttemperature"))) if after is not None else None
    if min_temp is None and temps:
        min_temp = min(temps)

    # Fill tank start/end pressure from samples when the summary block is missing.
    for tank in tanks:
        own = [s.pressure_bar for s in samples if s.pressure_bar is not None and (s.tank_ref in (None, tank.id))]
        if own:
            tank.start_bar = tank.start_bar or own[0]
            tank.end_bar = tank.end_bar or own[-1]

    return Dive(
        uddf_id=dive_el.get("id") or "",
        number=number,
        start=_parse_datetime(before),
        site=site,
        location=location,
        max_depth_m=max_depth,
        duration_s=duration,
        min_temp_c=min_temp,
        notes=_text(after.find("notes")) if after is not None else None,
        gas_mixes={k: v for k, v in mixes.items()},
        tanks=tanks,
        samples=samples,
        computer=computer,
    )


def _cns_percent(value: Optional[float]) -> Optional[float]:
    # UDDF stores CNS as a fraction (0..1); some tools write percent.
    if value is None:
        return None
    return value * 100 if value <= 1.5 else value
