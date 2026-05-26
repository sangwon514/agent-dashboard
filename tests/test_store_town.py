from pathlib import Path

from agent_dashboard.core.codex_parser import parse_codex_jsonl
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
