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


def test_stored_dives_are_parsed_again_after_a_parser_upgrade(tmp_path):
    db = tmp_path / "dives.db"
    store = DiveStore(db)
    f = EXAMPLES / "spring-2026.uddf"
    store.import_file(f.name, f.read_bytes())
    dive_id = store.list_dives()[0]["id"]
    store.save_summary(dive_id, "Nice dive")
    with store.conn:  # simulate a dive parsed by an older version
        store.conn.execute("UPDATE dives SET data = '{}', analysis = '{}'")
        store.conn.execute("PRAGMA user_version = 0")
    store.conn.close()

    store = DiveStore(db)
    assert store.get_dive(dive_id).site == "Koparki"
    assert store.list_dives()[0]["id"] == dive_id
    assert store.get_summary(dive_id) == "Nice dive"
