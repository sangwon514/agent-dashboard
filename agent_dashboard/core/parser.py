from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Iterable

from .model import AgentEvent

_STALE_AFTER_SEC = 600


def _parse_ts(s: str | None) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def parse_jsonl(
    lines: Iterable[str],
    *,
    project_slug: str,
    project_cwd: str,
    session_id: str,
    now: datetime | None = None,
) -> dict[str, AgentEvent]:
    """Return tool_use_id -> AgentEvent.

    Defensive: only requires `message.content[]` + `tool_use`/`tool_result`.
    Any other field shape is ignored.
    """
    now = now or datetime.now(timezone.utc)
    events: dict[str, AgentEvent] = {}
    results: dict[str, dict] = {}

    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue

        msg = d.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue

        ts = _parse_ts(d.get("timestamp"))

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
        r = results.get(tu_id)
        if r is not None:
            ev.finished_at = r["ts"]
            ev.is_error = r["is_error"]
            ev.status = "failed" if r["is_error"] else "done"
        else:
            age = (now - ev.started_at).total_seconds()
            if age > _STALE_AFTER_SEC:
                ev.status = "stale"
            else:
                ev.status = "running"

    return events


def display_project_name(slug: str) -> str:
    """Slug → 사람이 읽기 쉬운 짧은 이름 (best-effort).
    `-Users-sangwonlee-...-contrabass-admin-service` →`contrabass-admin-service`.
    """
    if not slug:
        return "?"
    parts = slug.lstrip("-").split("-")
    while parts and parts[0] in ("Users", "users"):
        parts = parts[1:]
    if parts:
        parts = parts[1:]
    return "-".join(parts) if parts else slug
