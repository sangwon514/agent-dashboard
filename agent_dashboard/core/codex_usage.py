from __future__ import annotations

import glob
import json
import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("agent-dashboard.codex_usage")

CACHE_PATH = Path("/tmp/agentville-out/codex-usage.json")
TTL_SECONDS = 180
RPC_TIMEOUT_SECONDS = 8
BACKOFF_SECONDS = 1800  # 30분 — 연속 실패 시 retry 억제 (CodexBar 와 동일)
MAX_CONSECUTIVE_FAILS = 2

_lock = threading.Lock()
_cache: dict[str, Any] | None = None
_cache_at: float = 0.0
_fail_count = 0
_backoff_until: float = 0.0


def read_codex_usage() -> dict[str, Any] | None:
    """Return normalized codex usage in the same shape as core.usage.read_claude_usage().

    180s in-memory cache. Subprocess to `codex app-server`, JSON-RPC init + rateLimits/read.
    Returns None silently on any failure — frontend treats None as "unavailable".
    """
    global _cache, _cache_at, _fail_count, _backoff_until

    now = time.time()
    with _lock:
        if _cache is not None and (now - _cache_at) < TTL_SECONDS:
            return _refresh_countdowns(_cache, now)
        if now < _backoff_until:
            return _cache  # 백오프 중엔 cache 반환 (None 일 수 있음)

    raw = _fetch_rate_limits()
    with _lock:
        if raw is None:
            _fail_count += 1
            if _fail_count >= MAX_CONSECUTIVE_FAILS:
                _backoff_until = now + BACKOFF_SECONDS
                log.warning("codex usage fetch failed %d times — backing off %ds", _fail_count, BACKOFF_SECONDS)
            return _cache
        _fail_count = 0
        _backoff_until = 0.0
        _cache = _normalize(raw, now)
        _cache_at = now
        try:
            CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            CACHE_PATH.write_text(json.dumps(_cache, indent=2))
        except OSError:
            pass
        return _refresh_countdowns(_cache, now)


def _find_codex_binary() -> str | None:
    env = os.environ.get("CODEX_BIN")
    if env and Path(env).exists():
        return env
    found = shutil.which("codex")
    if found:
        return found
    # menubar 가 spawn 한 serve 프로세스는 PATH=/usr/bin:/bin 만 가짐 → 흔한 설치 위치 fallback
    candidates = [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        str(Path.home() / ".local/bin/codex"),
    ]
    candidates.extend(sorted(glob.glob(str(Path.home() / ".nvm/versions/node/*/bin/codex"))))
    for c in candidates:
        if Path(c).exists():
            return c
    return None


def _fetch_rate_limits() -> dict[str, Any] | None:
    binary = _find_codex_binary()
    if not binary:
        log.debug("codex binary not found on PATH or fallback locations")
        return None

    init = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {"name": "agentville", "version": "0.1.0"},
            "capabilities": {},
        },
    })
    rl = json.dumps({"jsonrpc": "2.0", "id": 2, "method": "account/rateLimits/read", "params": {}})

    env = os.environ.copy()
    # codex 는 `#!/usr/bin/env node` shebang 이라 node 도 PATH 에 있어야 함.
    # menubar-spawned serve 의 PATH 는 /usr/bin:/bin 뿐이라 codex binary 디렉토리(node 동거)를 prepend.
    bin_dir = str(Path(binary).parent)
    env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
    try:
        proc = subprocess.Popen(
            [binary, "-s", "read-only", "-a", "untrusted", "app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
            env=env,
        )
    except OSError as exc:
        log.debug("codex subprocess spawn failed: %s", exc)
        return None

    deadline = time.time() + RPC_TIMEOUT_SECONDS
    result: dict[str, Any] | None = None
    init_done = False
    try:
        assert proc.stdin and proc.stdout
        proc.stdin.write(init + "\n")
        proc.stdin.flush()
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            obj_id = obj.get("id")
            if obj_id == 1 and not init_done:
                init_done = True
                proc.stdin.write(rl + "\n")
                proc.stdin.flush()
                continue
            if obj_id == 2 and "result" in obj:
                result = obj["result"]
                break
    finally:
        try:
            if proc.stdin:
                proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
    return result


def _normalize(rpc_result: dict[str, Any], now: float) -> dict[str, Any]:
    rl = rpc_result.get("rateLimits") or {}
    primary = rl.get("primary") or {}
    secondary = rl.get("secondary") or {}
    return {
        "source": "codex",
        "plan_type": rl.get("planType"),
        "five_hour": _segment(primary),
        "seven_day": _segment(secondary),
        "fetched_at": now,
    }


def _segment(seg: dict[str, Any]) -> dict[str, Any] | None:
    if not seg or seg.get("usedPercent") is None:
        return None
    return {
        "used_percentage": seg.get("usedPercent"),
        "resets_at": seg.get("resetsAt"),
        "window_minutes": seg.get("windowDurationMins"),
    }


def _refresh_countdowns(payload: dict[str, Any] | None, now: float) -> dict[str, Any] | None:
    if not payload:
        return payload
    out = dict(payload)
    for key in ("five_hour", "seven_day"):
        seg = payload.get(key)
        if not seg:
            continue
        new_seg = dict(seg)
        new_seg["seconds_until_reset"] = _seconds_until(seg.get("resets_at"), now)
        out[key] = new_seg
    age = int(now - payload.get("fetched_at", now))
    out["age_seconds"] = age
    out["stale"] = age > TTL_SECONDS * 2
    return out


def _seconds_until(epoch: Any, now: float) -> int | None:
    if epoch is None:
        return None
    try:
        left = int(float(epoch) - now)
    except (TypeError, ValueError):
        return None
    return max(left, 0)
