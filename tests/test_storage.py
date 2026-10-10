from pathlib import Path

from ai_diving_monitor.storage import DiveStore

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def test_import_store_and_dedupe(tmp_path):
    store = DiveStore(tmp_path / "dives.db")
    f = EXAMPLES / "spring-2026.uddf"
    first = store.import_file(f.name, f.read_bytes())
    assert first.added == 5 and first.duplicates == 0
    again = store.import_file(f.name, f.read_bytes())
    assert again.added == 0 and again.duplicates == 5 and again.file_duplicate

    dives = store.list_dives()
    assert [d["seq"] for d in dives] == [1, 2, 3, 4, 5]
    assert store.get_dive(dives[0]["id"]).site == "Koparki"

    files = store.list_files()
    assert len(files) == 1 and files[0]["dives"] == 5
    assert store.get_file_content(files[0]["id"]) == f.read_bytes()

    store.save_summary(dives[0]["id"], "Nice dive")
    assert store.get_summary(dives[0]["id"]) == "Nice dive"

    store.delete_file(files[0]["id"])
    assert store.list_dives() == []
