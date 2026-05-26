from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Iterable

from .model import AgentEvent
from .parser import idle_status

_TIMESTAMP_PAT = re.compile(r"<timestamp>\s*(.*?)\s*</timestamp>", re.I | re.S)


def _parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        ts = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts


def _timestamp_from_text(text: str) -> datetime | None:
    match = _TIMESTAMP_PAT.search(text)
    if not match:
        return None
    return _parse_ts(match.group(1).strip())


def _strip_timestamp(text: str) -> str:
    return _TIMESTAMP_PAT.sub("", text).strip()


def _is_subagent_session(session_id: str) -> bool:
    parts = [p for p in re.split(r"[/\\:]", session_id) if p]
    return "subagents" in parts


def parse_cursor_jsonl(
    lines: Iterable[str],
    *,
    project_slug: str = "",
    session_id: str = "",
    now: datetime | None = None,
) -> dict[str, AgentEvent]:
    """Cursor transcript JSONL -> one representative AgentEvent per file.

    Cursor lines do not carry a top-level timestamp. The session timestamp is
    embedded in user text as `<timestamp>...</timestamp>`; if absent, `now` is
    used. Unknown line and content shapes are ignored.
    """
    now = now or datetime.now(timezone.utc)
    first_ts: datetime | None = None
    last_ts: datetime | None = None
    first_text = ""
    tool_names: list[str] = []
    saw_cursor_message = False

    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if d.get("role") not in {"user", "assistant"}:
            continue
        msg = d.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue

        saw_cursor_message = True
        for c in content:
            if not isinstance(c, dict):
                continue
            ctype = c.get("type")
            if ctype == "text":
                text = str(c.get("text", "") or "")
                ts = _timestamp_from_text(text) if d.get("role") == "user" else None
                if ts is not None:
                    first_ts = first_ts or ts
                    if last_ts is None or ts > last_ts:
                        last_ts = ts
                clean = _strip_timestamp(text)
                if clean and not first_text:
                    first_text = clean.splitlines()[0][:80]
            elif ctype == "tool_use":
                name = str(c.get("name", "") or "")
                if name:
                    tool_names.append(name)

    if not saw_cursor_message:
        return {}

    started_at = first_ts or now
    last_activity = last_ts or started_at
    is_subagent = _is_subagent_session(session_id)
    tool_use_id = session_id or "cursor-session"
    description = first_text
    if tool_names:
        description = f"tool_use: {tool_names[0]}"[:120]
    if not description:
        description = "Cursor transcript"

    event = AgentEvent(
        source="transcript",
        project_slug=project_slug,
        project_cwd="",
        session_id=session_id,
        tool_use_id=tool_use_id,
        subagent_type="cursor-agent" if is_subagent else None,
        description=description[:120],
        prompt_first_line=first_text,
        started_at=started_at,
        status=idle_status(started_at, now, last_activity=last_activity),
        tool="cursor",
    )
    setattr(event, "last_activity", last_activity)
    return {tool_use_id: event}


def parse_cursor_session(
    main_lines: Iterable[str],
    subagent_files: list[tuple[str, Iterable[str]]],
    *,
    project_slug: str = "",
    session_id: str = "",
    now: datetime | None = None,
) -> dict[str, AgentEvent]:
    """Parse a Cursor parent transcript plus subagent transcripts.

    Subagent JSONL files are represented as pet AgentEvents inside the parent
    session, keyed by the subagent file stem.
    """
    now = now or datetime.now(timezone.utc)
    events = parse_cursor_jsonl(
        main_lines,
        project_slug=project_slug,
        session_id=session_id,
        now=now,
    )
    for name, lines in subagent_files:
        tool_use_id = name.removesuffix(".jsonl")
        sub_events = parse_cursor_jsonl(
            lines,
            project_slug=project_slug,
            session_id=f"{session_id}/subagents/{tool_use_id}",
            now=now,
        )
        if not sub_events:
            continue
        event = next(iter(sub_events.values()))
        event.session_id = session_id
        event.tool_use_id = tool_use_id
        event.subagent_type = "cursor-agent"
        event.tool = "cursor"
        events[tool_use_id] = event
    return events
