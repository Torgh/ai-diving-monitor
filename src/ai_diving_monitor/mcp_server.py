"""MCP server that turns Claude Code (or any MCP client) into your dive coach.

No Anthropic API key is needed: the MCP client's own Claude does the coaching,
this server only exposes your dive log and the analytics.

Register with Claude Code:
    claude mcp add --scope user ai-diving-monitor -- <path-to-venv-python> -m ai_diving_monitor.mcp_server
"""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from .storage import DiveStore
from .tools import DESCRIPTIONS, SUMMARY_REQUEST, SYSTEM_PROMPT, DiveTools

INSTRUCTIONS = SYSTEM_PROMPT.replace(
    "Write in English, formatted in Markdown, concise enough to read on a phone.",
    "Answer in the language the diver writes in, formatted in Markdown and concise. After writing a full "
    "dive review, store it with save_dive_summary so it also appears in the AI Diving Monitor web app.",
)

store = DiveStore()
tools = DiveTools(store)
server = MCPServer("ai-diving-monitor", title="AI Diving Monitor", instructions=INSTRUCTIONS)
READ_ONLY = ToolAnnotations(readOnlyHint=True, openWorldHint=False)


@server.tool(description=DESCRIPTIONS["list_dives"], annotations=READ_ONLY)
def list_dives() -> str:
    return tools.list_dives()


@server.tool(description=DESCRIPTIONS["get_dive_analysis"], annotations=READ_ONLY)
def get_dive_analysis(dive_id: int) -> str:
    return tools.get_dive_analysis(dive_id)


@server.tool(description=DESCRIPTIONS["get_dive_profile"], annotations=READ_ONLY)
def get_dive_profile(dive_id: int, interval_s: int = 30) -> str:
    return tools.get_dive_profile(dive_id, interval_s)


@server.tool(description=DESCRIPTIONS["get_progress_trend"], annotations=READ_ONLY)
def get_progress_trend(metric: str) -> str:
    return tools.get_progress_trend(metric)


@server.tool(description=DESCRIPTIONS["import_uddf"],
             annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True))
def import_uddf(path: str) -> str:
    return tools.import_uddf(path)


@server.tool(description=DESCRIPTIONS["save_dive_summary"],
             annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True))
def save_dive_summary(dive_id: int, summary_markdown: str) -> str:
    return tools.save_dive_summary(dive_id, summary_markdown)


@server.prompt(name="dive-review", description="Coaching review of a dive (default: the latest one)")
def dive_review(dive_id: str = "") -> str:
    target = dive_id.strip() or str(tools.latest_dive_id() or "")
    if not target:
        return "My dive log is empty. Help me import my UDDF files with the import_uddf tool."
    return SUMMARY_REQUEST.format(dive_id=target) + "\n\nUse the ai-diving-monitor tools, then save the review."


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
