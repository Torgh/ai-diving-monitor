"""Generate synthetic UDDF sample dives showing a diver's progression.

Usage:  python scripts/generate_samples.py
Writes UDDF 3.2 files into ./examples. The dives are fictional.
"""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[1] / "examples"

MIXES = {
    "air": ("Air", 0.21, 0.0),
    "ean32": ("EAN32", 0.32, 0.0),
    "ean50": ("EAN50", 0.50, 0.0),
    "tx2135": ("Trimix 21/35", 0.21, 0.35),
}


def profile(max_depth, bottom_min, descent_rate, ascent_rate, stop_s, deco=None, sawtooth=False,
            fast_final=False, rmv=20.0, tank_l=12.0, start_bar=210.0, switch=None, seed=0):
    """Return waypoints (t, depth, temp, pressure, extra) using a simple multilevel model."""
    rnd = random.Random(seed)
    pts = []
    t, d, p = 0.0, 0.0, start_bar
    step = 10.0
    surface_temp, bottom_temp = 22.0, 12.0 if max_depth > 30 else 16.0

    def add(extra=None):
        temp = bottom_temp + (surface_temp - bottom_temp) * max(0.0, 1 - d / 20)
        pts.append((t, max(d, 0.0), temp, p, extra or {}))

    def breathe(dt, depth, mult=1.0):
        nonlocal p
        p -= rmv * mult * (1.013 + depth / 10) * (dt / 60) / tank_l

    add()
    while d < max_depth:
        t += step
        d = min(max_depth, d + descent_rate * step / 60)
        breathe(step, d, 1.2)
        add()
    end_bottom = t + bottom_min * 60
    while t < end_bottom:
        t += step
        wobble = 1.2 * math.sin(t / 90) + rnd.uniform(-0.3, 0.3)
        if sawtooth and int(t / 240) % 2 == 1:
            wobble -= 5
        d = max_depth - 2 + wobble
        breathe(step, d)
        add()

    # (target depth, hold seconds, is mandatory deco stop)
    targets = [(depth, hold, True) for depth, hold in (deco or [])]
    if stop_s:
        targets.append((5.0, stop_s, False))
    targets.append((0.0, 0, False))
    switched = False
    for target, hold, mandatory in targets:
        while d > target:
            rate = ascent_rate * (2.0 if fast_final and d < 12 else 1.0)
            t += step
            d = max(target, d - rate * step / 60)
            breathe(step, d)
            extra = {"decostop": target} if mandatory else {}
            if switch and not switched and d <= switch[0]:
                extra["switch"] = switch[1]
                switched = True
            add(extra)
        held = 0
        while held < hold:
            t += step
            held += step
            breathe(step, d, 0.9)
            add({"decostop": target} if mandatory else {})
    return pts


DIVES = [
    # (date, site, location, mix, max_depth, bottom_min, desc, asc, safety_stop_s, kwargs)
    ("2026-03-14T10:05", "Koparki", "Jaworzno, Poland", "air", 18, 30, 15, 16, 60,
     dict(rmv=24, tank_l=15, fast_final=True, sawtooth=True)),
    ("2026-03-28T11:20", "Koparki", "Jaworzno, Poland", "air", 20, 28, 15, 13, 120,
     dict(rmv=23, tank_l=15, sawtooth=True)),
    ("2026-04-18T09:40", "Zakrzówek", "Kraków, Poland", "ean32", 24, 28, 18, 12, 150, dict(rmv=21.5, tank_l=15)),
    ("2026-05-09T10:15", "Zakrzówek", "Kraków, Poland", "ean32", 26, 30, 18, 10, 180, dict(rmv=20, tank_l=15)),
    ("2026-06-06T08:55", "Hańcza", "Suwałki, Poland", "ean32", 28, 30, 20, 9.5, 200, dict(rmv=19, tank_l=15)),
    ("2026-07-11T09:30", "Dahab Canyon", "Dahab, Egypt", "ean32", 30, 30, 20, 9, 210, dict(rmv=17.5, tank_l=15)),
    ("2026-07-13T08:10", "Blue Hole Arch", "Dahab, Egypt", "tx2135", 52, 20, 20, 9, 0,
     dict(rmv=17, tank_l=24, start_bar=220, deco=[(21, 60), (12, 120), (9, 180), (6, 420)],
          switch=(21, "ean50"))),
    ("2026-08-22T10:00", "Hańcza", "Suwałki, Poland", "ean32", 32, 30, 20, 9, 240, dict(rmv=16, tank_l=15)),
    ("2026-09-19T09:45", "Zakrzówek", "Kraków, Poland", "ean32", 27, 40, 18, 8.5, 240, dict(rmv=15.2, tank_l=15)),
]


