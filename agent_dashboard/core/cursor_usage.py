from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

WINDOW_SECONDS = 24 * 60 * 60


def read_cursor_usage() -> dict[str, Any] | None:
    db_path = _cursor_usage_db()
    if not db_path.exists():
        return None

    now = time.time()
    try:
        conn = sqlite3.connect(_immutable_uri(db_path), uri=True)
        conn.row_factory = sqlite3.Row
    except sqlite3.Error:
        return None

    try:
        requests = _count_recent_requests(conn, now)
        lines = _sum_recent_lines(conn, now)
    except sqlite3.Error:
        return None
    finally:
        conn.close()

    return {
        "source": "cursor",
        "window_hours": 24,
        "requests_24h": requests,
        "lines_24h": lines,
        "fetched_at": now,
    }


def _cursor_usage_db() -> Path:
    return Path.home() / ".cursor" / "ai-tracking" / "ai-code-tracking.db"


def _immutable_uri(path: Path) -> str:
    return f"file:{quote(str(path), safe='/')}?mode=ro&immutable=1"


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def _count_recent_requests(conn: sqlite3.Connection, now: float) -> int:
    if not _table_exists(conn, "ai_code_hashes"):
        return 0
    cols = _columns(conn, "ai_code_hashes")
    if "timestamp" not in cols:
        return 0
    rows = conn.execute("SELECT timestamp FROM ai_code_hashes").fetchall()
    return sum(1 for row in rows if _is_recent(row["timestamp"], now))


def _sum_recent_lines(conn: sqlite3.Connection, now: float) -> dict[str, int]:
    totals = {
        "added": 0,
        "deleted": 0,
        "composer_added": 0,
        "composer_deleted": 0,
        "total_changed": 0,
    }
    if not _table_exists(conn, "scored_commits"):
        return totals

    cols = _columns(conn, "scored_commits")
    timestamp_column = next(
        (name for name in ("timestamp", "scoredAt", "commitDate") if name in cols),
        None,
    )
    if timestamp_column is None:
        return totals

    wanted = {
        "added": ("linesAdded", "lines_added"),
        "deleted": ("linesDeleted", "lines_deleted"),
        "composer_added": ("composerLinesAdded", "composer_lines_added"),
        "composer_deleted": ("composerLinesDeleted", "composer_lines_deleted"),
    }
    selected = {}
    select_columns = [f"{timestamp_column} AS event_time"]
    for key, names in wanted.items():
        column = next((name for name in names if name in cols), None)
        if column is None:
            continue
        selected[key] = column
        select_columns.append(f"{column} AS {key}")

    rows = conn.execute(f"SELECT {', '.join(select_columns)} FROM scored_commits").fetchall()
    for row in rows:
        if not _is_recent(row["event_time"], now):
            continue
        for key in selected:
            totals[key] += _int_or_zero(row[key])
    totals["total_changed"] = (
        totals["added"]
        + totals["deleted"]
        + totals["composer_added"]
        + totals["composer_deleted"]
    )
    return totals


def _is_recent(value: Any, now: float) -> bool:
    ts = _to_epoch(value)
    return ts is not None and now - WINDOW_SECONDS <= ts <= now


def _to_epoch(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, int | float):
        return _numeric_epoch(float(value))
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    text = str(value).strip()
    if not text:
        return None
    try:
        return _numeric_epoch(float(text))
    except ValueError:
        pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


def _numeric_epoch(value: float) -> float:
    if value > 1_000_000_000_000_000:
        return value / 1_000_000
    if value > 1_000_000_000_000:
        return value / 1_000
    return value


def _int_or_zero(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0
