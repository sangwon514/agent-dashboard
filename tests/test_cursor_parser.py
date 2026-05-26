from datetime import datetime, timezone
from pathlib import Path

from agent_dashboard.core.cursor_parser import parse_cursor_jsonl
from agent_dashboard.core.watcher import _cursor_path_meta

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "cursor"


def _load(name: str) -> list[str]:
    return (FIXTURE_DIR / name).read_text(encoding="utf-8").splitlines()


def test_parse_cursor_main_transcript_event():
    events = parse_cursor_jsonl(
        _load("main.jsonl"),
        project_slug="Users-sangwonlee-agent-dashboard",
        session_id="main-session",
        now=datetime(2026, 5, 26, 1, 3, tzinfo=timezone.utc),
    )

    assert list(events) == ["main-session"]
    ev = events["main-session"]
    assert ev.tool == "cursor"
    assert ev.project_slug == "Users-sangwonlee-agent-dashboard"
    assert ev.session_id == "main-session"
    assert ev.subagent_type is None
    assert ev.started_at == datetime(2026, 5, 26, 1, 2, 3, tzinfo=timezone.utc)
    assert ev.prompt_first_line == "Build the thing"


def test_parse_cursor_subagent_transcript_as_pet():
    events = parse_cursor_jsonl(
        _load("subagent.jsonl"),
        project_slug="Users-sangwonlee-agent-dashboard",
        session_id="main-session/subagents/subagent-session",
        now=datetime(2026, 5, 26, 2, 4, tzinfo=timezone.utc),
    )

    ev = events["main-session/subagents/subagent-session"]
    assert ev.tool == "cursor"
    assert ev.subagent_type == "cursor-agent"
    assert ev.prompt_first_line == "Investigate parser"


def test_parse_cursor_timestamp_falls_back_to_now():
    now = datetime(2026, 5, 26, 3, 0, tzinfo=timezone.utc)
    events = parse_cursor_jsonl(
        ['{"role":"user","message":{"content":[{"type":"text","text":"No timestamp"}]}}'],
        project_slug="Users-x-project",
        session_id="sid",
        now=now,
    )

    assert events["sid"].started_at == now


def test_cursor_path_meta_extracts_slug_and_subagent_session():
    root = Path("/Users/me/.cursor/projects")
    main = root / "Users-me-proj" / "agent-transcripts" / "abc" / "abc.jsonl"
    sub = root / "Users-me-proj" / "agent-transcripts" / "abc" / "subagents" / "def.jsonl"

    assert _cursor_path_meta(main, root) == ("Users-me-proj", "abc")
    assert _cursor_path_meta(sub, root) == ("Users-me-proj", "abc/subagents/def")
