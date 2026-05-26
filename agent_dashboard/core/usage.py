from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

STATUS_PATH = Path("/tmp/agentville-out/claude-status.json")


def read_claude_usage() -> dict[str, Any] | None:
    if not STATUS_PATH.exists():
        return None
    try:
        raw = json.loads(STATUS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    rl = raw.get("rate_limits") or {}
    five = rl.get("five_hour") or {}
    seven = rl.get("seven_day") or {}
    mtime = STATUS_PATH.stat().st_mtime
    now = time.time()
    return {
        "source": "claude",
        "five_hour": {
            "used_percentage": five.get("used_percentage"),
            "resets_at": five.get("resets_at"),
            "seconds_until_reset": _seconds_until(five.get("resets_at"), now),
        },
        "seven_day": {
            "used_percentage": seven.get("used_percentage"),
            "resets_at": seven.get("resets_at"),
            "seconds_until_reset": _seconds_until(seven.get("resets_at"), now),
        },
        "age_seconds": int(now - mtime),
        "stale": (now - mtime) > 300,
    }


def _seconds_until(epoch: Any, now: float) -> int | None:
    if epoch is None:
        return None
    try:
        left = int(float(epoch) - now)
    except (TypeError, ValueError):
        return None
    return max(left, 0)
