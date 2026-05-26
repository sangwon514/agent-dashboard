"""Standalone tests for core.parser. Run via: python3 -m unittest tests.test_parser"""
from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path

from agent_dashboard.core.parser import display_project_name, parse_jsonl

FIXTURES = Path(__file__).parent / "fixtures"


def _now() -> datetime:
    return datetime(2026, 5, 8, 1, 5, 0, tzinfo=timezone.utc)


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

    def test_garbage_lines_ignored(self):
        # garbage line + non-list content line 이 있어도 위 3개는 정상 추출
        self.assertEqual(len(self.events), 3)

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
