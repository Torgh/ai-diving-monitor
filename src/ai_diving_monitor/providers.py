"""AI providers for the dive coach and the local settings file that stores the user's choice.

Claude goes through the Anthropic SDK, ChatGPT through the `openai` SDK (Chat Completions).

The "Claude Pro/Max plan" and "ChatGPT Plus/Pro plan" options make no API calls at all: the diver
asks Claude Code or OpenAI's Codex CLI (each signed in with the diver's own subscription) for the
review, the agent reads the dive log through the MCP server and saves the review into the same
database, and the web app shows it.

API keys entered in the web app are saved in plain text to a local JSON file next to the dive
database (`~/.ai-diving-monitor/config.json`). Environment variables still work and are used when
no key has been saved.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .storage import default_db_path


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    env_vars: tuple[str, ...]
    models: tuple[str, ...]
    key_url: str
    base_url: Optional[str] = None  # None = Anthropic SDK
    note: str = ""
    uses_api: bool = True  # False = the coach runs in Claude Code, outside the app


PROVIDERS: dict[str, Provider] = {p.id: p for p in [
    Provider("anthropic", "Claude (Anthropic)", ("ANTHROPIC_API_KEY",),
             ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"),
             "https://console.anthropic.com/settings/keys"),
    Provider("openai", "ChatGPT (OpenAI)", ("OPENAI_API_KEY",),
             ("gpt-5", "gpt-5-mini", "gpt-4.1"),
             "https://platform.openai.com/api-keys", base_url="https://api.openai.com/v1"),
    Provider("claude-code", "Claude Pro/Max plan (via Claude Code)", (), (), "https://claude.com/claude-code",
             note="No API key and no extra cost: ask for reviews in Claude Code, which uses your Claude "
                  "subscription. Reviews are saved to your dive log and shown here.",
             uses_api=False),
    Provider("codex", "ChatGPT Plus/Pro plan (via Codex)", (), (), "https://developers.openai.com/codex/cli",
             note="No API key and no extra cost: ask for reviews in OpenAI's Codex CLI, signed in with your "
                  "ChatGPT account. Reviews are saved to your dive log and shown here.",
             uses_api=False),
]}

API_PROVIDERS = [p.id for p in PROVIDERS.values() if p.uses_api]

DEFAULT_PROVIDER = "anthropic"


def config_path() -> Path:
    env = os.environ.get("AI_DIVING_MONITOR_CONFIG")
    return Path(env) if env else default_db_path().parent / "config.json"


def load_config() -> dict:
    try:
        data = json.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_config(config: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    try:
        path.chmod(0o600)  # keys are stored in plain text; keep the file private where the OS allows it
    except OSError:
        pass


def selected() -> tuple[Provider, str]:
    """The provider and model the coach should use: saved settings, then env vars, then defaults."""
    config = load_config()
    if config.get("provider") in PROVIDERS:
        provider = PROVIDERS[config["provider"]]
        model = (config.get("models") or {}).get(provider.id)
    else:
        provider = PROVIDERS.get(os.environ.get("AI_DIVING_MONITOR_PROVIDER", ""), PROVIDERS[DEFAULT_PROVIDER])
        model = os.environ.get("AI_DIVING_MONITOR_MODEL")
    return provider, model or next(iter(provider.models), "")


def select(provider_id: str, model: str) -> None:
    config = load_config()
    config["provider"] = provider_id
    config.setdefault("models", {})[provider_id] = model
    save_config(config)


def saved_key(provider_id: str) -> Optional[str]:
    return (load_config().get("api_keys") or {}).get(provider_id) or None


def set_key(provider_id: str, key: Optional[str]) -> None:
    config = load_config()
    keys = config.setdefault("api_keys", {})
    if key:
        keys[provider_id] = key.strip()
    else:
        keys.pop(provider_id, None)
    save_config(config)


def api_key(provider_id: str) -> Optional[str]:
    """The saved key, or the first matching environment variable."""
    key = saved_key(provider_id)
    if key:
        return key
    return next((os.environ[v] for v in PROVIDERS[provider_id].env_vars if os.environ.get(v)), None)


def key_source(provider_id: str) -> Optional[str]:
    """Where the key comes from, for display: 'saved', an env var name, or None."""
    if saved_key(provider_id):
        return "saved"
    if provider_id == "anthropic" and _anthropic_other_credentials():
        return "Anthropic profile"
    return next((v for v in PROVIDERS[provider_id].env_vars if os.environ.get(v)), None)


def _anthropic_other_credentials() -> bool:
    return bool(os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_PROFILE")
                or (Path.home() / ".config" / "anthropic").exists())


def is_configured(provider_id: str) -> bool:
    """True when the app itself can call this provider's API."""
    if not PROVIDERS[provider_id].uses_api:
        return False
    if provider_id == "anthropic" and _anthropic_other_credentials():
        return True
    return api_key(provider_id) is not None


def mask(key: str) -> str:
    return f"…{key[-4:]}" if len(key) > 8 else "…"


@dataclass(frozen=True)
class AgentAppStatus:
    cli_installed: bool
    mcp_registered: bool
    review_command_installed: bool  # always False for Codex, which has no command to install


def codex_home() -> Path:
    env = os.environ.get("CODEX_HOME")
    return Path(env) if env else Path.home() / ".codex"


def agent_app_status(provider_id: str) -> AgentAppStatus:
    """What is already set up for using the coach from Claude Code or Codex (best effort, read-only)."""
    home = Path.home()
    if provider_id == "codex":
        try:
            config = (codex_home() / "config.toml").read_text(encoding="utf-8")
        except OSError:
            config = ""
        registered = re.search(r'^\s*\[mcp_servers\.("?)ai-diving-monitor\1\]', config, re.MULTILINE) is not None
        return AgentAppStatus(shutil.which("codex") is not None, registered, False)
    try:
        servers = json.loads((home / ".claude.json").read_text(encoding="utf-8")).get("mcpServers") or {}
    except (OSError, ValueError, AttributeError):
        servers = {}
    return AgentAppStatus(
        cli_installed=shutil.which("claude") is not None,
        mcp_registered="ai-diving-monitor" in servers,
        review_command_installed=(home / ".claude" / "commands" / "dive-review.md").exists(),
    )
