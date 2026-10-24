import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("export_golden", ROOT / "scripts" / "export_golden.py")
export_golden = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export_golden)


def test_golden_fixtures_are_up_to_date():
    expected = export_golden.build_golden()
    on_disk = {p.name for p in export_golden.GOLDEN_DIR.glob("*.json")}
    assert on_disk == set(expected), "run: python scripts/export_golden.py"
    for name, data in expected.items():
        text = (export_golden.GOLDEN_DIR / name).read_text(encoding="utf-8")
        assert text == export_golden.render(data), f"fixtures/golden/{name} is out of date: run python scripts/export_golden.py"
