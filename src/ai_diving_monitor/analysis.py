"""Deterministic dive analytics.

Computes gas consumption, ascent rates, oxygen exposure, safety-stop and deco
compliance, and turns them into findings a diver can act on. This module works
without any AI backend; the agent builds on top of these numbers.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from statistics import mean
from typing import Optional

from .uddf import Dive, GasMix

SURFACE_BAR = 1.013
ASCENT_WARN_M_MIN = 10.0
ASCENT_CRIT_M_MIN = 18.0
PPO2_WORK_LIMIT = 1.4
PPO2_DECO_LIMIT = 1.6
PPO2_HYPOXIC = 0.16
END_LIMIT_M = 30.0
RESERVE_WARN_BAR = 50.0
RESERVE_CRIT_BAR = 30.0
SAFETY_STOP_S = 180
SAWTOOTH_AMPLITUDE_M = 4.0

# NOAA single-exposure CNS limits (ppO2 bar -> minutes)
_NOAA_CNS = [(0.6, 720), (0.7, 570), (0.8, 450), (0.9, 360), (1.0, 300), (1.1, 240),
             (1.2, 210), (1.3, 180), (1.4, 150), (1.5, 120), (1.6, 45)]

SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2, "good": 3}


@dataclass
class Finding:
    severity: str  # critical | warning | info | good
    title: str
    detail: str


@dataclass
class DiveMetrics:
    duration_min: float
    max_depth_m: float
    avg_depth_m: float
    min_temp_c: Optional[float]
    gas_used_l: Optional[float]
    rmv_l_min: Optional[float]  # surface-equivalent respiratory minute volume
    sac_bar_min: Optional[float]  # only for single-tank dives
    end_pressure_bar: Optional[float]
    max_ascent_rate_m_min: float
    avg_ascent_rate_m_min: float
    fast_ascent_seconds: int
    max_descent_rate_m_min: float
    max_ppo2: Optional[float]
    min_ppo2: Optional[float]
    max_end_m: Optional[float]
    cns_percent: float
    otu: float
    safety_stop_s: int
    had_deco: bool
    ceiling_violation_s: int
    min_ndl_min: Optional[float]
    sawtooth_count: int
    gases: list[str]
    alarms: list[str]
    score: int = 100


@dataclass
class DiveAnalysis:
    metrics: DiveMetrics
    findings: list[Finding] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"metrics": asdict(self.metrics), "findings": [asdict(f) for f in self.findings]}


def ambient_bar(depth_m: float) -> float:
    return SURFACE_BAR + max(depth_m, 0.0) / 10.0


def _cns_rate_per_min(ppo2: float) -> float:
    """Percent of CNS clock consumed per minute at the given ppO2."""
    if ppo2 < 0.5:
        return 0.0
    if ppo2 <= _NOAA_CNS[0][0]:
        return 100.0 / _NOAA_CNS[0][1]
    for (p1, m1), (p2, m2) in zip(_NOAA_CNS, _NOAA_CNS[1:]):
        if p1 <= ppo2 <= p2:
            minutes = m1 + (m2 - m1) * (ppo2 - p1) / (p2 - p1)
            return 100.0 / minutes
    # Beyond 1.6 bar the exposure limit collapses quickly; extrapolate harshly.
    return 100.0 / max(5.0, 45.0 - (ppo2 - 1.6) * 200)


def _mix_timeline(dive: Dive) -> list[Optional[GasMix]]:
    """Gas mix breathed at each sample, following gas switches."""
    default = None
    if dive.tanks and dive.tanks[0].mix_id in dive.gas_mixes:
        default = dive.gas_mixes[dive.tanks[0].mix_id]
    elif len(dive.gas_mixes) == 1:
        default = next(iter(dive.gas_mixes.values()))
    current = default
    out: list[Optional[GasMix]] = []
    for s in dive.samples:
        if s.mix_ref and s.mix_ref in dive.gas_mixes:
            current = dive.gas_mixes[s.mix_ref]
        out.append(current)
    return out


def _windowed_rates(times: list[float], depths: list[float], window_s: float = 30.0) -> list[tuple[float, float, float]]:
    """(time, depth, rate m/min) using a trailing window; positive rate = ascending."""
    rates = []
    j = 0
    for i in range(len(times)):
        while times[i] - times[j] > window_s and j < i:
            j += 1
        k = j
        if times[i] - times[k] < window_s / 2 and k > 0:
            k -= 1
        dt = times[i] - times[k]
        rate = (depths[k] - depths[i]) / dt * 60 if dt > 0 else 0.0
        rates.append((times[i], depths[i], rate))
    return rates


def ascent_rate_series(dive: Dive) -> list[tuple[float, float, float]]:
    return _windowed_rates([s.time_s for s in dive.samples], [s.depth_m for s in dive.samples])


def analyze_dive(dive: Dive) -> DiveAnalysis:
    s = dive.samples
    times = [x.time_s for x in s]
    depths = [x.depth_m for x in s]
    duration_min = dive.duration_s / 60.0

    # Time-weighted average depth
    if len(s) >= 2:
        area = sum((times[i + 1] - times[i]) * (depths[i] + depths[i + 1]) / 2 for i in range(len(s) - 1))
        span = times[-1] - times[0]
        avg_depth = area / span if span > 0 else depths[0]
    else:
        avg_depth = dive.max_depth_m / 2

    # Gas consumption
    gas_used_l = None
    sac = None
    end_pressure = None
    usable = [t for t in dive.tanks if t.start_bar and t.end_bar is not None]  # 0 bar at start: not used
    if usable:
        end_pressure = min(t.end_bar for t in usable)
        with_volume = [t for t in usable if t.volume_l]
        if with_volume:
            gas_used_l = sum((t.start_bar - t.end_bar) * t.volume_l for t in with_volume)
        if len(usable) == 1 and duration_min > 0:
            sac = (usable[0].start_bar - usable[0].end_bar) / duration_min / ambient_bar(avg_depth) * SURFACE_BAR
    rmv = None
    if gas_used_l and duration_min > 0:
        rmv = gas_used_l / duration_min / (ambient_bar(avg_depth) / SURFACE_BAR)

    # Ascent / descent
    rates = _windowed_rates(times, depths)
    ascending = [r for _, d, r in rates if r > 0.5 and d > 0.5]
    max_ascent = max((r for _, _, r in rates), default=0.0)
    max_descent = max((-r for _, _, r in rates), default=0.0)
    fast_ascent_s = 0
    for i in range(1, len(rates)):
        if rates[i][2] > ASCENT_WARN_M_MIN and rates[i][1] > 0.5:
            fast_ascent_s += int(times[i] - times[i - 1])

    # Oxygen exposure, END
    mixes = _mix_timeline(dive)
    ppo2s: list[Optional[float]] = []
    max_end = None
    cns = otu = 0.0
    for i, (sample, mix) in enumerate(zip(s, mixes)):
        p = sample.ppo2
        if p is None and mix is not None:
            p = mix.o2 * ambient_bar(sample.depth_m)
        ppo2s.append(p)
        if mix is not None:
            end = (sample.depth_m + 10) * (1 - mix.he) - 10
            max_end = end if max_end is None else max(max_end, end)
        if p is not None and i > 0:
            dt_min = (times[i] - times[i - 1]) / 60
            cns += _cns_rate_per_min(p) * dt_min
            if p > 0.5:
                otu += dt_min * ((p - 0.5) / 0.5) ** 0.83
    computer_cns = [x.cns for x in s if x.cns is not None]
    if computer_cns:
        cns = max(computer_cns)
    known_ppo2 = [p for p in ppo2s if p is not None]
    max_ppo2 = max(known_ppo2) if known_ppo2 else None
    min_ppo2 = min((p for p, d in zip(ppo2s, depths) if p is not None and d > 1), default=None)
    if not any(m is not None and m.he > 0 for m in mixes):
        max_end = None  # END is only interesting for helium mixes

    # Deco & safety stop
    had_deco = any(x.deco_depth_m for x in s)
    ceiling_violation_s = 0
    for i in range(1, len(s)):
        if s[i].deco_depth_m and depths[i] < s[i].deco_depth_m - 0.5:
            ceiling_violation_s += int(times[i] - times[i - 1])
    safety_stop_s = 0
    if s:
        deepest_idx = max(range(len(s)), key=lambda i: depths[i])
        for i in range(deepest_idx + 1, len(s)):
            if 2.5 <= depths[i] <= 6.5:
                safety_stop_s += int(times[i] - times[i - 1])
    ndls = [x.ndl_s / 60 for x in s if x.ndl_s is not None]
    min_ndl = min(ndls) if ndls else None

    sawtooth = _count_sawtooth(depths)
    alarms = sorted({a for x in s for a in x.alarms})
    gases = sorted({m.label for m in mixes if m is not None}) or sorted({m.label for m in dive.gas_mixes.values()})

    metrics = DiveMetrics(
        duration_min=round(duration_min, 1),
        max_depth_m=round(dive.max_depth_m, 1),
        avg_depth_m=round(avg_depth, 1),
        min_temp_c=None if dive.min_temp_c is None else round(dive.min_temp_c, 1),
        gas_used_l=None if gas_used_l is None else round(gas_used_l),
        rmv_l_min=None if rmv is None else round(rmv, 1),
        sac_bar_min=None if sac is None else round(sac, 2),
        end_pressure_bar=None if end_pressure is None else round(end_pressure),
        max_ascent_rate_m_min=round(max_ascent, 1),
        avg_ascent_rate_m_min=round(mean(ascending), 1) if ascending else 0.0,
        fast_ascent_seconds=fast_ascent_s,
        max_descent_rate_m_min=round(max_descent, 1),
        max_ppo2=None if max_ppo2 is None else round(max_ppo2, 2),
        min_ppo2=None if min_ppo2 is None else round(min_ppo2, 2),
        max_end_m=None if max_end is None else round(max_end, 1),
        cns_percent=round(cns, 1),
        otu=round(otu, 1),
        safety_stop_s=safety_stop_s,
        had_deco=had_deco,
        ceiling_violation_s=ceiling_violation_s,
        min_ndl_min=None if min_ndl is None else round(min_ndl, 1),
        sawtooth_count=sawtooth,
        gases=gases,
        alarms=alarms,
    )
    findings = _findings(metrics)
    metrics.score = _score(findings)
    return DiveAnalysis(metrics=metrics, findings=findings)


def _count_sawtooth(depths: list[float]) -> int:
    """Count re-descents of at least SAWTOOTH_AMPLITUDE_M after an ascent of the same size."""
    count = 0
    if not depths:
        return 0
    low = high = depths[0]
    direction = 0  # 1 descending, -1 ascending
    for d in depths[1:]:
        if direction >= 0:
            if d > high:
                high = d
            elif high - d >= SAWTOOTH_AMPLITUDE_M:
                direction, low = -1, d
        else:
            if d < low:
                low = d
            elif d - low >= SAWTOOTH_AMPLITUDE_M and low > 1.0:
                count += 1
                direction, high = 1, d
    return count


def _findings(m: DiveMetrics) -> list[Finding]:
    f: list[Finding] = []

    if m.max_ascent_rate_m_min > ASCENT_CRIT_M_MIN:
        f.append(Finding("critical", "Very fast ascent",
                         f"Peak ascent rate {m.max_ascent_rate_m_min} m/min (limit ~{ASCENT_WARN_M_MIN:.0f} m/min). "
                         "Rapid ascents sharply raise DCS and lung over-expansion risk. Practise buoyancy control with "
                         "a slow, controlled exhale-and-dump technique."))
    elif m.fast_ascent_seconds > 20:
        f.append(Finding("warning", "Ascent faster than recommended",
                         f"{m.fast_ascent_seconds}s spent ascending faster than {ASCENT_WARN_M_MIN:.0f} m/min "
                         f"(peak {m.max_ascent_rate_m_min} m/min). Aim for 9-10 m/min, and slower in the last 6 m."))
    elif m.max_depth_m > 3:
        f.append(Finding("good", "Controlled ascent",
                         f"Ascent rate stayed within limits (peak {m.max_ascent_rate_m_min} m/min)."))

    if m.ceiling_violation_s > 0:
        f.append(Finding("critical", "Deco ceiling violated",
                         f"You were shallower than the required decompression stop for about {m.ceiling_violation_s}s. "
                         "Review your ascent plan and buoyancy at stops."))
    elif m.had_deco:
        f.append(Finding("good", "Decompression completed", "All required deco stops were respected."))

    if not m.had_deco and m.max_depth_m >= 10:
        if m.safety_stop_s >= SAFETY_STOP_S:
            f.append(Finding("good", "Safety stop done", f"{m.safety_stop_s // 60} min {m.safety_stop_s % 60}s between 3-6 m."))
        else:
            f.append(Finding("warning", "Short or missing safety stop",
                             f"Only {m.safety_stop_s}s between 3-6 m on the way up. A 3-minute stop at ~5 m is strongly recommended."))

    if m.max_ppo2 is not None:
        limit = PPO2_DECO_LIMIT if m.had_deco else PPO2_WORK_LIMIT
        if m.max_ppo2 > PPO2_DECO_LIMIT:
            f.append(Finding("critical", "ppO2 above 1.6 bar",
                             f"Max ppO2 {m.max_ppo2} bar - CNS oxygen toxicity risk. Check MOD of every gas before switching."))
        elif m.max_ppo2 > limit:
            f.append(Finding("warning", "High ppO2 during working phase",
                             f"Max ppO2 {m.max_ppo2} bar exceeds {PPO2_WORK_LIMIT} bar recommended for the bottom phase."))
    if m.min_ppo2 is not None and m.min_ppo2 < PPO2_HYPOXIC:
        f.append(Finding("critical", "Hypoxic gas breathed",
                         f"ppO2 dropped to {m.min_ppo2} bar. Never breathe a hypoxic mix shallower than its minimum operating depth."))

    if m.cns_percent >= 80:
        f.append(Finding("critical", "CNS oxygen loading very high", f"CNS ~{m.cns_percent}%. Keep below 80%; plan longer surface intervals."))
    elif m.cns_percent >= 50:
        f.append(Finding("warning", "Elevated CNS oxygen loading", f"CNS ~{m.cns_percent}%. Monitor cumulative exposure on repetitive days."))

    if m.max_end_m is not None and m.max_end_m > END_LIMIT_M:
        f.append(Finding("warning", "High narcotic depth (END)",
                         f"Equivalent narcotic depth reached {m.max_end_m} m. Consider more helium for this depth."))

    if m.end_pressure_bar is not None:
        if m.end_pressure_bar < RESERVE_CRIT_BAR:
            f.append(Finding("critical", "Surfaced with almost empty tank",
                             f"Lowest tank ended at {m.end_pressure_bar} bar. Plan rock-bottom gas and turn pressures before the dive."))
        elif m.end_pressure_bar < RESERVE_WARN_BAR:
            f.append(Finding("warning", "Low gas reserve",
                             f"Lowest tank ended at {m.end_pressure_bar} bar. Aim to surface with at least {RESERVE_WARN_BAR:.0f} bar."))

    if m.rmv_l_min is not None:
        if m.rmv_l_min > 25:
            f.append(Finding("warning", "High gas consumption",
                             f"RMV {m.rmv_l_min} L/min. Work on relaxed breathing, trim and finning efficiency; check for leaks."))
        elif m.rmv_l_min < 15:
            f.append(Finding("good", "Efficient breathing", f"RMV {m.rmv_l_min} L/min is very economical."))

    if m.min_ndl_min is not None and not m.had_deco and m.min_ndl_min < 3:
        f.append(Finding("warning", "Close to no-deco limit", f"NDL dropped to {m.min_ndl_min} min."))

    if m.sawtooth_count >= 3:
        f.append(Finding("warning", "Sawtooth profile",
                         f"{m.sawtooth_count} repeated ascents/descents of 4 m or more. Yo-yo profiles increase DCS risk."))

    if m.max_descent_rate_m_min > 30:
        f.append(Finding("info", "Fast descent",
                         f"Peak descent rate {m.max_descent_rate_m_min} m/min. Equalise early and keep the descent controlled."))

    for alarm in m.alarms:
        f.append(Finding("warning", "Dive computer alarm", f"Your computer logged the alarm: {alarm}."))

    f.sort(key=lambda x: SEVERITY_ORDER[x.severity])
    return f


def _score(findings: list[Finding]) -> int:
    penalty = {"critical": 25, "warning": 10, "info": 2, "good": 0}
    return max(0, 100 - sum(penalty[x.severity] for x in findings))


# ---------------------------------------------------------------------------
# History / progress
# ---------------------------------------------------------------------------

PROGRESS_METRICS = {
    "rmv_l_min": ("Gas consumption (RMV, L/min)", "lower"),
    "sac_bar_min": ("SAC (bar/min)", "lower"),
    "max_ascent_rate_m_min": ("Peak ascent rate (m/min)", "lower"),
    "fast_ascent_seconds": ("Time ascending too fast (s)", "lower"),
    "score": ("Dive quality score", "higher"),
    "safety_stop_s": ("Safety stop time (s)", "higher"),
    "max_depth_m": ("Max depth (m)", "neutral"),
    "duration_min": ("Duration (min)", "neutral"),
}


def _slope(values: list[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    xs = range(n)
    mx, my = (n - 1) / 2, mean(values)
    den = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, values)) / den if den else 0.0


def trend(history: list[dict], metric: str) -> Optional[dict]:
    """Summarise how a metric evolved over chronologically ordered dives."""
    values = [h[metric] for h in history if h.get(metric) is not None]
    if len(values) < 3:
        return None
    label, better = PROGRESS_METRICS.get(metric, (metric, "neutral"))
    half = max(1, len(values) // 2)
    early, recent = mean(values[:half]), mean(values[-half:])
    change_pct = (recent - early) / early * 100 if early else 0.0
    slope = _slope(values)
    if better == "neutral" or abs(change_pct) < 5:
        verdict = "stable"
    elif (change_pct < 0) == (better == "lower"):
        verdict = "improving"
    else:
        verdict = "worsening"
    return {
        "metric": metric,
        "label": label,
        "dives": len(values),
        "early_avg": round(early, 2),
        "recent_avg": round(recent, 2),
        "change_pct": round(change_pct, 1),
        "slope_per_dive": round(slope, 3),
        "best": round(min(values) if better == "lower" else max(values), 2),
        "verdict": verdict,
    }


def progress_insights(history: list[dict]) -> list[Finding]:
    """Plain-language progress notes from the whole dive log."""
    out: list[Finding] = []
    if len(history) < 3:
        out.append(Finding("info", "Not enough history yet",
                           "Import at least 3 dives to unlock progress tracking."))
        return out
    for metric in ("rmv_l_min", "max_ascent_rate_m_min", "fast_ascent_seconds", "score", "safety_stop_s"):
        t = trend(history, metric)
        if not t or t["verdict"] == "stable":
            continue
        sev = "good" if t["verdict"] == "improving" else "warning"
        out.append(Finding(sev, f"{t['label']}: {t['verdict']}",
                           f"Average went from {t['early_avg']} to {t['recent_avg']} ({t['change_pct']:+}%) "
                           f"across {t['dives']} logged dives."))
    recurring: dict[str, int] = {}
    window = history[-6:]
    for h in window:
        for title in h.get("finding_titles", []):
            recurring[title] = recurring.get(title, 0) + 1
    for title, count in sorted(recurring.items(), key=lambda kv: -kv[1]):
        if count >= 3 and title not in {"Controlled ascent", "Safety stop done", "Efficient breathing", "Decompression completed"}:
            out.append(Finding("warning", f"Recurring issue: {title}",
                               f"Appeared in {count} of your last {len(window)} dives. Make it a focus for your next dives."))
    if not out:
        out.append(Finding("info", "Consistent performance", "Your key metrics are stable across your logged dives."))
    return out
