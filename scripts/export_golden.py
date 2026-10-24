"""Write the golden fixtures: what the Python version parses and computes for every test file.

The TypeScript port must produce the same numbers. Run after changing the parser or the analysis:

    python scripts/export_golden.py

tests/test_golden.py fails when the files in fixtures/golden/ are out of date.
"""

from __future__ import annotations

import json
from pathlib import Path

from ai_diving_monitor.analysis import PROGRESS_METRICS, analyze_dive, progress_insights, trend
from ai_diving_monitor.storage import DiveStore
from ai_diving_monitor.uddf import PARSER_VERSION, parse_uddf

ROOT = Path(__file__).resolve().parents[1]
INPUTS = sorted((ROOT / "examples").glob("*.uddf")) + sorted((ROOT / "fixtures" / "uddf").glob("*.uddf"))
GOLDEN_DIR = ROOT / "fixtures" / "golden"


def build_golden() -> dict[str, dict]:
    """File name in fixtures/golden/ -> its content."""
    out: dict[str, dict] = {}
    for path in INPUTS:
        dives = parse_uddf(path.read_bytes())
        out[f"{path.stem}.json"] = {
            "source": path.relative_to(ROOT).as_posix(),
            "parser_version": PARSER_VERSION,
            "dives": [
                {"fingerprint": d.fingerprint, "dive": d.to_dict(), "analysis": analyze_dive(d).to_dict()}
                for d in dives
            ],
        }

    # The sample log as a whole: the dive list, trends and progress insights.
    store = DiveStore(":memory:")
    for path in sorted((ROOT / "examples").glob("*.uddf")):
        store.import_file(path.name, path.read_bytes())
    history = store.list_dives()
    out["history.json"] = {
        "sources": [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / "examples").glob("*.uddf"))],
        "dives": history,
        "trends": {metric: trend(history, metric) for metric in PROGRESS_METRICS},
        "insights": [f.__dict__ for f in progress_insights(history)],
    }
    return out


def render(data: dict) -> str:
    return json.dumps(data, indent=1, ensure_ascii=False) + "\n"


def main() -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    for name, data in build_golden().items():
        (GOLDEN_DIR / name).write_text(render(data), encoding="utf-8", newline="\n")
        print(f"fixtures/golden/{name}")


if __name__ == "__main__":
    main()
