from datetime import datetime, timezone
from pathlib import Path

from agent_dashboard.core.codex_parser import parse_codex_jsonl, slug_from_cwd

FIXTURE = Path(__file__).parent / "fixtures" / "codex" / "rollout-sample.jsonl"


def _load():
    with FIXTURE.open("r", encoding="utf-8") as f:
        return f.read().splitlines()


def test_slug_from_cwd():
    assert slug_from_cwd("/Users/x/foo/bar") == "-Users-x-foo-bar"
    assert slug_from_cwd("") == ""
    assert slug_from_cwd("/a.b/c") == "-a-b-c"


def test_session_meta_extraction():
    # `now` 를 멀리 미래로 주면 미완성 이벤트가 stale 처리되어 항목은 그대로 남음.
    now = datetime(2026, 5, 13, 3, 0, 0, tzinfo=timezone.utc)
    events = parse_codex_jsonl(_load(), now=now)
    assert len(events) == 3, f"expected 3 function_calls, got {len(events)}"
    # 모든 이벤트가 session_meta 의 cwd / id 를 흡수했는지
    sample = next(iter(events.values()))
    assert sample.session_id == "019e1f0d-7df6-7213-b6cd-9cfbf4001fb9"
    assert sample.project_cwd.endswith("contrabass-admin-service")
    assert sample.project_slug.startswith("-Users-sangwonlee-")
    assert sample.tool == "codex"
    assert sample.source == "transcript"


def test_function_call_done():
    now = datetime(2026, 5, 13, 3, 0, 0, tzinfo=timezone.utc)
    events = parse_codex_jsonl(_load(), now=now)
    ev = events["call_AAA"]
    assert ev.status == "done"
    assert ev.is_error is False
    # subagent_type 은 command 행동 기반 분류 (Option A): `ls` → shell 버킷 → `codex-shell`.
    # function_call.name 은 description prefix 로 보존.
    assert ev.subagent_type == "codex-shell"
    assert "exec_command" in ev.description
    # description: name prefix + cmd 첫 줄
    assert ev.description.startswith("exec_command:")
    assert "ls -la /tmp" in ev.description
    assert ev.finished_at is not None
    assert ev.duration_sec is not None and ev.duration_sec > 0


def test_function_call_failed_via_exit_code():
    now = datetime(2026, 5, 13, 3, 0, 0, tzinfo=timezone.utc)
    events = parse_codex_jsonl(_load(), now=now)
    ev = events["call_BBB"]
    assert ev.status == "failed"
    assert ev.is_error is True
    # subagent_type 은 command 행동 기반 분류 (Option A): `apply_patch` → edit 버킷 → `codex-edit`.
    # function_call.name 은 description 에 포함
    assert ev.subagent_type == "codex-edit"
    assert "apply_patch" in ev.description


def test_function_call_still_running_when_no_output():
    # `now` 가 시작 직후라면 running, 멀리 후면 stale.
    now_close = datetime(2026, 5, 13, 1, 58, 12, tzinfo=timezone.utc)
    events = parse_codex_jsonl(_load(), now=now_close)
    ev = events["call_CCC"]
    assert ev.status == "running"
    assert ev.finished_at is None


def test_function_call_goes_stale_after_timeout():
    now_far = datetime(2026, 5, 13, 4, 0, 0, tzinfo=timezone.utc)  # +2h
    events = parse_codex_jsonl(_load(), now=now_far)
    ev = events["call_CCC"]
    assert ev.status == "stale"


def test_unknown_lines_ignored():
    # reasoning / event_msg / 빈 줄 등은 무시되어야 함.
    junk = [
        "",
        "not json at all",
        '{"type":"something_unknown","payload":{}}',
        '{"type":"response_item","payload":{"type":"reasoning"}}',
    ]
    events = parse_codex_jsonl(junk + _load(), now=datetime(2026, 5, 13, 3, 0, 0, tzinfo=timezone.utc))
    assert len(events) == 3
    assert events.parse_failures == 1


def test_valid_lines_report_zero_parse_failures():
    events = parse_codex_jsonl(
        ['{"type":"response_item","payload":{"type":"reasoning"}}'],
        now=datetime(2026, 5, 13, 3, 0, 0, tzinfo=timezone.utc),
    )
    assert events.parse_failures == 0


def test_explicit_overrides_win():
    events = parse_codex_jsonl(
        _load(),
        project_slug="override-slug",
        session_id="override-sid",
        now=datetime(2026, 5, 13, 3, 0, 0, tzinfo=timezone.utc),
    )
    sample = next(iter(events.values()))
    assert sample.project_slug == "override-slug"
    assert sample.session_id == "override-sid"


def test_token_count_total_tokens_sets_latest_representative_event():
    lines = [
        '{"timestamp":"2026-05-13T01:57:24.927Z","type":"session_meta","payload":{"id":"sid","cwd":"/tmp/project","originator":"codex_exec"}}',
        '{"timestamp":"2026-05-13T01:57:33.822Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"ls\\"}","call_id":"call_first"}}',
        '{"timestamp":"2026-05-13T01:57:34.033Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_first","output":"Process exited with code 0"}}',
        '{"timestamp":"2026-05-13T01:57:40.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":100}}}}',
        '{"timestamp":"2026-05-13T01:58:00.100Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\\"cmd\\":\\"pwd\\"}","call_id":"call_last"}}',
        '{"timestamp":"2026-05-13T01:58:01.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":150}}}}',
    ]
    events = parse_codex_jsonl(
        lines,
        now=datetime(2026, 5, 13, 1, 58, 30, tzinfo=timezone.utc),
    )

    assert events["call_first"].tokens is None
    assert events["call_last"].tokens == 150
