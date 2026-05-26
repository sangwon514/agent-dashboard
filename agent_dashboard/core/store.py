from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Callable

from .model import AgentEvent, WtStatusEntry
from .parser import display_project_name

log = logging.getLogger(__name__)


class Store:
    """Thread-safe in-memory store for transcript events + wt-status entries."""

    def __init__(self):
        self._lock = Lock()
        self._transcript: dict[str, dict[str, AgentEvent]] = {}
        self._session_meta: dict[str, dict] = {}
        self._wt: dict[str, WtStatusEntry] = {}
        self._subs: list[Callable[[], None]] = []

    def subscribe(self, fn: Callable[[], None]) -> None:
        with self._lock:
            self._subs.append(fn)

    def _notify(self) -> None:
        for fn in list(self._subs):
            try:
                fn()
            except Exception as exc:
                log.debug("subscriber raised: %s", exc)

    def update_transcript(
        self,
        path: Path,
        events: dict[str, AgentEvent],
        tool: str = "claude",
    ) -> None:
        # session metadata 는 events 에서 추출 (parser 가 이미 채워둠).
        # Claude (~/.claude/projects/<slug>/<sid>.jsonl) 와 Codex (~/.codex/sessions/Y/M/D/rollout-*.jsonl)
        # 디렉토리 구조가 달라 path 에서 직접 뽑으면 안 됨.
        # `tool` 인자: watcher 가 root 기준으로 명시 전달 — events 비어도 town 분류 정확.
        if events:
            sample = next(iter(events.values()))
            session_id = sample.session_id or path.stem
            project_slug = sample.project_slug or path.parent.name
            project_cwd = sample.project_cwd or str(path.parent)
            tool = sample.tool or tool
        else:
            # 빈 파일 — path.stem 만 신뢰. project_slug 는 비워둠 (Codex day 폴더명 같은 noise 차단).
            session_id = path.stem
            project_slug = ""
            project_cwd = str(path.parent)
            # tool 은 인자값 그대로 (watcher 가 알려준 root 의 tool)
        last = max(
            (e.finished_at or e.started_at for e in events.values()),
            default=datetime.now(timezone.utc),
        )
        with self._lock:
            self._transcript[session_id] = events
            self._session_meta[session_id] = {
                "project_slug": project_slug,
                "project_cwd": project_cwd,
                "tool": tool,
                "last_activity": last,
            }
        self._notify()

    def update_wt_status(self, entries: dict[str, WtStatusEntry]) -> None:
        with self._lock:
            self._wt = entries
        self._notify()

    def snapshot(self) -> dict:
        with self._lock:
            sessions = []
            for sid, evs in self._transcript.items():
                meta = self._session_meta.get(sid, {})
                sessions.append(
                    {
                        "session_id": sid,
                        "project_slug": meta.get("project_slug", ""),
                        "project_cwd": meta.get("project_cwd", ""),
                        "project_display": display_project_name(meta.get("project_slug", "")),
                        "tool": meta.get("tool", "claude"),
                        "last_activity": meta.get(
                            "last_activity", datetime.now(timezone.utc)
                        ).isoformat(),
                        "events": [self._event_dict(e) for e in evs.values()],
                    }
                )
            wt = [self._wt_dict(e) for e in self._wt.values()]
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sessions": sessions,
            "wt_status": wt,
        }

    def health(self) -> dict:
        with self._lock:
            last = max(
                (meta.get("last_activity") for meta in self._session_meta.values()),
                default=None,
            )
            return {
                "last_event_at": last.isoformat() if last else None,
                "session_count": len(self._transcript),
            }

    @staticmethod
    def _event_dict(e: AgentEvent) -> dict:
        return {
            "tool_use_id": e.tool_use_id,
            "subagent_type": e.subagent_type,
            "description": e.description,
            "prompt_first_line": e.prompt_first_line,
            "started_at": e.started_at.isoformat(),
            "finished_at": e.finished_at.isoformat() if e.finished_at else None,
            "status": e.status,
            "is_error": e.is_error,
            "duration_sec": e.duration_sec,
        }

    @staticmethod
    def _wt_dict(w: WtStatusEntry) -> dict:
        return {
            "worktree": w.worktree,
            "domain": w.domain,
            "branch": w.branch,
            "tasks": [{"name": t.name, "status": t.status} for t in w.tasks],
            "updated_at": w.updated_at.isoformat() if w.updated_at else None,
        }
