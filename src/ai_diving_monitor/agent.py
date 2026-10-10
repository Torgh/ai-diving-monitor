"""AI dive coach with tool use, on Claude or on an OpenAI-compatible provider
(ChatGPT, Gemini, DeepSeek, GitHub Copilot).

The agent never sees raw files directly. Instead it calls tools that expose
the parsed dive log and the deterministic analytics, so its advice is grounded
in your actual numbers and your history.
"""

from __future__ import annotations

import json
import os
from typing import Optional

import anthropic
import openai
from anthropic import beta_tool

from . import providers
from .providers import Provider
from .storage import DiveStore
from .tools import COACH_TOOL_PARAMETERS, DESCRIPTIONS, SUMMARY_REQUEST, SYSTEM_PROMPT, DiveTools, call_coach_tool

EFFORT = os.environ.get("AI_DIVING_MONITOR_EFFORT", "medium")
MAX_TOOL_ROUNDS = 25


class AgentUnavailable(RuntimeError):
    pass


def _client() -> anthropic.Anthropic:
    try:
        return anthropic.Anthropic(api_key=providers.saved_key("anthropic"))
    except anthropic.AnthropicError as exc:  # missing credentials
        raise AgentUnavailable(
            "No Anthropic credentials found. Add an API key in Settings or set ANTHROPIC_API_KEY "
            "to enable the AI coach."
        ) from exc


def _openai_client(provider: Provider) -> openai.OpenAI:
    key = providers.api_key(provider.id)
    if not key:
        raise AgentUnavailable(
            f"No API key for {provider.name}. Add one in Settings or set {' / '.join(provider.env_vars)}."
        )
    return openai.OpenAI(api_key=key, base_url=provider.base_url)


def list_models(provider_id: str) -> list[str]:
    """Model ids the provider's API offers to this key (raises on API errors)."""
    provider = providers.PROVIDERS[provider_id]
    if provider.base_url is None:
        return sorted(m.id for m in _client().models.list())
    ids = sorted(m.id for m in _openai_client(provider).models.list())
    return [i.removeprefix("models/") for i in ids]  # Gemini prefixes ids with "models/"


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


def run_agent(store: DiveStore, messages: list[dict], provider_id: Optional[str] = None,
              model: Optional[str] = None) -> str:
    """Run the tool-use loop on the selected provider and return the final Markdown answer."""
    provider, default_model = providers.selected()
    if provider_id and provider_id != provider.id:
        provider = providers.PROVIDERS[provider_id]
        default_model = provider.models[0]
    model = model or default_model
    if not provider.uses_api:
        raise AgentUnavailable(
            f"{provider.name} runs outside this app: ask for the review there (see Settings), "
            "or pick an API provider in Settings."
        )
    if provider.base_url is None:
        return _run_claude(store, messages, model)
    return _run_openai_compatible(store, messages, provider, model)


def _run_claude(store: DiveStore, messages: list[dict], model: str) -> str:
    client = _client()
    runner = client.beta.messages.tool_runner(
        model=model,
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


def openai_tool_definitions() -> list[dict]:
    return [{"type": "function", "function": {"name": name, "description": DESCRIPTIONS[name], "parameters": params}}
            for name, params in COACH_TOOL_PARAMETERS.items()]


def _run_openai_compatible(store: DiveStore, messages: list[dict], provider: Provider, model: str,
                           client: Optional[openai.OpenAI] = None) -> str:
    client = client or _openai_client(provider)
    tools = DiveTools(store)
    convo: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}] + list(messages)
    for _ in range(MAX_TOOL_ROUNDS):
        response = client.chat.completions.create(model=model, messages=convo, tools=openai_tool_definitions())
        choice = response.choices[0]
        message = choice.message
        if not message.tool_calls:
            if choice.finish_reason == "content_filter":
                return "The AI coach declined to answer this request."
            text = (message.content or "").strip()
            if choice.finish_reason == "length":
                text += "\n\n_(Answer truncated.)_"
            return text or "The coach did not return any text."
        # Keep provider-specific fields (e.g. DeepSeek reasoning, Gemini thought signatures) in the history.
        convo.append(message.model_dump(exclude_none=True))
        for call in message.tool_calls:
            try:
                args = json.loads(call.function.arguments or "{}")
            except ValueError:
                args = None
            result = (call_coach_tool(tools, call.function.name, args) if isinstance(args, dict)
                      else json.dumps({"error": "Tool arguments were not valid JSON"}))
            convo.append({"role": "tool", "tool_call_id": call.id, "content": result})
    return "The coach used too many tool calls without finishing its answer. Please try again."


def summarize_dive(store: DiveStore, dive_id: int, provider_id: Optional[str] = None,
                   model: Optional[str] = None) -> str:
    text = run_agent(store, [{"role": "user", "content": SUMMARY_REQUEST.format(dive_id=dive_id)}],
                     provider_id, model)
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
    name = providers.selected()[0].name
    for sdk in (anthropic, openai):
        if isinstance(exc, sdk.AuthenticationError):
            return f"Your {name} API key was rejected. Check it in Settings."
        if isinstance(exc, sdk.RateLimitError):
            return f"Rate limited by the {name} API. Please try again in a minute."
        if isinstance(exc, sdk.NotFoundError):
            return f"{name} could not find this model ({exc.message}). Pick another model in Settings."
        if isinstance(exc, sdk.APIStatusError):
            return f"{name} API error ({exc.status_code}): {exc.message}"
        if isinstance(exc, sdk.APIConnectionError):
            return f"Could not reach the {name} API. Check your internet connection."
    return f"Unexpected error: {exc}"
