"""Plotly figures for dive profiles and progress tracking."""

from __future__ import annotations

from statistics import mean
from typing import Optional

import plotly.graph_objects as go
from plotly.subplots import make_subplots

from .analysis import ASCENT_WARN_M_MIN, PPO2_DECO_LIMIT, PPO2_WORK_LIMIT, ambient_bar, ascent_rate_series, _mix_timeline
from .uddf import Dive

# Validated categorical slots + reserved status colours.
BLUE = "#2a78d6"
ORANGE = "#eb6834"
AQUA = "#1baf7a"
VIOLET = "#4a3aa7"
MUTED = "#898781"
STATUS = {"good": "#0ca30c", "warning": "#fab219", "serious": "#ec835a", "critical": "#d03b3b", "info": BLUE}


def _style(fig: go.Figure, height: int) -> go.Figure:
    fig.update_layout(
        height=height,
        margin=dict(l=10, r=10, t=40, b=10),
        hovermode="x unified",
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        font=dict(family='system-ui, -apple-system, "Segoe UI", sans-serif'),
    )
    fig.update_xaxes(showgrid=True, gridcolor="rgba(137,135,129,0.2)", zeroline=False)
    fig.update_yaxes(showgrid=True, gridcolor="rgba(137,135,129,0.2)", zeroline=False)
    return fig


def dive_profile(dive: Dive) -> go.Figure:
    """Stacked small multiples sharing the time axis: depth, tank pressure, ppO2, temperature."""
    samples = dive.samples
    t = [s.time_s / 60 for s in samples]
    has_pressure = any(s.pressure_bar is not None for s in samples)
    has_temp = any(s.temp_c is not None for s in samples)

    rows = [("Depth (m)", 0.5)]
    if has_pressure:
        rows.append(("Tank pressure (bar)", 0.17))
    rows.append(("ppO2 (bar)", 0.17))
    if has_temp:
        rows.append(("Temperature (°C)", 0.16))
    fig = make_subplots(rows=len(rows), cols=1, shared_xaxes=True, vertical_spacing=0.05,
                        row_heights=[h for _, h in rows], subplot_titles=[n for n, _ in rows])
    row = 1

    depth = [s.depth_m for s in samples]
    fig.add_trace(go.Scatter(x=t, y=depth, name="Depth", mode="lines", line=dict(color=BLUE, width=2),
                             fill="tozeroy", fillcolor="rgba(42,120,214,0.12)",
                             hovertemplate="%{y:.1f} m"), row=row, col=1)
    deco = [s.deco_depth_m if s.deco_depth_m else None for s in samples]
    if any(deco):
        fig.add_trace(go.Scatter(x=t, y=deco, name="Deco ceiling", mode="lines",
                                 line=dict(color=VIOLET, width=2, dash="dash"),
                                 hovertemplate="ceiling %{y:.0f} m"), row=row, col=1)
    rates = ascent_rate_series(dive)
    fast = [(tt / 60, d, r) for tt, d, r in rates if r > ASCENT_WARN_M_MIN and d > 0.5]
    if fast:
        fig.add_trace(go.Scatter(x=[f[0] for f in fast], y=[f[1] for f in fast], name="Ascent > 10 m/min",
                                 mode="markers",
                                 marker=dict(color=STATUS["critical"], size=8, symbol="triangle-up",
                                             line=dict(color="white", width=1)),
                                 customdata=[f[2] for f in fast],
                                 hovertemplate="⚠ ascent %{customdata:.1f} m/min"), row=row, col=1)
    switches = [(s.time_s / 60, s.depth_m, dive.gas_mixes[s.mix_ref].label)
                for i, s in enumerate(samples) if i > 0 and s.mix_ref in dive.gas_mixes]
    for x, y, label in switches:
        fig.add_annotation(x=x, y=y, text=f"→ {label}", showarrow=True, arrowhead=0, ax=30, ay=-25,
                           font=dict(size=11), row=row, col=1)
    fig.update_yaxes(autorange="reversed", title_text="m", row=row, col=1)
    row += 1

    if has_pressure:
        pts = [(s.time_s / 60, s.pressure_bar) for s in samples if s.pressure_bar is not None]
        fig.add_trace(go.Scatter(x=[p[0] for p in pts], y=[p[1] for p in pts], name="Tank pressure",
                                 mode="lines", line=dict(color=ORANGE, width=2),
                                 hovertemplate="%{y:.0f} bar"), row=row, col=1)
        fig.update_yaxes(title_text="bar", row=row, col=1)
        row += 1

    mixes = _mix_timeline(dive)
    ppo2 = [s.ppo2 if s.ppo2 is not None else (m.o2 * ambient_bar(s.depth_m) if m else None)
            for s, m in zip(samples, mixes)]
    fig.add_trace(go.Scatter(x=t, y=ppo2, name="ppO2", mode="lines", line=dict(color=AQUA, width=2),
                             hovertemplate="%{y:.2f} bar"), row=row, col=1)
    for limit, label, pos in ((PPO2_WORK_LIMIT, "1.4 working limit", "bottom right"),
                              (PPO2_DECO_LIMIT, "1.6 deco limit", "top right")):
        fig.add_hline(y=limit, line=dict(color=STATUS["critical"] if limit > 1.5 else STATUS["serious"],
                                         width=1, dash="dot"),
                      annotation_text=label, annotation_position=pos, annotation_font_size=11, row=row, col=1)
    fig.update_yaxes(title_text="bar", row=row, col=1)
    row += 1

    if has_temp:
        pts = [(s.time_s / 60, s.temp_c) for s in samples if s.temp_c is not None]
        fig.add_trace(go.Scatter(x=[p[0] for p in pts], y=[p[1] for p in pts], name="Temperature",
                                 mode="lines", line=dict(color=VIOLET, width=2),
                                 hovertemplate="%{y:.1f} °C"), row=row, col=1)
        fig.update_yaxes(title_text="°C", row=row, col=1)

    fig.update_xaxes(title_text="Dive time (min)", row=len(rows), col=1)
    return _style(fig, 300 + 160 * (len(rows) - 1))


