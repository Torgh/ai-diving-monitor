"""Write fixtures/uddf/edge-cases.uddf: fictional dives that reach the branches the sample log doesn't.

Deco with a violated ceiling and with stops kept, gas switches, trimix END, computer ppO2 and alarms,
a rocket ascent after a sawtooth, a hypoxic gas, CNS as fractions, a dive without a date, a single
sample, UDDF 2.x dates, time zones, mixed-content notes and an ISO-8859-1 file.

    python scripts/generate_edge_cases.py && python scripts/export_golden.py
"""

from pathlib import Path

out = Path(__file__).resolve().parents[1] / "fixtures" / "uddf" / "edge-cases.uddf"


def wp(t, d, extra=""):
    return f"        <waypoint><divetime>{t}</divetime><depth>{d}</depth>{extra}</waypoint>"


def ramp(t0, t1, d0, d1, step=20):
    return [(t, round(d0 + (d1 - d0) * (t - t0) / (t1 - t0), 2)) for t in range(t0, t1 + 1, step)]


# A: trimix deco dive with gas switches, a violated ceiling, computer ppO2 and alarms.
a = []
for t, d in ramp(0, 180, 0, 60) + ramp(200, 1500, 60, 60) + ramp(1520, 2100, 60, 21):
    extra = f'<temperature>{11.5 - min(d, 40) * 0.1:.2f}</temperature><tankpressure ref="tA1">{(210 - t / 40) * 1e5:.0f}</tankpressure>'
    if t == 0:
        extra += '<switchmix ref="tx2135"/>'
    if t >= 1700:
        extra += '<decostop kind="mandatory" decodepth="21"/>'
    a.append(wp(t, d, extra))
for t, d in ramp(2120, 2700, 21, 6):
    extra = '<decostop kind="mandatory" decodepth="9"/>' if t < 2500 else '<decostop kind="mandatory" decodepth="6"/>'
    if t == 2120:
        extra += '<switchmix ref="ean50"/>'
    if 2300 <= t <= 2340:
        extra += "<alarm>ascent</alarm>"
    a.append(wp(t, d, extra + f"<calculatedpo2>{0.5 * (1.013 + d / 10):.3f}</calculatedpo2>"))
for t, d in ramp(2720, 3600, 6, 3):
    extra = '<decostop kind="mandatory" decodepth="6"/>' + ('<switchmix ref="o2"/>' if t == 2720 else "")
    a.append(wp(t, d, extra))
a.append(wp(3620, 0))

# B: rocket ascent after a sawtooth, a fast descent and a hypoxic gas; CNS written as fractions.
b = []
pts = (ramp(0, 40, 0, 26, 10) + [(60, 26), (80, 18), (100, 25), (120, 17), (140, 24), (160, 16), (180, 25)]
       + ramp(200, 900, 25, 25, 50) + ramp(910, 970, 25, 0, 10))
for i, (t, d) in enumerate(pts):
    extra = f"<cns>{0.04 + i * 0.002:.3f}</cns><tankpressure>{(200 - t / 8) * 1e5:.0f}</tankpressure>"
    if t == 0:
        extra += '<switchmix ref="tx1070"/>'
    b.append(wp(t, d, extra))

# C: no date; EAN36 deep in the working phase, heavy breathing, low reserve, NDL near zero.
c = []
for t, d in ramp(0, 120, 0, 33) + ramp(140, 1500, 33, 33, 40) + ramp(1520, 1700, 33, 5) + ramp(1720, 1820, 5, 5) + [(1840, 0)]:
    c.append(wp(t, d, f"<nodecotime>{max(60, 3000 - t * 2)}</nodecotime><cns>{0.6 * t / 1840:.4f}</cns>"))

# E: deco done properly, but a long ascent at 12 m/min.
e = []
for t, dd in ramp(0, 120, 0, 36) + ramp(140, 1400, 36, 36, 40) + ramp(1420, 1540, 36, 12) + ramp(1560, 1620, 12, 6, 10):
    e.append(wp(t, dd, '<decostop kind="mandatory" decodepth="6"/>' if t >= 1420 else ""))
