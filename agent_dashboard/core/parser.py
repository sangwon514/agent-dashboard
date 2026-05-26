from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Iterable

from .model import AgentEvent, Status

_STALE_AFTER_SEC = 600
_ORPHANED_AFTER_SEC = 1800


class ParsedEvents(dict[str, AgentEvent]):
    def __init__(self, *args, parse_failures: int = 0, **kwargs):
        super().__init__(*args, **kwargs)
        self.parse_failures = parse_failures


def _parse_ts(s: str | None) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def idle_status(
    started_at: datetime,
    now: datetime,
    *,
    last_activity: datetime | None = None,
) -> Status:
    reference = started_at
    if last_activity is not None and last_activity > reference:
        reference = last_activity
    idle_sec = (now - reference).total_seconds()
    if idle_sec > _ORPHANED_AFTER_SEC:
        return "orphaned"
    if idle_sec > _STALE_AFTER_SEC:
        return "stale"
    return "running"


def parse_jsonl(
    lines: Iterable[str],
    *,
    project_slug: str,
    project_cwd: str,
    session_id: str,
    now: datetime | None = None,
) -> ParsedEvents:
    """Return tool_use_id -> AgentEvent.

    Defensive: only requires `message.content[]` + `tool_use`/`tool_result`.
    Any other field shape is ignored.
    """
    now = now or datetime.now(timezone.utc)
    events = ParsedEvents()
    results: dict[str, dict] = {}
    last_activity: datetime | None = None
    parse_failures = 0

    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            parse_failures += 1
            continue

        msg = d.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue

        ts = _parse_ts(d.get("timestamp"))
        if last_activity is None or ts > last_activity:
            last_activity = ts

        for c in content:
            if not isinstance(c, dict):
                continue
            ctype = c.get("type")
            if ctype == "tool_use" and c.get("name") == "Agent":
                tu_id = str(c.get("id", ""))
                if not tu_id:
                    continue
                inp = c.get("input") or {}
                if not isinstance(inp, dict):
                    inp = {}
                desc = str(inp.get("description", ""))[:120]
                sub = inp.get("subagent_type")
                prompt = str(inp.get("prompt", ""))
                first = prompt.splitlines()[0] if prompt else ""
                events[tu_id] = AgentEvent(
                    source="transcript",
                    project_slug=project_slug,
                    project_cwd=project_cwd,
                    session_id=session_id,
                    tool_use_id=tu_id,
                    subagent_type=str(sub) if sub else None,
                    description=desc,
                    prompt_first_line=first[:80],
                    started_at=ts,
                )
            elif ctype == "tool_result":
                tu_id = str(c.get("tool_use_id", ""))
                if not tu_id:
                    continue
                results[tu_id] = {
                    "is_error": bool(c.get("is_error", False)),
                    "ts": ts,
                }

    for tu_id, ev in events.items():
        if last_activity is not None:
            setattr(ev, "last_activity", last_activity)
        r = results.get(tu_id)
        if r is not None:
            ev.finished_at = r["ts"]
            ev.is_error = r["is_error"]
            ev.status = "failed" if r["is_error"] else "done"
        else:
            ev.status = idle_status(ev.started_at, now, last_activity=last_activity)

    events.parse_failures = parse_failures
    return events


def display_project_name(slug: str) -> str:
    """Slug → 사람이 읽기 쉬운 짧은 이름 (best-effort).
    `-Users-<username>-...-my-project` → `my-project`.
    """
    if not slug:
        return "?"
    parts = slug.lstrip("-").split("-")
    while parts and parts[0] in ("Users", "users"):
        parts = parts[1:]
    if parts:
        parts = parts[1:]
    return "-".join(parts) if parts else slug
