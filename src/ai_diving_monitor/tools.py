"""Dive-log tools shared by the Claude API agent and the MCP server.

Every function returns a JSON string so it can be handed to a model as-is.
"""

from __future__ import annotations

import json
from pathlib import Path

from .analysis import PROGRESS_METRICS, analyze_dive, trend
from .storage import DiveStore
from .uddf import UDDFParseError

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

LIST_KEYS = ("id", "seq", "start", "site", "max_depth_m", "duration_min", "rmv_l_min", "sac_bar_min",
             "max_ascent_rate_m_min", "safety_stop_s", "had_deco", "gases", "score", "finding_titles")


class DiveTools:
    def __init__(self, store: DiveStore):
        self.store = store

    def list_dives(self) -> str:
        rows = self.store.list_dives()
        return json.dumps([{k: r.get(k) for k in LIST_KEYS} for r in rows])

    def latest_dive_id(self) -> int | None:
        rows = self.store.list_dives()
        return rows[-1]["id"] if rows else None

    def get_dive_analysis(self, dive_id: int) -> str:
        dive = self.store.get_dive(dive_id)
        if dive is None:
            return json.dumps({"error": f"Dive {dive_id} not found"})
        analysis = self.store.get_analysis(dive_id) or analyze_dive(dive).to_dict()
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

    def get_dive_profile(self, dive_id: int, interval_s: int = 30) -> str:
        dive = self.store.get_dive(dive_id)
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

    def get_progress_trend(self, metric: str) -> str:
        if metric not in PROGRESS_METRICS:
            return json.dumps({"error": f"Unknown metric. Use one of: {', '.join(PROGRESS_METRICS)}"})
        result = trend(self.store.list_dives(), metric)
        return json.dumps(result or {"error": "Need at least 3 dives with this metric"})

    def import_uddf(self, path: str) -> str:
        p = Path(path).expanduser()
        files = sorted(p.glob("*.uddf")) if p.is_dir() else [p]
        results = []
        for f in files:
            try:
                r = self.store.import_file(f.name, f.read_bytes())
                results.append({"file": str(f), "added": r.added, "duplicates": r.duplicates})
            except (OSError, UDDFParseError) as exc:
                results.append({"file": str(f), "error": str(exc)})
        return json.dumps(results or [{"file": str(p), "error": "No .uddf files found"}])

    def save_dive_summary(self, dive_id: int, summary_markdown: str) -> str:
        if self.store.get_dive(dive_id) is None:
            return json.dumps({"error": f"Dive {dive_id} not found"})
        self.store.save_summary(dive_id, summary_markdown)
        return json.dumps({"saved": True, "dive_id": dive_id})


# Shared tool descriptions (used as docstrings by both front-ends)
DESCRIPTIONS = {
    "list_dives": "List every dive in the diver's log in chronological order with headline metrics "
                  "(date, site, max depth, duration, RMV gas consumption, peak ascent rate, quality score, issues).",
    "get_dive_analysis": "Get full metrics and rule-based findings for one dive: gas consumption, ascent/descent "
                         "rates, ppO2, CNS%, OTU, END, safety stop / deco compliance, sawtooth count, computer alarms.",
    "get_dive_profile": "Get the depth profile of a dive, downsampled to one point per interval: time (min), "
                        "depth (m), temperature (C), tank pressure (bar), deco stop depth and gas switches.",
    "get_progress_trend": "Compare the diver's early vs recent dives for one metric and say whether it is improving. "
                          "Metrics: " + ", ".join(PROGRESS_METRICS) + ".",
    "import_uddf": "Import a UDDF dive computer export (a .uddf file, or a folder of them) into the dive log. "
                   "Duplicate dives are skipped.",
    "save_dive_summary": "Save a coaching summary (Markdown) for a dive so it shows up in the web app.",
}
