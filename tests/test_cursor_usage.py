import sqlite3
import time
from pathlib import Path

from agent_dashboard.core.cursor_usage import read_cursor_usage


def test_read_cursor_usage_missing_db_returns_none(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)

    assert read_cursor_usage() is None


def test_read_cursor_usage_aggregates_recent_tracking_db(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    db_path = tmp_path / ".cursor" / "ai-tracking" / "ai-code-tracking.db"
    db_path.parent.mkdir(parents=True)
    now = time.time()
    recent_ms = int((now - 60) * 1000)
    old_ms = int((now - 25 * 60 * 60) * 1000)

    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE ai_code_hashes "
        "(source TEXT, model TEXT, timestamp INTEGER, conversationId TEXT)"
    )
    conn.execute(
        "CREATE TABLE scored_commits "
        "(timestamp INTEGER, linesAdded INTEGER, linesDeleted INTEGER, "
        "composerLinesAdded INTEGER, composerLinesDeleted INTEGER)"
    )
    conn.executemany(
        "INSERT INTO ai_code_hashes VALUES (?, ?, ?, ?)",
        [
            ("composer", "cursor", recent_ms, "a"),
            ("composer", "cursor", recent_ms, "b"),
            ("composer", "cursor", old_ms, "c"),
        ],
    )
    conn.executemany(
        "INSERT INTO scored_commits VALUES (?, ?, ?, ?, ?)",
        [
            (recent_ms, 10, 2, 3, 1),
            (old_ms, 100, 20, 30, 10),
        ],
    )
    conn.commit()
    conn.close()

    usage = read_cursor_usage()

    assert usage is not None
    assert usage["source"] == "cursor"
    assert usage["requests_24h"] == 2
    assert usage["lines_24h"] == {
        "added": 10,
        "deleted": 2,
        "composer_added": 3,
        "composer_deleted": 1,
        "total_changed": 16,
    }


def test_read_cursor_usage_aggregates_scored_at_tracking_db(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    db_path = tmp_path / ".cursor" / "ai-tracking" / "ai-code-tracking.db"
    db_path.parent.mkdir(parents=True)
    now = time.time()
    recent_ms = int((now - 60) * 1000)
    old_ms = int((now - 25 * 60 * 60) * 1000)

    conn = sqlite3.connect(db_path)
    conn.execute(
        "CREATE TABLE ai_code_hashes "
        "(source TEXT, model TEXT, timestamp INTEGER, conversationId TEXT)"
    )
    conn.execute(
        "CREATE TABLE scored_commits "
        "(commitHash TEXT, branchName TEXT, scoredAt INTEGER, "
        "linesAdded INTEGER, linesDeleted INTEGER, "
        "composerLinesAdded INTEGER, composerLinesDeleted INTEGER)"
    )
    conn.executemany(
        "INSERT INTO ai_code_hashes VALUES (?, ?, ?, ?)",
        [
            ("composer", "cursor", recent_ms, "a"),
            ("composer", "cursor", old_ms, "b"),
        ],
    )
    conn.executemany(
        "INSERT INTO scored_commits VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            ("recent", "main", recent_ms, 4, 5, 6, 7),
            ("old", "main", old_ms, 100, 200, 300, 400),
        ],
    )
    conn.commit()
    conn.close()

    usage = read_cursor_usage()

    assert usage is not None
    assert usage["requests_24h"] == 1
    assert usage["lines_24h"] == {
        "added": 4,
        "deleted": 5,
        "composer_added": 6,
        "composer_deleted": 7,
        "total_changed": 22,
    }