for t, dd in ramp(1640, 2200, 6, 6, 40):
    e.append(wp(t, dd, '<decostop kind="mandatory" decodepth="3"/>'))
e.append(wp(2220, 0))

# D: a pool session with a single sample.
d = [wp(30, 1.2, "<temperature>27</temperature>")]

nl = "\n"
xml = f"""<?xml version="1.0" encoding="ISO-8859-1"?>
<uddf xmlns="http://www.streit.cc/uddf/3.2/" version="3.2.0">
  <generator><name>Fictional edge cases</name><version>1.0</version></generator>
  <gasdefinitions>
    <mix id="tx2135"><name>Tx 21/35</name><o2>0.21</o2><he>0.35</he></mix>
    <mix id="ean50"><name>EAN50</name><o2>0.50</o2></mix>
    <mix id="o2"><name>Oxygen</name><o2>1.0</o2></mix>
    <mix id="tx1070"><name>Tx 10/70</name><o2>0.10</o2><he>0.70</he></mix>
    <mix id="ean36"><o2>0.36</o2></mix>
  </gasdefinitions>
  <divesite>
    <site id="hallstatt"><name>Hallstätter See</name><geography><location>Österreich</location></geography></site>
    <site id="nameless"><geography><location>Somewhere</location></geography></site>
  </divesite>
  <profiledata>
    <repetitiongroup id="rg">
      <dive id="A">
        <informationbeforedive>
          <link ref="hallstatt"/>
          <divenumber> 101 </divenumber>
          <date><year>2026</year><month>8</month><day>2</day></date><time><hour>9</hour><minute>5</minute></time>
        </informationbeforedive>
        <tankdata id="tA1"><link ref="tx2135"/><tankvolume>11.1</tankvolume><tankpressurebegin>21000000</tankpressurebegin><tankpressureend>12000000</tankpressureend></tankdata>
        <tankdata id="tA2"><link ref="ean50"/><tankvolume>0.007</tankvolume><tankpressurebegin>20000000</tankpressurebegin><tankpressureend>9000000</tankpressureend></tankdata>
        <samples>
{nl.join(a)}
        </samples>
        <informationafterdive>
          <greatestdepth>60</greatestdepth><diveduration>3620</diveduration><lowesttemperature>7.5</lowesttemperature>
          <notes><para>Deco on <b>EAN50</b> and oxygen.</para> Ceiling <![CDATA[busted & noted]]></notes>
        </informationafterdive>
      </dive>
      <dive id="B">
        <informationbeforedive><link ref="nameless"/><datetime>2026-07-01T08:30:00.25+02:00</datetime></informationbeforedive>
        <tankdata><link ref="tx1070"/><tankvolume>0.012</tankvolume></tankdata>
        <samples>
{nl.join(b)}
        </samples>
      </dive>
      <dive id="C">
        <informationbeforedive><divenumber>abc</divenumber><datetime>not a date</datetime></informationbeforedive>
        <tankdata><link ref="ean36"/><tankvolume>0.015</tankvolume><tankpressurebegin>23000000</tankpressurebegin><tankpressureend>4000000</tankpressureend></tankdata>
        <samples>
{nl.join(c)}
        </samples>
        <informationafterdive><greatestdepth>33</greatestdepth><diveduration>1840</diveduration></informationafterdive>
      </dive>
      <dive id="E">
        <informationbeforedive><datetime>2026-09-03 14:20</datetime></informationbeforedive>
        <tankdata><link ref="ean36"/></tankdata>
        <samples>
{nl.join(e)}
        </samples>
      </dive>
      <dive id="D">
        <informationbeforedive><datetime>2026-08-30Z</datetime></informationbeforedive>
        <samples>
{nl.join(d)}
        </samples>
      </dive>
    </repetitiongroup>
  </profiledata>
</uddf>
"""
with open(out, "wb") as fh:
    fh.write(xml.replace("\r\n", "\n").encode("iso-8859-1"))
