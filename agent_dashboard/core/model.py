from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

Status = Literal["running", "done", "failed", "stale", "orphaned"]
Source = Literal["transcript", "wt_status"]
# Tool = "어느 도구의 세션인가" (마을 분리 키). Claude 마을과 Codex 마을 분리용.
# 신규 source(Cursor 등) 추가 시 union 확장만으로 같은 모델 재사용.
Tool = Literal["claude", "codex", "cursor"]


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
    tool: Tool = "claude"
    tokens: Optional[int] = None
    tool_use_count: Optional[int] = None

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
