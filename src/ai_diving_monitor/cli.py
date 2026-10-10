"""Command-line entry points."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .providers import API_PROVIDERS


def main() -> None:
    parser = argparse.ArgumentParser(prog="ai-diving-monitor", description="AI dive coach for technical divers.")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("ui", help="Start the web interface (default)")
    imp = sub.add_parser("import", help="Import UDDF files into the local database")
    imp.add_argument("files", nargs="+", type=Path)
    summ = sub.add_parser("summary", help="Print the AI coach summary for a dive")
    summ.add_argument("dive_id", type=int)
    summ.add_argument("--provider", choices=sorted(API_PROVIDERS), help="AI provider (default: the one chosen in Settings)")
    summ.add_argument("--model", help="Model id (default: the one chosen in Settings)")
    sub.add_parser("mcp", help="Run the MCP server (stdio) for Claude Code and other MCP clients")
    args = parser.parse_args()

    if args.cmd == "mcp":
        from .mcp_server import main as mcp_main

        return mcp_main()

    if args.cmd in (None, "ui"):
        from streamlit.web import cli as stcli

        sys.argv = ["streamlit", "run", str(Path(__file__).with_name("app.py"))]
        sys.exit(stcli.main())

    from .storage import DiveStore

    store = DiveStore()
    if args.cmd == "import":
        from .uddf import UDDFParseError

        for path in args.files:
            try:
                r = store.import_file(path.name, path.read_bytes())
                print(f"{path.name}: {r.added} new dive(s), {r.duplicates} duplicate(s)")
            except (OSError, UDDFParseError) as exc:
                print(f"{path.name}: {exc}", file=sys.stderr)
    elif args.cmd == "summary":
        from .agent import describe_api_error, summarize_dive

        try:
            print(summarize_dive(store, args.dive_id, args.provider, args.model))
        except Exception as exc:
            sys.exit(describe_api_error(exc))


if __name__ == "__main__":
    main()
