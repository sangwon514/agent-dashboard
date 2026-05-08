from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

Status = Literal["running", "done", "failed", "stale", "orphaned"]
Source = Literal["transcript", "wt_status"]


@dataclass
class AgentEvent:
    source: Source
    project_slug: str
    project_cwd: str
    session_id: str
    tool_use_id: str
    subagent_type: Optional[str]
    description: str
    prompt_first_line: str
    started_at: datetime
    finished_at: Optional[datetime] = None
    status: Status = "running"
    is_error: bool = False

    @property
    def duration_sec(self) -> Optional[float]:
        if self.finished_at is None:
            return None
        return (self.finished_at - self.started_at).total_seconds()


@dataclass
class WtStatusTask:
    name: str
    status: str


@dataclass
class WtStatusEntry:
    worktree: str
    domain: str
    branch: str
    tasks: list[WtStatusTask]
    updated_at: Optional[datetime] = None
