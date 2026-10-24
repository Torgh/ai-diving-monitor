"""SQLite storage for imported dive computer files and parsed dives."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from .analysis import analyze_dive
from .uddf import PARSER_VERSION, Dive, UDDFParseError, parse_uddf


def default_db_path() -> Path:
    env = os.environ.get("AI_DIVING_MONITOR_DB")
    if env:
        return Path(env)
    return Path.home() / ".ai-diving-monitor" / "dives.db"


SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    format TEXT NOT NULL,
    sha256 TEXT NOT NULL UNIQUE,
    content BLOB NOT NULL,
    imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL UNIQUE,
    start TEXT,
    site TEXT,
    max_depth_m REAL,
    duration_s REAL,
    data TEXT NOT NULL,
    analysis TEXT NOT NULL,
    ai_summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_dives_start ON dives(start);
"""


@dataclass
class ImportResult:
    filename: str
    added: int
    duplicates: int
    file_duplicate: bool


class DiveStore:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else default_db_path()
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        if self.conn.execute("PRAGMA user_version").fetchone()[0] < PARSER_VERSION:
            self.reparse_all()
            self.conn.execute(f"PRAGMA user_version = {PARSER_VERSION}")

    # -- import -----------------------------------------------------------
    def import_file(self, filename: str, content: bytes) -> ImportResult:
        """Store the raw file and every dive it contains. Duplicate dives are skipped."""
        dives = parse_uddf(content)  # raises UDDFParseError on bad input
        sha = hashlib.sha256(content).hexdigest()
        row = self.conn.execute("SELECT id FROM files WHERE sha256 = ?", (sha,)).fetchone()
        file_duplicate = row is not None
        with self.conn:
            if row:
                file_id = row["id"]
            else:
                cur = self.conn.execute(
                    "INSERT INTO files (filename, format, sha256, content, imported_at) VALUES (?, ?, ?, ?, ?)",
                    (filename, "uddf", sha, content, datetime.now().isoformat(timespec="seconds")),
                )
                file_id = cur.lastrowid
            added = dup = 0
            for dive in dives:
                try:
                    self.conn.execute(
                        "INSERT INTO dives (file_id, fingerprint, start, site, max_depth_m, duration_s, data, analysis) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            file_id,
                            dive.fingerprint,
                            dive.start.isoformat() if dive.start else None,
                            dive.site,
                            dive.max_depth_m,
                            dive.duration_s,
                            json.dumps(dive.to_dict()),
                            json.dumps(analyze_dive(dive).to_dict()),
                        ),
                    )
                    added += 1
                except sqlite3.IntegrityError:
                    dup += 1
            if not row and added == 0:
                # Nothing new in this file - don't keep a redundant copy.
                self.conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        return ImportResult(filename, added, dup, file_duplicate)

    # -- queries ----------------------------------------------------------
    def list_dives(self) -> list[dict]:
        """All dives, oldest first, with headline metrics."""
        rows = self.conn.execute(
            "SELECT id, start, site, max_depth_m, duration_s, analysis, ai_summary IS NOT NULL AS has_summary "
            "FROM dives ORDER BY COALESCE(start, ''), id"
        ).fetchall()
        out = []
        for i, r in enumerate(rows, start=1):
            a = json.loads(r["analysis"])
            m = a["metrics"]
            out.append({
                "id": r["id"],
                "seq": i,
                "start": r["start"],
                "site": r["site"],
                **m,
                "finding_titles": [f["title"] for f in a["findings"]],
                "worst_severity": a["findings"][0]["severity"] if a["findings"] else "good",
                "has_summary": bool(r["has_summary"]),
            })
        return out

    def get_dive(self, dive_id: int) -> Optional[Dive]:
        r = self.conn.execute("SELECT data FROM dives WHERE id = ?", (dive_id,)).fetchone()
        return Dive.from_dict(json.loads(r["data"])) if r else None

    def get_analysis(self, dive_id: int) -> Optional[dict]:
        r = self.conn.execute("SELECT analysis FROM dives WHERE id = ?", (dive_id,)).fetchone()
        return json.loads(r["analysis"]) if r else None

    def get_summary(self, dive_id: int) -> Optional[str]:
        r = self.conn.execute("SELECT ai_summary FROM dives WHERE id = ?", (dive_id,)).fetchone()
        return r["ai_summary"] if r else None

    def save_summary(self, dive_id: int, text: str) -> None:
        with self.conn:
            self.conn.execute("UPDATE dives SET ai_summary = ? WHERE id = ?", (text, dive_id))

    def list_files(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT f.id, f.filename, f.format, f.imported_at, LENGTH(f.content) AS size, COUNT(d.id) AS dives "
            "FROM files f LEFT JOIN dives d ON d.file_id = f.id GROUP BY f.id ORDER BY f.imported_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_file_content(self, file_id: int) -> Optional[bytes]:
        r = self.conn.execute("SELECT content FROM files WHERE id = ?", (file_id,)).fetchone()
        return r["content"] if r else None

    def delete_file(self, file_id: int) -> None:
        with self.conn:
            self.conn.execute("DELETE FROM files WHERE id = ?", (file_id,))

    def reparse_all(self) -> int:
        """Parse the stored original files again (after a parser fix) and refresh their dives.

        Dives are matched by fingerprint, so ids and saved AI summaries are kept.
        """
        updated = 0
        files = self.conn.execute("SELECT id, content FROM files").fetchall()
        with self.conn:
            for f in files:
                try:
                    dives = parse_uddf(f["content"])
                except UDDFParseError:
                    continue  # keep what was parsed before
                for dive in dives:
                    cur = self.conn.execute(
                        "UPDATE dives SET start = ?, site = ?, max_depth_m = ?, duration_s = ?, data = ?, analysis = ? "
                        "WHERE file_id = ? AND fingerprint = ?",
                        (
                            dive.start.isoformat() if dive.start else None,
                            dive.site,
                            dive.max_depth_m,
                            dive.duration_s,
                            json.dumps(dive.to_dict()),
                            json.dumps(analyze_dive(dive).to_dict()),
                            f["id"],
                            dive.fingerprint,
                        ),
                    )
                    updated += cur.rowcount
        return updated

    def reanalyze_all(self) -> int:
        """Recompute stored analyses (e.g. after upgrading the app)."""
        rows = self.conn.execute("SELECT id, data FROM dives").fetchall()
        with self.conn:
            for r in rows:
                dive = Dive.from_dict(json.loads(r["data"]))
                self.conn.execute("UPDATE dives SET analysis = ? WHERE id = ?",
                                  (json.dumps(analyze_dive(dive).to_dict()), r["id"]))
        return len(rows)
