from datetime import datetime, timezone
from pathlib import Path

import pytest

from agent_dashboard.core.codex_parser import parse_codex_jsonl
from agent_dashboard.core.model import AgentEvent
from agent_dashboard.core.parser import parse_jsonl
from agent_dashboard.core.store import Store

CODEX_FIXTURE = Path(__file__).parent / "fixtures" / "codex" / "rollout-sample.jsonl"

CLAUDE_SAMPLE = '''
{"timestamp":"2026-05-13T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"toolu_X","input":{"subagent_type":"explorer","description":"find files","prompt":"go look"}}]}}
{"timestamp":"2026-05-13T10:00:05Z","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_X","is_error":false}]}}
'''.strip().splitlines()


def test_store_groups_by_tool_from_events():
    store = Store()

    # Claude 데이터 — path 가 ~/.claude/projects/<slug>/<sid>.jsonl 구조 가정
    claude_events = parse_jsonl(
        CLAUDE_SAMPLE,
        project_slug="-Users-x-claude-project",
        project_cwd="/Users/x/claude-project",
        session_id="claude-sid-1",
    )
    fake_claude_path = Path("/Users/x/.claude/projects/-Users-x-claude-project/claude-sid-1.jsonl")
    store.update_transcript(fake_claude_path, claude_events)

    # Codex 데이터 — path 가 ~/.codex/sessions/Y/M/D/rollout-*.jsonl 구조 (날짜 디렉토리)
    with CODEX_FIXTURE.open("r", encoding="utf-8") as f:
        codex_events = parse_codex_jsonl(f)
    fake_codex_path = Path("/Users/x/.codex/sessions/2026/05/13/rollout-2026-05-13T01-57-18-019e1f0d.jsonl")
    store.update_transcript(fake_codex_path, codex_events)

    snap = store.snapshot()
    assert len(snap["sessions"]) == 2

    by_tool = {s["tool"]: s for s in snap["sessions"]}
    assert "claude" in by_tool
    assert "codex" in by_tool

    claude_sess = by_tool["claude"]
    assert claude_sess["session_id"] == "claude-sid-1"
    assert claude_sess["project_slug"] == "-Users-x-claude-project"

    codex_sess = by_tool["codex"]
    # session_id 는 fixture 의 session_meta 에서 추출
    assert codex_sess["session_id"] == "019e1f0d-7df6-7213-b6cd-9cfbf4001fb9"
    # project_slug 는 cwd 에서 derive
    assert codex_sess["project_slug"].startswith("-Users-sangwonlee-")
    assert codex_sess["project_cwd"].endswith("contrabass-admin-service")


def test_store_empty_events_respects_tool_arg():
    """빈 dict 일 때 — tool 인자가 그대로 적용되고, project_slug 는 비워둠
    (Codex day 폴더명 같은 path noise 가 Claude town 의 가짜 프로젝트로 새는 것 방지)."""
    store = Store()
    fake = Path("/Users/x/.codex/sessions/2026/05/13/rollout-some.jsonl")
    store.update_transcript(fake, {}, tool="codex")
    snap = store.snapshot()
    assert len(snap["sessions"]) == 1
    sess = snap["sessions"][0]
    assert sess["session_id"] == "rollout-some"
    assert sess["project_slug"] == ""  # day 폴더명 "13" 같은 noise 안 들어옴
    assert sess["tool"] == "codex"


def test_store_empty_events_default_tool_is_claude():
    """tool 인자 안 주면 기존 호환 — claude."""
    store = Store()
    fake = Path("/x/y.jsonl")
    store.update_transcript(fake, {})
    snap = store.snapshot()
    assert snap["sessions"][0]["tool"] == "claude"


def test_store_health_collects_parse_failures_by_tool():
    store = Store()
    events = parse_jsonl(["not json"], project_slug="p", project_cwd="/p", session_id="s")

    store.update_transcript(Path("/x/s.jsonl"), events, tool="claude")

    assert store.health()["parse_failures"] == {
        "claude": 1,
        "codex": 0,
        "cursor": 0,
    }


def test_store_health_reports_oldest_running_age_sec():
    now_dt = datetime(2026, 5, 13, 10, 5, 0, tzinfo=timezone.utc)
    store = Store(now=lambda: now_dt)
    recent = {
        "toolu_recent": AgentEvent(
            source="transcript",
            project_slug="-Users-x-p",
            project_cwd="/Users/x/p",
            session_id="sid-recent",
            tool_use_id="toolu_recent",
            subagent_type="explorer",
            description="recent",
            prompt_first_line="recent",
            started_at=datetime(2026, 5, 13, 10, 3, 0, tzinfo=timezone.utc),
        ),
    }
    oldest = {
        "toolu_oldest": AgentEvent(
            source="transcript",
            project_slug="-Users-x-p",
            project_cwd="/Users/x/p",
            session_id="sid-oldest",
            tool_use_id="toolu_oldest",
            subagent_type="explorer",
            description="oldest",
            prompt_first_line="oldest",
            started_at=datetime(2026, 5, 13, 10, 0, 0, tzinfo=timezone.utc),
        ),
    }
    store.update_transcript(
        Path("/Users/x/.claude/projects/-Users-x-p/sid-recent.jsonl"),
        recent,
    )
    store.update_transcript(
        Path("/Users/x/.claude/projects/-Users-x-p/sid-oldest.jsonl"),
        oldest,
    )

    assert store.health()["oldest_running_age_sec"] == pytest.approx(300.0)


def test_store_health_reports_none_when_no_running_events():
    store = Store()
    events = parse_jsonl(
        CLAUDE_SAMPLE,
        project_slug="p",
        project_cwd="/p",
        session_id="s",
    )

    store.update_transcript(Path("/x/s.jsonl"), events)

    assert store.health()["oldest_running_age_sec"] is None


