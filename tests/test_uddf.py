from pathlib import Path

import pytest

from ai_diving_monitor.uddf import UDDFParseError, parse_uddf

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"

MINIMAL = b"""<?xml version="1.0"?>
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
</uddf>"""


def test_parses_minimal_file_and_converts_units():
    (dive,) = parse_uddf(MINIMAL)
    assert dive.number == 7
    assert dive.site == "Reef" and dive.location == "Red Sea"
    assert dive.start.isoformat() == "2026-01-02T09:30:00"
    assert dive.max_depth_m == 15
    assert dive.duration_s == 720
    assert dive.min_temp_c == pytest.approx(23.0)
    tank = dive.tanks[0]
    assert tank.volume_l == pytest.approx(12)
    assert tank.start_bar == pytest.approx(200) and tank.end_bar == pytest.approx(70)
    assert dive.gas_mixes["m1"].label == "EAN32"


def test_rejects_non_uddf():
    with pytest.raises(UDDFParseError):
        parse_uddf(b"<html></html>")
    with pytest.raises(UDDFParseError):
        parse_uddf(b"not xml")


def test_sample_files_parse():
    dives = [d for p in sorted(EXAMPLES.glob("*.uddf")) for d in parse_uddf(p.read_bytes())]
    assert len(dives) == 9
    assert all(d.samples for d in dives)
    assert len({d.fingerprint for d in dives}) == 9


def test_roundtrip_dict():
    (dive,) = parse_uddf(MINIMAL)
    from ai_diving_monitor.uddf import Dive

    assert Dive.from_dict(dive.to_dict()) == dive
