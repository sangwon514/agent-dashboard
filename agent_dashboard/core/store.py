from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Callable

from .model import AgentEvent, WtStatusEntry
from .parser import display_project_name, idle_status

log = logging.getLogger(__name__)

# live 스냅샷(HTTP/SSE)용 트림 — UI 가 안 보여주는 것은 전송하지 않아 페이로드/렉 절감.
_LIVE_RECENT_SEC = 2 * 3600  # UI 는 1h 내만 표시; 서버는 여유 있게 2h 전송
_LIVE_EVENT_CAP = 60         # 거대 세션 events 폭주 방지 (UI 는 events 를 펫으로 집계)


class Store:
    """Thread-safe in-memory store for transcript events + wt-status entries."""

    def __init__(self, now: Callable[[], datetime] | None = None):
        self._lock = Lock()
        self._transcript: dict[str, dict[str, AgentEvent]] = {}
        self._session_meta: dict[str, dict] = {}
        self._offsets: dict[Path, int] = {}
        self._wt: dict[str, WtStatusEntry] = {}
        self._parse_failures: dict[str, int] = {
            "claude": 0,
            "codex": 0,
            "cursor": 0,
        }
        self._subs: list[Callable[[], None]] = []
        self._now = now or (lambda: datetime.now(timezone.utc))

    def subscribe(self, fn: Callable[[], None]) -> None:
        with self._lock:
            self._subs.append(fn)

    def _notify(self) -> None:
        for fn in list(self._subs):
            try:
                fn()
            except Exception as exc:
                log.debug("subscriber raised: %s", exc)

    def get_transcript_offset(self, path: Path) -> int:
        with self._lock:
            return self._offsets.get(_path_key(path), 0)

    def set_transcript_offset(self, path: Path, offset: int) -> None:
        with self._lock:
            self._offsets[_path_key(path)] = offset

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
            (
                getattr(e, "last_activity", None) or e.finished_at or e.started_at
                for e in events.values()
            ),
            default=self._now(),
        )
        parse_failures = int(getattr(events, "parse_failures", 0) or 0)
        with self._lock:
            self._transcript[session_id] = events
            self._session_meta[session_id] = {
                "project_slug": project_slug,
                "project_cwd": project_cwd,
                "tool": tool,
                "last_activity": last,
            }
            if parse_failures:
                self._parse_failures[tool] = (
                    self._parse_failures.get(tool, 0) + parse_failures
                )
        self._notify()

    def update_wt_status(self, entries: dict[str, WtStatusEntry]) -> None:
        with self._lock:
            self._wt = entries
        self._notify()

    def snapshot(self, *, live: bool = False) -> dict:
        """전체 스냅샷. `live=True` 면 UI 가 실제 표시하는 것만 트림해서 반환
        (slug 없음 / 오래됨 세션 제외 + 세션당 events 상한) — HTTP/SSE 페이로드 절감.
        `live=False`(기본) 는 전체 — 내부/테스트용으로 동작 불변.
        """
        now = self._now()
        with self._lock:
            sessions = []
            for sid, evs in self._transcript.items():
                meta = self._session_meta.get(sid, {})
                slug = meta.get("project_slug", "")
                last_activity = meta.get("last_activity")
                if live:
                    # UI 는 slug 없는 / 1h 초과 세션을 숨김 → 아예 전송 안 함.
                    if not slug:
                        continue
                    if last_activity is not None and (
                        now - last_activity
                    ).total_seconds() > _LIVE_RECENT_SEC:
                        continue
                ev_iter = evs.values()
                if live and len(evs) > _LIVE_EVENT_CAP:
                    ev_iter = sorted(
                        evs.values(), key=lambda e: e.started_at, reverse=True
                    )[:_LIVE_EVENT_CAP]
                sessions.append(
                    {
                        "session_id": sid,
                        "project_slug": slug,
                        "project_cwd": meta.get("project_cwd", ""),
                        "project_display": display_project_name(slug),
                        "tool": meta.get("tool", "claude"),
                        "last_activity": (last_activity or now).isoformat(),
                        "events": [
                            self._event_dict(e, now=now, last_activity=last_activity)
                            for e in ev_iter
                        ],
                    }
                )
            wt = [self._wt_dict(e) for e in self._wt.values()]
        return {
            "generated_at": now.isoformat(),
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
                "parse_failures": dict(self._parse_failures),
            }

    @staticmethod
    def _event_dict(
        e: AgentEvent,
        *,
        now: datetime,
        last_activity: datetime | None = None,
    ) -> dict:
        status = e.status
        if status in ("running", "stale", "orphaned"):
            status = idle_status(e.started_at, now, last_activity=last_activity)
        return {
            "tool_use_id": e.tool_use_id,
            "subagent_type": e.subagent_type,
            "description": e.description,
            "prompt_first_line": e.prompt_first_line,
            "started_at": e.started_at.isoformat(),
            "age_sec": max(0.0, (now - e.started_at).total_seconds()),
            "finished_at": e.finished_at.isoformat() if e.finished_at else None,
            "status": status,
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


def _path_key(path: Path) -> Path:
    try:
        return path.resolve()
    except OSError:
        return path