def _rolling(values: list[Optional[float]], window: int = 3) -> list[Optional[float]]:
    out = []
    for i in range(len(values)):
        win = [v for v in values[max(0, i - window + 1): i + 1] if v is not None]
        out.append(round(mean(win), 2) if win else None)
    return out


def progress_line(history: list[dict], metric: str, title: str, unit: str,
                  limit: Optional[float] = None, limit_label: str = "", lower_is_better: bool = True) -> go.Figure:
    """One metric over the dive log, with a 3-dive rolling average to show the trend."""
    x = [h["start"][:10] if h.get("start") else f"#{h['seq']}" for h in history]
    y = [h.get(metric) for h in history]
    sites = [h.get("site") or "" for h in history]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=x, y=y, name="Per dive", mode="markers",
                             marker=dict(color=BLUE, size=9, opacity=0.55),
                             customdata=sites, hovertemplate=f"%{{y}} {unit}<br>%{{customdata}}<extra>Dive</extra>"))
    fig.add_trace(go.Scatter(x=x, y=_rolling(y), name="Trend (3-dive average)", mode="lines",
                             line=dict(color=BLUE, width=2.5, shape="spline"),
                             hovertemplate=f"%{{y}} {unit}<extra>Trend</extra>"))
    if limit is not None:
        fig.add_hline(y=limit, line=dict(color=STATUS["critical"], width=1, dash="dot"),
                      annotation_text=limit_label, annotation_position="top left")
    hint = "lower is better" if lower_is_better else "higher is better"
    fig.update_layout(title=dict(text=f"{title} <span style='font-size:12px;color:{MUTED}'>({hint})</span>"))
    fig.update_yaxes(title_text=unit)
    fig.update_xaxes(type="category")
    _style(fig, 340)
    fig.update_layout(legend=dict(orientation="h", yanchor="top", y=-0.18, xanchor="left", x=0))
    return fig


def score_bars(history: list[dict]) -> go.Figure:
    x = [h["start"][:10] if h.get("start") else f"#{h['seq']}" for h in history]
    y = [h["score"] for h in history]
    colors = [STATUS["good"] if v >= 85 else STATUS["warning"] if v >= 60 else STATUS["critical"] for v in y]
    fig = go.Figure(go.Bar(x=x, y=y, marker=dict(color=colors, cornerradius=4),
                           customdata=[", ".join(h.get("finding_titles", [])[:3]) for h in history],
                           hovertemplate="Score %{y}<br>%{customdata}<extra></extra>"))
    fig.add_trace(go.Scatter(x=x, y=_rolling(y), name="Trend", mode="lines",
                             line=dict(color=BLUE, width=2.5, shape="spline")))
    fig.update_layout(title="Dive quality score <span style='font-size:12px;color:#898781'>(higher is better)</span>",
                      showlegend=False, bargap=0.35)
    fig.update_yaxes(range=[0, 105])
    fig.update_xaxes(type="category")
    return _style(fig, 320)
