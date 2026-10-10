import json
from pathlib import Path

from ai_diving_monitor.agent import build_tools
from ai_diving_monitor.storage import DiveStore

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def test_tools_return_grounded_json(tmp_path):
    store = DiveStore(tmp_path / "d.db")
    for p in EXAMPLES.glob("*.uddf"):
        store.import_file(p.name, p.read_bytes())
    tools = {t.name: t for t in build_tools(store)}
    assert set(tools) == {"list_dives", "get_dive_analysis", "get_dive_profile", "get_progress_trend"}

    listing = json.loads(tools["list_dives"].call({}))
    assert len(listing) == 9
    dive_id = listing[-1]["id"]
    analysis = json.loads(tools["get_dive_analysis"].call({"dive_id": dive_id}))
    assert "metrics" in analysis and "findings" in analysis
    profile = json.loads(tools["get_dive_profile"].call({"dive_id": dive_id, "interval_s": 60}))
    assert profile[0]["depth_m"] == 0
    rmv = json.loads(tools["get_progress_trend"].call({"metric": "rmv_l_min"}))
    assert rmv["verdict"] == "improving"
    assert "error" in json.loads(tools["get_dive_analysis"].call({"dive_id": 9999}))