def waypoint_xml(t, d, temp, p, extra, tank_ref):
    parts = [f"<divetime>{t:.0f}</divetime>", f"<depth>{d:.2f}</depth>",
             f"<temperature>{temp + 273.15:.2f}</temperature>",
             f'<tankpressure ref="{tank_ref}">{p * 100000:.0f}</tankpressure>']
    if "switch" in extra:
        parts.append(f'<switchmix ref="{extra["switch"]}"/>')
    if "decostop" in extra:
        parts.append(f'<decostop kind="mandatory" decodepth="{extra["decostop"]}" duration="60"/>')
    return "<waypoint>" + "".join(parts) + "</waypoint>"


def build(dives, generator="ai-diving-monitor sample generator"):
    sites = {}
    body = []
    for i, (date, site, loc, mix, depth, bottom, desc, asc, stop, kw) in dives:
        sid = "site_" + "".join(c for c in site.lower() if c.isalnum())
        sites[sid] = (site, loc)
        tank_l = kw.get("tank_l", 12.0)
        pts = profile(depth, bottom, desc, asc, stop, seed=i, **kw)
        tanks = [f'<tankdata id="tank{i}"><link ref="{mix}"/><tankvolume>{tank_l / 1000:.3f}</tankvolume>'
                 f'<tankpressurebegin>{pts[0][3] * 100000:.0f}</tankpressurebegin>'
                 f'<tankpressureend>{pts[-1][3] * 100000:.0f}</tankpressureend></tankdata>']
        samples = "\n".join("        " + waypoint_xml(*pt, f"tank{i}") for pt in pts)
        body.append(f"""    <dive id="dive{i}">
      <informationbeforedive>
        <link ref="{sid}"/>
        <divenumber>{i}</divenumber>
        <datetime>{date}</datetime>
      </informationbeforedive>
      {''.join(tanks)}
      <samples>
{samples}
      </samples>
      <informationafterdive>
        <greatestdepth>{max(p[1] for p in pts):.2f}</greatestdepth>
        <diveduration>{pts[-1][0]:.0f}</diveduration>
        <lowesttemperature>{min(p[2] for p in pts) + 273.15:.2f}</lowesttemperature>
      </informationafterdive>
    </dive>""")
    mixes = "\n".join(f'    <mix id="{k}"><name>{n}</name><o2>{o2}</o2><he>{he}</he></mix>'
                      for k, (n, o2, he) in MIXES.items())
    site_xml = "\n".join(f'    <site id="{k}"><name>{escape(n)}</name><geography><location>{escape(l)}</location></geography></site>'
                         for k, (n, l) in sites.items())
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<uddf xmlns="http://www.streit.cc/uddf/3.2/" version="3.2.1">
  <generator><name>{generator}</name><version>0.1.0</version><datetime>{datetime(2026, 10, 1).isoformat()}</datetime></generator>
  <divesite>
{site_xml}
  </divesite>
  <gasdefinitions>
{mixes}
  </gasdefinitions>
  <profiledata>
    <repetitiongroup id="rg1">
{chr(10).join(body)}
    </repetitiongroup>
  </profiledata>
</uddf>
"""


def main():
    OUT.mkdir(exist_ok=True)
    numbered = list(enumerate(DIVES, start=1))
    (OUT / "spring-2026.uddf").write_text(build(numbered[:5]), encoding="utf-8")
    (OUT / "summer-2026.uddf").write_text(build(numbered[5:]), encoding="utf-8")
    print(f"Wrote samples to {OUT}")


if __name__ == "__main__":
    main()
