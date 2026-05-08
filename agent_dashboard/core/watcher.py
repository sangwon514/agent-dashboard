from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock
from typing import Callable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .model import AgentEvent
from .parser import parse_jsonl

log = logging.getLogger(__name__)

CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"


class JsonlWatcher:
    """Watch ~/.claude/projects recursively. On any *.jsonl change re-parse the whole file
    and call `on_change(path, events)`.

    Whole-file re-parse keeps the code simple. A 4MB jsonl parses in ms.
    """

    def __init__(self, on_change: Callable[[Path, dict[str, AgentEvent]], None]):
        self.on_change = on_change
        self._observer = Observer()
        self._lock = Lock()
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        CLAUDE_PROJECTS_DIR.mkdir(parents=True, exist_ok=True)
        handler = _JsonlHandler(self)
        self._observer.schedule(handler, str(CLAUDE_PROJECTS_DIR), recursive=True)
        self._observer.start()
        self._started = True
        for f in CLAUDE_PROJECTS_DIR.rglob("*.jsonl"):
            self._reparse(f)

    def stop(self) -> None:
        if not self._started:
            return
        self._observer.stop()
        self._observer.join(timeout=5)

    def _reparse(self, path: Path) -> None:
        try:
            project_slug = path.parent.name
            session_id = path.stem
            with path.open("r", encoding="utf-8", errors="replace") as f:
                events = parse_jsonl(
                    f,
                    project_slug=project_slug,
                    project_cwd=str(path.parent),
                    session_id=session_id,
                )
            with self._lock:
                self.on_change(path, events)
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
