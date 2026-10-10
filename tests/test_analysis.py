from ai_diving_monitor.analysis import analyze_dive, progress_insights, trend
from ai_diving_monitor.uddf import Dive, GasMix, Sample, Tank


def make_dive(points, o2=0.21, he=0.0, tank=(12, 200, 80), deco=None):
    samples = [Sample(time_s=t, depth_m=d, deco_depth_m=(deco or {}).get(t)) for t, d in points]
    return Dive(uddf_id="x", number=1, start=None, site=None, location=None,
                max_depth_m=max(d for _, d in points), duration_s=points[-1][0], min_temp_c=None, notes=None,
                gas_mixes={"m": GasMix("m", "gas", o2, he)},
                tanks=[Tank("t", "m", *tank)], samples=samples)


def ramp(t0, t1, d0, d1, step=10):
    return [(t, d0 + (d1 - d0) * (t - t0) / (t1 - t0)) for t in range(t0, t1 + 1, step)]


def good_dive():
    pts = ramp(0, 120, 0, 20) + ramp(130, 1800, 20, 20)[0:] + ramp(1810, 1900, 20, 5) \
        + ramp(1910, 2100, 5, 5) + ramp(2110, 2140, 5, 0)
    return make_dive(pts)


def titles(analysis):
    return [f.title for f in analysis.findings]


def test_good_dive_has_no_problems():
    a = analyze_dive(good_dive())
    assert a.metrics.max_ascent_rate_m_min <= 10.5
    assert a.metrics.safety_stop_s >= 180
    assert "Safety stop done" in titles(a)
    assert not [f for f in a.findings if f.severity in ("critical", "warning")]
    assert a.metrics.score == 100
    assert 10 < a.metrics.rmv_l_min < 40


def test_rocket_ascent_without_stop_is_critical():
    pts = ramp(0, 120, 0, 25) + ramp(130, 1500, 25, 25) + ramp(1510, 1570, 25, 0)
    a = analyze_dive(make_dive(pts))
    assert a.metrics.max_ascent_rate_m_min > 18
    assert "Very fast ascent" in titles(a)
    assert "Short or missing safety stop" in titles(a)
    assert a.metrics.score < 70


def test_high_ppo2_and_low_gas():
    pts = ramp(0, 120, 0, 40) + ramp(130, 900, 40, 40) + ramp(910, 1300, 40, 5) + ramp(1310, 1500, 5, 5) + ramp(1510, 1540, 5, 0)
    a = analyze_dive(make_dive(pts, o2=0.36, tank=(12, 200, 25)))
    assert a.metrics.max_ppo2 > 1.6
    assert "ppO2 above 1.6 bar" in titles(a)
    assert "Surfaced with almost empty tank" in titles(a)


def test_deco_ceiling_violation():
    pts = ramp(0, 120, 0, 40) + ramp(130, 1200, 40, 40) + ramp(1210, 1500, 40, 3) + ramp(1510, 1800, 3, 3) + [(1810, 0)]
    deco = {t: 6.0 for t, _ in pts if t >= 1210 and t <= 1800}
    a = analyze_dive(make_dive(pts, o2=0.21, he=0.35, deco=deco))
    assert a.metrics.had_deco
    assert a.metrics.ceiling_violation_s > 0
    assert "Deco ceiling violated" in titles(a)


def test_progress_trend_detects_improving_rmv():
    history = [{"rmv_l_min": v, "finding_titles": []} for v in (24, 23, 21, 19, 17, 16)]
    t = trend(history, "rmv_l_min")
    assert t["verdict"] == "improving"
    assert any("Gas consumption" in f.title and f.severity == "good" for f in progress_insights(history))


def test_progress_needs_history():
    assert progress_insights([{}])[0].title == "Not enough history yet"
