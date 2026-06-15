"""Standalone tests for core.parser. Run via: python3 -m unittest tests.test_parser"""
from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path

from agent_dashboard.core.parser import display_project_name, parse_jsonl

FIXTURES = Path(__file__).parent / "fixtures"


def _now() -> datetime:
    return datetime(2026, 5, 8, 1, 5, 0, tzinfo=timezone.utc)


def _parse_fixture(name: str, *, now: datetime | None = None):
    with (FIXTURES / name).open() as f:
        return parse_jsonl(
            f,
            project_slug="test-slug",
            project_cwd="/tmp/test",
            session_id=f"sess-{name}",
            now=now or _now(),
        )


class ParseJsonlTests(unittest.TestCase):
    def setUp(self):
        self.path = FIXTURES / "sample.jsonl"
        with self.path.open() as f:
            self.events = parse_jsonl(
                f,
                project_slug="test-slug",
                project_cwd="/tmp/test",
                session_id="sess-1",
                now=_now(),
            )

    def test_extracts_three_agent_calls_only(self):
        # 4 Agent tool_use 가 있지만 tu-001 은 Bash 라 제외 = 3건
        self.assertEqual(set(self.events.keys()), {"tu-002", "tu-003", "tu-004"})

    def test_done_status_when_result_no_error(self):
        ev = self.events["tu-002"]
        self.assertEqual(ev.status, "done")
        self.assertFalse(ev.is_error)
        self.assertEqual(ev.subagent_type, "code-reviewer")
        self.assertIsNotNone(ev.finished_at)
        self.assertEqual(ev.duration_sec, 30.0)

    def test_failed_status_when_is_error(self):
        ev = self.events["tu-003"]
        self.assertEqual(ev.status, "failed")
        self.assertTrue(ev.is_error)
        self.assertIsNone(ev.subagent_type)  # fork = None

    def test_running_when_no_result_yet(self):
        ev = self.events["tu-004"]
        self.assertEqual(ev.status, "running")
        self.assertIsNone(ev.finished_at)
        self.assertIsNone(ev.tokens)

    def test_tool_result_tokens_extracted_from_top_level_tool_use_result(self):
        lines = [
            '{"timestamp":"2026-05-08T01:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"tu-token","input":{"subagent_type":"explorer","description":"Count tokens","prompt":"Inspect tokens"}}]}}',
            '{"timestamp":"2026-05-08T01:00:05Z","toolUseResult":{"totalTokens":74151,"totalToolUseCount":3},"message":{"content":[{"type":"tool_result","tool_use_id":"tu-token","is_error":false}]}}',
        ]
        evs = parse_jsonl(lines, project_slug="t", project_cwd="/", session_id="s")
        ev = evs["tu-token"]
        self.assertEqual(ev.tokens, 74151)
        self.assertEqual(ev.tool_use_count, 3)

    def test_tool_result_without_token_metadata_leaves_tokens_none(self):
        lines = [
            '{"timestamp":"2026-05-08T01:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"tu-no-token","input":{"subagent_type":"explorer","description":"No token metadata","prompt":"Inspect tokens"}}]}}',
            '{"timestamp":"2026-05-08T01:00:05Z","message":{"content":[{"type":"tool_result","tool_use_id":"tu-no-token","is_error":false}]}}',
        ]
        evs = parse_jsonl(lines, project_slug="t", project_cwd="/", session_id="s")
        ev = evs["tu-no-token"]
        self.assertIsNone(ev.tokens)
        self.assertIsNone(ev.tool_use_count)

    def test_garbage_lines_ignored(self):
        # garbage line + non-list content line 이 있어도 위 3개는 정상 추출
        self.assertEqual(len(self.events), 3)
        self.assertEqual(self.events.parse_failures, 1)

    def test_valid_lines_report_zero_parse_failures(self):
        lines = [
            '{"timestamp":"2026-05-08T01:00:00Z","message":{"content":[]}}',
        ]
        evs = parse_jsonl(lines, project_slug="t", project_cwd="/", session_id="s")
        self.assertEqual(evs.parse_failures, 0)

    def test_stale_after_timeout(self):
        # 11분 후 시점이면 tu-004 는 stale
        late = datetime(2026, 5, 8, 1, 14, 0, tzinfo=timezone.utc)
        with self.path.open() as f:
            evs = parse_jsonl(f, project_slug="t", project_cwd="/", session_id="s", now=late)
        self.assertEqual(evs["tu-004"].status, "stale")
        # done 은 그대로 done
        self.assertEqual(evs["tu-002"].status, "done")

    def test_orphaned_after_idle_timeout(self):
        late = datetime(2026, 5, 8, 1, 34, 1, tzinfo=timezone.utc)
        with self.path.open() as f:
            evs = parse_jsonl(f, project_slug="t", project_cwd="/", session_id="s", now=late)
        self.assertEqual(evs["tu-004"].status, "orphaned")

    def test_idle_timeout_uses_last_transcript_activity(self):
        lines = [
            '{"timestamp":"2026-05-08T01:00:00Z","message":{"content":[{"type":"tool_use","name":"Agent","id":"tu-running","input":{"description":"Pending agent"}}]}}',
            '{"timestamp":"2026-05-08T01:25:00Z","message":{"content":[{"type":"text","text":"still active"}]}}',
        ]
        now = datetime(2026, 5, 8, 1, 50, 1, tzinfo=timezone.utc)
        evs = parse_jsonl(lines, project_slug="t", project_cwd="/", session_id="s", now=now)
        self.assertEqual(evs["tu-running"].status, "stale")

    def test_prompt_first_line_truncated(self):
        ev = self.events["tu-002"]
        self.assertEqual(ev.prompt_first_line, "Review the current branch.")

    def test_sidechain_subagent_extracted(self):
        events = _parse_fixture(
            "sidechain_subagent.jsonl",
            now=datetime(2026, 5, 8, 2, 5, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(set(events.keys()), {"sc-parent", "sc-child"})
        parent = events["sc-parent"]
        child = events["sc-child"]

        self.assertEqual(parent.status, "done")
        self.assertEqual(parent.subagent_type, "explorer")
        self.assertEqual(parent.description, "Explore parser sidechain handling")
        self.assertEqual(parent.duration_sec, 120.0)

        self.assertEqual(child.status, "done")
        self.assertEqual(child.subagent_type, "code-reviewer")
        self.assertEqual(child.prompt_first_line, "Review sidechain fixture coverage.")
        self.assertEqual(child.duration_sec, 45.0)
        self.assertEqual(events.parse_failures, 0)

    def test_malformed_does_not_raise(self):
        events = _parse_fixture(
            "malformed_edge.jsonl",
            now=datetime(2026, 5, 8, 3, 5, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(set(events.keys()), {"edge-missing-ts", "edge-partial"})
        self.assertEqual(events.parse_failures, 1)

        missing_ts = events["edge-missing-ts"]
        self.assertEqual(missing_ts.subagent_type, "explorer")
        self.assertEqual(missing_ts.description, "Missing timestamp still parses")
        self.assertEqual(missing_ts.prompt_first_line, "Handle missing timestamp")

        partial = events["edge-partial"]
        self.assertIsNone(partial.subagent_type)
        self.assertEqual(partial.description, "")
        self.assertEqual(partial.prompt_first_line, "")


class DisplayNameTests(unittest.TestCase):
    def test_strips_users_prefix(self):
        slug = "-Users-alice-projects-some-org-my-project"
        # 'Users' + user 한 segment 제거 후 나머지 join
        name = display_project_name(slug)
        self.assertIn("my-project", name)
        self.assertNotIn("Users", name)
        self.assertNotIn("alice", name)

    def test_empty_slug(self):
        self.assertEqual(display_project_name(""), "?")


if __name__ == "__main__":
    unittest.main()