def test_store_snapshot_events_include_age_sec():
    now_dt = datetime(2026, 5, 13, 10, 3, 0, tzinfo=timezone.utc)
    store = Store(now=lambda: now_dt)
    events = parse_jsonl(
        [
            '{"timestamp":"2026-05-13T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"toolu_age","input":{"subagent_type":"explorer","description":"find files","prompt":"go look"}}]}}'
        ],
        project_slug="-Users-x-p",
        project_cwd="/Users/x/p",
        session_id="sid-age",
        now=now_dt,
    )
    store.update_transcript(Path("/Users/x/.claude/projects/-Users-x-p/sid-age.jsonl"), events)

    event = store.snapshot()["sessions"][0]["events"][0]

    assert isinstance(event["age_sec"], float)
    assert event["age_sec"] >= 0.0
    assert event["age_sec"] == pytest.approx(180.0)


def test_store_snapshot_event_age_sec_clamps_future_timestamp():
    now_dt = datetime(2026, 5, 13, 10, 0, 0, tzinfo=timezone.utc)
    store = Store(now=lambda: now_dt)
    events = parse_jsonl(
        [
            '{"timestamp":"2026-05-13T10:05:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"toolu_future","input":{"subagent_type":"explorer","description":"find files","prompt":"go look"}}]}}'
        ],
        project_slug="-Users-x-p",
        project_cwd="/Users/x/p",
        session_id="sid-future",
        now=now_dt,
    )
    store.update_transcript(Path("/Users/x/.claude/projects/-Users-x-p/sid-future.jsonl"), events)

    event = store.snapshot()["sessions"][0]["events"][0]

    assert event["age_sec"] == 0.0


def test_live_snapshot_trims_slugless_and_stale():
    """live=True 는 UI 가 숨기는 세션(slug 없음 / 오래됨)을 제외. 기본 snapshot 은 전부 유지."""
    now_dt = datetime(2026, 5, 13, 11, 0, 0, tzinfo=timezone.utc)
    store = Store(now=lambda: now_dt)
    # 최근 + slug — 10:00 활동, 1h 전 → live 유지
    recent = parse_jsonl(
        CLAUDE_SAMPLE, project_slug="-Users-x-p", project_cwd="/Users/x/p",
        session_id="recent", now=now_dt,
    )
    store.update_transcript(Path("/Users/x/.claude/projects/-Users-x-p/recent.jsonl"), recent)
    # 오래됨 + slug — 3일 전 → live 제외
    old = parse_jsonl(
        ['{"timestamp":"2026-05-10T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"toolu_O","input":{"subagent_type":"x","description":"d","prompt":"p"}}]}}'],
        project_slug="-Users-x-old", project_cwd="/Users/x/old", session_id="old", now=now_dt,
    )
    store.update_transcript(Path("/Users/x/.claude/projects/-Users-x-old/old.jsonl"), old)
    # slug 없음 — live 제외
    store.update_transcript(Path("/Users/x/.codex/sessions/2026/05/13/rollout-z.jsonl"), {}, tool="codex")

    full_ids = {s["session_id"] for s in store.snapshot()["sessions"]}
    live_ids = {s["session_id"] for s in store.snapshot(live=True)["sessions"]}
    assert {"recent", "old", "rollout-z"} <= full_ids        # full 은 전부
    assert "recent" in live_ids                              # 최근+slug 유지
    assert "old" not in live_ids                             # 오래됨 제외
    assert "rollout-z" not in live_ids                       # slug 없음 제외


def test_store_snapshot_marks_idle_running_event_orphaned():
    lines = [
        '{"timestamp":"2026-05-13T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"toolu_idle","input":{"subagent_type":"explorer","description":"find files","prompt":"go look"}}]}}'
    ]
    events = parse_jsonl(
        lines,
        project_slug="-Users-x-claude-project",
        project_cwd="/Users/x/claude-project",
        session_id="claude-sid-1",
        now=datetime(2026, 5, 13, 10, 5, 0, tzinfo=timezone.utc),
    )
    assert events["toolu_idle"].status == "running"

    store = Store(now=lambda: datetime(2026, 5, 13, 10, 31, 0, tzinfo=timezone.utc))
    fake = Path("/Users/x/.claude/projects/-Users-x-claude-project/claude-sid-1.jsonl")
    store.update_transcript(fake, events)

    snap = store.snapshot()
    assert snap["sessions"][0]["events"][0]["status"] == "orphaned"


def test_store_snapshot_uses_last_transcript_activity_for_idle_status():
    lines = [
        '{"timestamp":"2026-05-13T10:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"toolu_idle","input":{"subagent_type":"explorer","description":"find files","prompt":"go look"}}]}}',
        '{"timestamp":"2026-05-13T10:25:00Z","message":{"content":[{"type":"text","text":"still active"}]}}',
    ]
    events = parse_jsonl(
        lines,
        project_slug="-Users-x-claude-project",
        project_cwd="/Users/x/claude-project",
        session_id="claude-sid-1",
        now=datetime(2026, 5, 13, 10, 26, 0, tzinfo=timezone.utc),
    )
    assert events["toolu_idle"].status == "running"

    store = Store(now=lambda: datetime(2026, 5, 13, 10, 51, 0, tzinfo=timezone.utc))
    fake = Path("/Users/x/.claude/projects/-Users-x-claude-project/claude-sid-1.jsonl")
    store.update_transcript(fake, events)

    snap = store.snapshot()
    assert snap["sessions"][0]["events"][0]["status"] == "stale"
