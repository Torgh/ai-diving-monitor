import json
from types import SimpleNamespace

import pytest

from ai_diving_monitor import providers
from ai_diving_monitor.agent import _run_openai_compatible, openai_tool_definitions
from ai_diving_monitor.storage import DiveStore


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    monkeypatch.setenv("AI_DIVING_MONITOR_CONFIG", str(tmp_path / "config.json"))
    for p in providers.PROVIDERS.values():
        for var in p.env_vars:
            monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("AI_DIVING_MONITOR_PROVIDER", raising=False)
    monkeypatch.delenv("AI_DIVING_MONITOR_MODEL", raising=False)


def test_defaults_and_selection_roundtrip():
    provider, model = providers.selected()
    assert provider.id == "anthropic" and model == provider.models[0]
    providers.select("openai", "gpt-5-mini")
    assert providers.selected() == (providers.PROVIDERS["openai"], "gpt-5-mini")
    providers.select("anthropic", "claude-sonnet-5-5")
    providers.select("openai", "gpt-5-mini")
    assert json.loads(providers.config_path().read_text())["models"]["anthropic"] == "claude-sonnet-5-5"


def test_only_claude_and_chatgpt_need_an_api_key():
    assert providers.API_PROVIDERS == ["anthropic", "openai"]


def test_a_removed_provider_in_old_settings_falls_back_to_claude():
    providers.save_config({"provider": "gemini", "models": {"gemini": "gemini-2.5-flash"}})
    assert providers.selected() == (providers.PROVIDERS["anthropic"], "claude-opus-5-5")


def test_env_vars_used_until_settings_are_saved(monkeypatch):
    monkeypatch.setenv("AI_DIVING_MONITOR_PROVIDER", "openai")
    monkeypatch.setenv("AI_DIVING_MONITOR_MODEL", "gpt-5-mini")
    assert providers.selected() == (providers.PROVIDERS["openai"], "gpt-5-mini")
    providers.select("anthropic", "claude-haiku-5-5")
    assert providers.selected()[0].id == "anthropic"


def test_saved_key_wins_over_env(monkeypatch):
    assert not providers.is_configured("openai")
    monkeypatch.setenv("OPENAI_API_KEY", "env-key")
    assert providers.api_key("openai") == "env-key"
    assert providers.key_source("openai") == "OPENAI_API_KEY"
    providers.set_key("openai", "  saved-key-1234 ")
    assert providers.api_key("openai") == "saved-key-1234"
    assert providers.key_source("openai") == "saved"
    assert providers.mask("saved-key-1234") == "…1234"
    providers.set_key("openai", None)
    assert providers.api_key("openai") == "env-key"


def _completion(message: dict, finish_reason: str):
    from openai.types.chat import ChatCompletionMessage

    return SimpleNamespace(choices=[SimpleNamespace(message=ChatCompletionMessage(role="assistant", **message),
                                                    finish_reason=finish_reason)])


class FakeClient:
    """Answers with one list_dives tool call, then a text answer built from the tool result."""

    def __init__(self):
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, model, messages, tools):
        self.requests.append(json.loads(json.dumps(messages)))
        if messages[-1]["role"] == "tool":
            dives = json.loads(messages[-1]["content"])
            return _completion({"content": f"You have {len(dives)} dives."}, "stop")
        return _completion({"content": None, "tool_calls": [
            {"id": "call_1", "type": "function", "function": {"name": "list_dives", "arguments": "{}"}}]},
            "tool_calls")


def test_chatgpt_tool_loop(tmp_path):
    from pathlib import Path

    store = DiveStore(tmp_path / "d.db")
    for p in (Path(__file__).resolve().parents[1] / "examples").glob("*.uddf"):
        store.import_file(p.name, p.read_bytes())
    client = FakeClient()
    answer = _run_openai_compatible(store, [{"role": "user", "content": "How many dives?"}],
                                    providers.PROVIDERS["openai"], "gpt-5-mini", client=client)
    assert answer == "You have 9 dives."
    assert client.requests[0][0]["role"] == "system"
    assert client.requests[1][-2]["tool_calls"][0]["id"] == "call_1"


def test_tool_definitions_cover_coach_tools():
    names = {t["function"]["name"] for t in openai_tool_definitions()}
    assert names == {"list_dives", "get_dive_analysis", "get_dive_profile", "get_progress_trend"}


def test_claude_code_mode_needs_no_key_and_never_calls_an_api(tmp_path):
    from ai_diving_monitor.agent import AgentUnavailable, run_agent

    providers.select("claude-code", "")
    provider, model = providers.selected()
    assert provider.id == "claude-code" and model == ""
    assert not provider.uses_api and not providers.is_configured("claude-code")
    assert "claude-code" not in providers.API_PROVIDERS
    with pytest.raises(AgentUnavailable, match="Claude Code"):
        run_agent(DiveStore(tmp_path / "d.db"), [{"role": "user", "content": "hi"}])


def test_agent_app_status(tmp_path, monkeypatch):
    monkeypatch.setattr(providers.Path, "home", lambda: tmp_path)
    monkeypatch.delenv("CODEX_HOME", raising=False)
    for app in ("claude-code", "codex"):
        assert not providers.agent_app_status(app).mcp_registered
    (tmp_path / ".claude.json").write_text(json.dumps({"mcpServers": {"ai-diving-monitor": {}}}))
    (tmp_path / ".claude" / "commands").mkdir(parents=True)
    (tmp_path / ".claude" / "commands" / "dive-review.md").write_text("x")
    status = providers.agent_app_status("claude-code")
    assert status.mcp_registered and status.review_command_installed
    (tmp_path / ".codex").mkdir()
    (tmp_path / ".codex" / "config.toml").write_text('model = "x"\n\n[mcp_servers.ai-diving-monitor]\ncommand = "py"\n')
    assert providers.agent_app_status("codex").mcp_registered


def test_codex_mode_is_a_subscription_option():
    providers.select("codex", "")
    provider, model = providers.selected()
    assert provider.id == "codex" and not provider.uses_api and model == ""
    assert "codex" not in providers.API_PROVIDERS
