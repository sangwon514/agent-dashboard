from datetime import datetime, timezone
from pathlib import Path

from agent_dashboard.core.model import AgentEvent
from agent_dashboard.core.store import Store
from agent_dashboard.core.watcher import JsonlWatcher
from agent_dashboard.core import watcher as watcher_module


def _event(tool_use_id: str, *, session_id: str) -> AgentEvent:
    return AgentEvent(
        source="transcript",
        project_slug="-Users-x-project",
        project_cwd="/Users/x/project",
        session_id=session_id,
        tool_use_id=tool_use_id,
        subagent_type="explorer",
        description=tool_use_id,
        prompt_first_line=tool_use_id,
        started_at=datetime(2026, 5, 26, 1, 0, tzinfo=timezone.utc),
    )


def test_watcher_reuses_offset_for_appended_lines(monkeypatch, tmp_path):
    root = tmp_path / "projects"
    session_dir = root / "-Users-x-project"
    session_dir.mkdir(parents=True)
    transcript = session_dir / "session.jsonl"
    transcript.write_text("first\nsecond\n", encoding="utf-8")
    parsed_lines: list[list[str]] = []

    def parser(lines, *, session_id, **_kwargs):
        batch = list(lines)
        parsed_lines.append(batch)
        return {line: _event(line, session_id=session_id) for line in batch}

    monkeypatch.setattr(
        watcher_module,
        "WATCH_ROOTS",
        [(root, "claude", parser, "*.jsonl")],
    )
    store = Store()
    watcher = JsonlWatcher(store.update_transcript)

    watcher._reparse(transcript)
    with transcript.open("a", encoding="utf-8") as f:
        f.write("third\n")
    watcher._reparse(transcript)

    assert parsed_lines == [["first", "second"], ["third"]]
    assert store.get_transcript_offset(transcript) == transcript.stat().st_size
    session = store.snapshot()["sessions"][0]
    assert {event["tool_use_id"] for event in session["events"]} == {
        "first",
        "second",
        "third",
    }


def test_watcher_resets_offset_after_truncate(monkeypatch, tmp_path):
    root = tmp_path / "projects"
    session_dir = root / "-Users-x-project"
    session_dir.mkdir(parents=True)
    transcript = session_dir / "session.jsonl"
    transcript.write_text("first\nsecond\n", encoding="utf-8")
    parsed_lines: list[list[str]] = []

    def parser(lines, *, session_id, **_kwargs):
        batch = list(lines)
        parsed_lines.append(batch)
        return {line: _event(line, session_id=session_id) for line in batch}

    monkeypatch.setattr(
        watcher_module,
        "WATCH_ROOTS",
        [(root, "claude", parser, "*.jsonl")],
    )
    store = Store()
    watcher = JsonlWatcher(store.update_transcript)

    watcher._reparse(transcript)
    transcript.write_text("new\n", encoding="utf-8")
    watcher._reparse(transcript)

    assert parsed_lines == [["first", "second"], ["new"]]
    assert store.get_transcript_offset(transcript) == transcript.stat().st_size
    session = store.snapshot()["sessions"][0]
    assert [event["tool_use_id"] for event in session["events"]] == ["new"]
