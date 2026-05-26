from datetime import datetime, timezone
from pathlib import Path

from agent_dashboard.core import watcher as watcher_module
from agent_dashboard.core.cursor_parser import parse_cursor_jsonl, parse_cursor_session
from agent_dashboard.core.watcher import JsonlWatcher, _cursor_path_meta

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


def test_parse_cursor_session_merges_subagents_as_parent_pets():
    events = parse_cursor_session(
        _load("main.jsonl"),
        [
            ("subagent-one", _load("subagent.jsonl")),
            (
                "subagent-two.jsonl",
                [
                    (
                        '{"role":"user","message":{"content":[{"type":"text",'
                        '"text":"<timestamp>2026-05-26T02:04:05Z</timestamp>\\n'
                        'Inspect watcher"}]}}'
                    ),
                ],
            ),
        ],
        project_slug="Users-sangwonlee-agent-dashboard",
        session_id="main-session",
        now=datetime(2026, 5, 26, 3, 0, tzinfo=timezone.utc),
    )

    assert set(events) == {"main-session", "subagent-one", "subagent-two"}
    assert events["main-session"].session_id == "main-session"
    assert events["main-session"].subagent_type is None
    for key in ("subagent-one", "subagent-two"):
        ev = events[key]
        assert ev.session_id == "main-session"
        assert ev.tool_use_id == key
        assert ev.subagent_type == "cursor-agent"
        assert ev.tool == "cursor"


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


def test_cursor_watcher_merges_subagents_when_parent_reparsed(monkeypatch, tmp_path):
    root = tmp_path / ".cursor" / "projects"
    session_dir = root / "Users-me-proj" / "agent-transcripts" / "parent-uuid"
    subagents_dir = session_dir / "subagents"
    subagents_dir.mkdir(parents=True)
    main_path = session_dir / "parent-uuid.jsonl"
    main_path.write_text(
        (FIXTURE_DIR / "main.jsonl").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (subagents_dir / "child-one.jsonl").write_text(
        (FIXTURE_DIR / "subagent.jsonl").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (subagents_dir / "child-two.jsonl").write_text(
        (
            '{"role":"user","message":{"content":[{"type":"text",'
            '"text":"<timestamp>2026-05-26T02:04:05Z</timestamp>\\n'
            'Inspect watcher"}]}}\n'
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        watcher_module,
        "WATCH_ROOTS",
        [(root, "cursor", parse_cursor_jsonl, "*.jsonl")],
    )
    calls = []
    watcher = JsonlWatcher(lambda path, events, tool: calls.append((path, events, tool)))

    watcher._reparse(main_path)

    assert len(calls) == 1
    path, events, tool = calls[0]
    assert path == main_path
    assert tool == "cursor"
    assert set(events) == {"parent-uuid", "child-one", "child-two"}
    assert events["parent-uuid"].session_id == "parent-uuid"
    for key in ("child-one", "child-two"):
        ev = events[key]
        assert ev.session_id == "parent-uuid"
        assert ev.tool_use_id == key
        assert ev.subagent_type == "cursor-agent"

    calls.clear()
    watcher._reparse(subagents_dir / "child-one.jsonl")

    assert len(calls) == 1
    path, events, tool = calls[0]
    assert path == main_path
    assert tool == "cursor"
    assert set(events) == {"parent-uuid", "child-one", "child-two"}
