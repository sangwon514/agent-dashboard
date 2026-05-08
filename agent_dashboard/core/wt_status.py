from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from .model import WtStatusEntry, WtStatusTask

log = logging.getLogger(__name__)

WT_STATUS_DIR = Path("/tmp/wt-status")


def parse_wt_file(path: Path) -> WtStatusEntry | None:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(d, dict):
        return None
    tasks: list[WtStatusTask] = []
    for t in d.get("tasks", []) or []:
        if isinstance(t, dict):
            tasks.append(
                WtStatusTask(
                    name=str(t.get("name", "?")),
                    status=str(t.get("status", "pending")),
                )
            )
    updated = None
    if d.get("updated_at"):
        try:
            updated = datetime.fromisoformat(str(d["updated_at"]))
        except ValueError:
            updated = None
    return WtStatusEntry(
        worktree=str(d.get("worktree", path.stem)),
        domain=str(d.get("domain", "?")),
        branch=str(d.get("branch", "")),
        tasks=tasks,
        updated_at=updated,
    )


class WtStatusWatcher:
    """Watch /tmp/wt-status/*.json (legacy worktree board)."""

    def __init__(self, on_change: Callable[[dict[str, WtStatusEntry]], None]):
        self.on_change = on_change
        self._observer = Observer()
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        WT_STATUS_DIR.mkdir(parents=True, exist_ok=True)
        handler = _Handler(self)
        self._observer.schedule(handler, str(WT_STATUS_DIR), recursive=False)
        self._observer.start()
        self._started = True
        self._rescan()

    def stop(self) -> None:
        if not self._started:
            return
        self._observer.stop()
        self._observer.join(timeout=5)

    def _rescan(self) -> None:
        entries: dict[str, WtStatusEntry] = {}
        if WT_STATUS_DIR.exists():
            for f in WT_STATUS_DIR.glob("*.json"):
                e = parse_wt_file(f)
                if e:
                    entries[e.worktree] = e
        try:
            self.on_change(entries)
        except Exception as exc:
            log.debug("wt_status on_change failed: %s", exc)


class _Handler(FileSystemEventHandler):
    def __init__(self, w: WtStatusWatcher):
        self._w = w

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        if str(event.src_path).endswith(".json"):
            self._w._rescan()
