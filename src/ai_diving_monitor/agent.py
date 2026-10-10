"""AI dive coach built on Claude with tool use.

The agent never sees raw files directly. Instead it calls tools that expose
the parsed dive log and the deterministic analytics, so its advice is grounded
in your actual numbers and your history.
"""

from __future__ import annotations

import os
from typing import Optional

import anthropic
from anthropic import beta_tool

from .storage import DiveStore
from .tools import SUMMARY_REQUEST, SYSTEM_PROMPT, DiveTools

MODEL = os.environ.get("AI_DIVING_MONITOR_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("AI_DIVING_MONITOR_EFFORT", "medium")


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
    t = DiveTools(store)

    @beta_tool
    def list_dives() -> str:
        """List every dive in the diver's log in chronological order with headline metrics
        (date, site, max depth, duration, RMV gas consumption, peak ascent rate, quality score, issues)."""
        return t.list_dives()

    @beta_tool
    def get_dive_analysis(dive_id: int) -> str:
        """Get full metrics and rule-based findings for one dive: gas consumption, ascent/descent rates,
        ppO2, CNS%, OTU, END, safety stop / deco compliance, sawtooth count, computer alarms.

        Args:
            dive_id: The dive id from list_dives.
        """
        return t.get_dive_analysis(dive_id)

    @beta_tool
    def get_dive_profile(dive_id: int, interval_s: int = 30) -> str:
        """Get the depth profile of a dive, downsampled to one point per interval: time (min), depth (m),
        temperature (C), tank pressure (bar), deco stop depth and gas switches.

        Args:
            dive_id: The dive id from list_dives.
            interval_s: Seconds between returned points (minimum 10).
        """
        return t.get_dive_profile(dive_id, interval_s)

    @beta_tool
    def get_progress_trend(metric: str) -> str:
        """Compare the diver's early vs recent dives for one metric and say whether it is improving.

        Args:
            metric: One of rmv_l_min, sac_bar_min, max_ascent_rate_m_min, fast_ascent_seconds, score,
                safety_stop_s, max_depth_m, duration_min.
        """
        return t.get_progress_trend(metric)

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
