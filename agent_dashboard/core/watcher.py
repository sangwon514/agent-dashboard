from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock
from typing import Callable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
# macOS FSEvents 가 jsonl 의 append-only 수정을 종종 놓침 → PollingObserver 로 강제 폴링.
# Linux/Windows 에서도 안정. 1인 로컬이라 CPU 비용 무시 가능.
from watchdog.observers.polling import PollingObserver as Observer

from .codex_parser import parse_codex_jsonl
from .cursor_parser import parse_cursor_jsonl, parse_cursor_session
from .model import AgentEvent
from .parser import parse_jsonl

log = logging.getLogger(__name__)

CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"
CODEX_SESSIONS_DIR = Path.home() / ".codex" / "sessions"
CURSOR_PROJECTS_DIR = Path.home() / ".cursor" / "projects"

# (root_dir, tool_name, parser_callable, file_glob) — 새 source 추가 시 한 줄.
# parser 시그니처는 동일: (lines, *, project_slug, session_id, now) → dict[str, AgentEvent]
WATCH_ROOTS: list[tuple[Path, str, Callable, str]] = [
    (CLAUDE_PROJECTS_DIR, "claude", parse_jsonl, "*.jsonl"),
    (CODEX_SESSIONS_DIR, "codex", parse_codex_jsonl, "rollout-*.jsonl"),
    (CURSOR_PROJECTS_DIR, "cursor", parse_cursor_jsonl, "*.jsonl"),
]


class JsonlWatcher:
    """Watch ~/.claude/projects AND ~/.codex/sessions recursively. On any matching
    *.jsonl change re-parse with the appropriate parser and call
    `on_change(path, events)`. Each AgentEvent carries `tool` so downstream can
    group by town.

    Whole-file re-parse keeps the code simple. Append-only logs parse in ms.
    """

    def __init__(self, on_change: Callable[[Path, dict[str, AgentEvent], str], None]):
        # on_change signature: (path, events, tool)
        self.on_change = on_change
        self._observer = Observer()
        self._lock = Lock()
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        handler = _JsonlHandler(self)
        for root, _tool, _parser, _glob in WATCH_ROOTS:
            root.mkdir(parents=True, exist_ok=True)
            self._observer.schedule(handler, str(root), recursive=True)
        self._observer.start()
        self._started = True
        # 초기 백필 — 각 root 의 기존 파일 모두 1회 파싱.
        for root, _tool, _parser, glob in WATCH_ROOTS:
            for f in root.rglob(glob):
                self._reparse(f)

    def stop(self) -> None:
        if not self._started:
            return
        self._observer.stop()
        self._observer.join(timeout=5)

    def is_alive(self) -> bool:
        return self._started and self._observer.is_alive()

    def _root_for(self, path: Path) -> tuple[Path, str, Callable, str] | None:
        """path 가 어느 WATCH_ROOT 아래에 있는지 찾기. 못 찾으면 None."""
        try:
            resolved = path.resolve()
        except OSError:
            resolved = path
        for entry in WATCH_ROOTS:
            root = entry[0]
            try:
                resolved.relative_to(root)
                return entry
            except ValueError:
                continue
        return None

    def _reparse(self, path: Path) -> None:
        entry = self._root_for(path)
        if entry is None:
            return
        _root, tool, parser, glob = entry
        # 파일명 패턴이 안 맞으면 무시 (e.g. Codex root 의 .meta 파일들).
        from fnmatch import fnmatch
        if not fnmatch(path.name, glob):
            return
        if tool == "cursor" and "subagents" in path.parts:
            parent_path = _cursor_parent_main_path(path, _root)
            if parent_path is None:
                return
            path = parent_path
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                if tool == "claude":
                    # Claude: project_slug = parent dir, session_id = file stem
                    events = parser(
                        f,
                        project_slug=path.parent.name,
                        project_cwd=str(path.parent),
                        session_id=path.stem,
                    )
                elif tool == "codex":
                    # Codex: parser 가 session_meta 에서 자동 추출 (인자 비우면 됨).
                    events = parser(f)
                else:
                    project_slug, session_id = _cursor_path_meta(path, _root)
                    if _is_cursor_main_transcript(path, _root):
                        events = parse_cursor_session(
                            f,
                            _cursor_subagent_files(path),
                            project_slug=project_slug,
                            session_id=session_id,
                        )
                    else:
                        events = parser(
                            f,
                            project_slug=project_slug,
                            session_id=session_id,
                        )
            with self._lock:
                # on_change 시그니처가 historical 으로 (path, events) — tool 은 events
                # 의 첫 sample 이나 path root 로 추론 가능하지만, 빈 events 의 경우
                # 명시 전달이 필요. on_change 가 dict.get('tool') 같은 형태로 받게
                # 하는 대신 thread-local 로 우회하지 않고 events 메타로 우회.
                # Codex parser 는 빈 events 도 tool="codex" 정보를 잃지 않게 메타 활용.
                self.on_change(path, events, tool)
        except (OSError, IOError) as e:
            log.debug("reparse failed for %s: %s", path, e)


class _JsonlHandler(FileSystemEventHandler):
    def __init__(self, watcher: JsonlWatcher):
        self._w = watcher

    def _maybe_reparse(self, src_path: str) -> None:
        if not src_path.endswith(".jsonl"):
            return
        self._w._reparse(Path(src_path))

    def on_modified(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        self._maybe_reparse(event.src_path)

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        self._maybe_reparse(event.src_path)

    def on_moved(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        self._maybe_reparse(getattr(event, "dest_path", event.src_path))


def _cursor_path_meta(path: Path, root: Path) -> tuple[str, str]:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return "", path.stem
    parts = rel.parts
    if not parts:
        return "", path.stem
    project_slug = parts[0]
    if len(parts) >= 5 and parts[1] == "agent-transcripts" and parts[3] == "subagents":
        return project_slug, f"{parts[2]}/subagents/{path.stem}"
    if len(parts) >= 3 and parts[1] == "agent-transcripts":
        return project_slug, parts[2]
    return project_slug, path.stem


def _is_cursor_main_transcript(path: Path, root: Path) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return False
    parts = rel.parts
    return (
        len(parts) == 4
        and parts[1] == "agent-transcripts"
        and parts[3] == f"{parts[2]}.jsonl"
    )


def _cursor_parent_main_path(path: Path, root: Path) -> Path | None:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return None
    parts = rel.parts
    if len(parts) != 5 or parts[1] != "agent-transcripts" or parts[3] != "subagents":
        return None
    candidate = root / parts[0] / "agent-transcripts" / parts[2] / f"{parts[2]}.jsonl"
    return candidate if candidate.exists() else None


def _cursor_subagent_files(path: Path) -> list[tuple[str, list[str]]]:
    subagents_dir = path.parent / "subagents"
    if not subagents_dir.is_dir():
        return []
    files: list[tuple[str, list[str]]] = []
    for subagent_path in sorted(subagents_dir.glob("*.jsonl")):
        try:
            lines = subagent_path.read_text(
                encoding="utf-8",
                errors="replace",
            ).splitlines()
        except OSError:
            continue
        files.append((subagent_path.stem, lines))
    return files
