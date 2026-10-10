"""AI dive coach built on Claude with tool use.

The agent never sees raw files directly. Instead it calls tools that expose
the parsed dive log and the deterministic analytics, so its advice is grounded
in your actual numbers and your history.
"""

from __future__ import annotations

import json
import os
from typing import Optional

import anthropic
from anthropic import beta_tool

from .analysis import PROGRESS_METRICS, analyze_dive, trend
from .storage import DiveStore

MODEL = os.environ.get("AI_DIVING_MONITOR_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("AI_DIVING_MONITOR_EFFORT", "medium")

SYSTEM_PROMPT = """You are an experienced technical diving instructor acting as a personal dive coach.
You review dives recorded by the diver's dive computer (imported from UDDF files) and help them
become a safer, more efficient diver.

Ground every statement in data from your tools. Fetch the dive analysis first, look at the depth
profile when the shape of the dive matters (ascents, stops, sawtooth patterns), and compare against
the diver's history and progress trends before giving advice. Quote concrete numbers with units
(m, min, bar, L/min, m/min). If data is missing (e.g. no tank pressure), say so instead of guessing.

Safety matters more than flattery: clearly call out ascent-rate problems, missed stops, deco ceiling
violations, ppO2/CNS issues and low gas reserves. Equally, recognise real improvements. Keep the tone
supportive and practical, and give specific drills or habits the diver can work on. You are not a
substitute for medical advice: if the data suggests a possible DCS-risk event, recommend that the
diver watch for symptoms and contact DAN or a hyperbaric physician if any appear.

Write in English, formatted in Markdown, concise enough to read on a phone."""

SUMMARY_REQUEST = """Review dive #{dive_id} for me. Structure the answer as:

### Dive summary
2-3 sentences on what this dive was (depth, time, gases, conditions).

### What went well

### What to watch
Ordered by safety impact.

### Compared with your history
How this dive compares with my earlier dives and where I am progressing or slipping.

### Focus for your next dive
1-3 concrete, actionable points."""


class AgentUnavailable(RuntimeError):
    pass


def _client() -> anthropic.Anthropic:
    try:
        return anthropic.Anthropic()
    except anthropic.AnthropicError as exc:  # missing credentials
        raise AgentUnavailable(
            "No Anthropic credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`) to enable the AI coach."
        ) from exc


def build_tools(store: DiveStore) -> list:
    @beta_tool
    def list_dives() -> str:
        """List every dive in the diver's log in chronological order with headline metrics
        (date, site, max depth, duration, RMV gas consumption, peak ascent rate, quality score, issues)."""
        rows = store.list_dives()
        keys = ("id", "seq", "start", "site", "max_depth_m", "duration_min", "rmv_l_min", "sac_bar_min",
                "max_ascent_rate_m_min", "safety_stop_s", "had_deco", "gases", "score", "finding_titles")
        return json.dumps([{k: r.get(k) for k in keys} for r in rows])

    @beta_tool
    def get_dive_analysis(dive_id: int) -> str:
        """Get full metrics and rule-based findings for one dive: gas consumption, ascent/descent rates,
        ppO2, CNS%, OTU, END, safety stop / deco compliance, sawtooth count, computer alarms.

        Args:
            dive_id: The dive id from list_dives.
        """
        dive = store.get_dive(dive_id)
        if dive is None:
            return json.dumps({"error": f"Dive {dive_id} not found"})
        analysis = store.get_analysis(dive_id) or analyze_dive(dive).to_dict()
        info = {
            "id": dive_id,
            "start": dive.start.isoformat() if dive.start else None,
            "site": dive.site,
            "location": dive.location,
            "computer": dive.computer,
            "notes": dive.notes,
            "tanks": [
                {"volume_l": t.volume_l, "start_bar": t.start_bar, "end_bar": t.end_bar,
                 "gas": dive.gas_mixes[t.mix_id].label if t.mix_id in dive.gas_mixes else None}
                for t in dive.tanks
            ],
        }
        return json.dumps({**info, **analysis})

    @beta_tool
    def get_dive_profile(dive_id: int, interval_s: int = 30) -> str:
        """Get the depth profile of a dive, downsampled to one point per interval: time (min), depth (m),
        temperature (C), tank pressure (bar), deco stop depth and gas switches.

        Args:
            dive_id: The dive id from list_dives.
            interval_s: Seconds between returned points (minimum 10).
        """
        dive = store.get_dive(dive_id)
        if dive is None:
            return json.dumps({"error": f"Dive {dive_id} not found"})
        interval_s = max(10, interval_s)
        points, next_t = [], 0.0
        for s in dive.samples:
            if s.time_s >= next_t or s.mix_ref:
                p = {"t_min": round(s.time_s / 60, 1), "depth_m": round(s.depth_m, 1)}
                if s.temp_c is not None:
                    p["temp_c"] = round(s.temp_c, 1)
                if s.pressure_bar is not None:
                    p["tank_bar"] = round(s.pressure_bar)
                if s.deco_depth_m:
                    p["deco_stop_m"] = s.deco_depth_m
                if s.mix_ref and s.mix_ref in dive.gas_mixes:
                    p["gas"] = dive.gas_mixes[s.mix_ref].label
                points.append(p)
                next_t = s.time_s + interval_s
        return json.dumps(points)

    @beta_tool
    def get_progress_trend(metric: str) -> str:
        """Compare the diver's early vs recent dives for one metric and say whether it is improving.

        Args:
            metric: One of rmv_l_min, sac_bar_min, max_ascent_rate_m_min, fast_ascent_seconds, score,
                safety_stop_s, max_depth_m, duration_min.
        """
        if metric not in PROGRESS_METRICS:
            return json.dumps({"error": f"Unknown metric. Use one of: {', '.join(PROGRESS_METRICS)}"})
        result = trend(store.list_dives(), metric)
        return json.dumps(result or {"error": "Need at least 3 dives with this metric"})

    return [list_dives, get_dive_analysis, get_dive_profile, get_progress_trend]


def run_agent(store: DiveStore, messages: list[dict]) -> str:
    """Run the tool-use loop and return the final Markdown answer."""
    client = _client()
    runner = client.beta.messages.tool_runner(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM_PROMPT,
        tools=build_tools(store),
        messages=messages,
        output_config={"effort": EFFORT},
        # Retry on another model automatically if a request is declined by safety classifiers.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )
    final = None
    for message in runner:
        final = message
    if final is None:
        return "The coach did not return an answer."
    if final.stop_reason == "refusal":
        return "The AI coach declined to answer this request."
    text = "\n".join(b.text for b in final.content if b.type == "text").strip()
    if final.stop_reason == "max_tokens":
        text += "\n\n_(Answer truncated.)_"
    return text or "The coach did not return any text."


def summarize_dive(store: DiveStore, dive_id: int) -> str:
    text = run_agent(store, [{"role": "user", "content": SUMMARY_REQUEST.format(dive_id=dive_id)}])
    store.save_summary(dive_id, text)
    return text


def ask_coach(store: DiveStore, question: str, history: Optional[list[dict]] = None,
              dive_id: Optional[int] = None) -> str:
    """Free-form question about the dive log. `history` holds earlier user/assistant text turns."""
    content = question if dive_id is None else f"(Currently viewing dive #{dive_id}.) {question}"
    return run_agent(store, list(history or []) + [{"role": "user", "content": content}])


def describe_api_error(exc: Exception) -> str:
    if isinstance(exc, AgentUnavailable):
        return str(exc)
    if isinstance(exc, anthropic.AuthenticationError):
        return "Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY."
    if isinstance(exc, anthropic.RateLimitError):
        return "Rate limited by the Anthropic API. Please try again in a minute."
    if isinstance(exc, anthropic.APIStatusError):
        return f"Anthropic API error ({exc.status_code}): {exc.message}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "Could not reach the Anthropic API. Check your internet connection."
    return f"Unexpected error: {exc}"
