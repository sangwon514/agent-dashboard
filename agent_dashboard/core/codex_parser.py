from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Iterable

from .model import AgentEvent
from .parser import ParsedEvents

_STALE_AFTER_SEC = 600

# Codex 펫 다양화: description 키워드로 3개 버킷에 분류 → spriteFor 매핑.
# edit/shell 패턴에 안 잡히면 exec 폴백 (build/test/run/git 등 대다수).
_CODEX_EDIT_PAT = re.compile(
    r"apply_patch|edit_file|write_file|\btouch\b|\bsed\b|\bvim\b|\bnano\b|\bmv \b|\bcp \b|\bmkdir\b|\brm \b|>\s*\S+",
    re.I,
)
_CODEX_SHELL_PAT = re.compile(
    r"\b(ls|cat|grep|find|head|tail|less|more|pwd|wc|tree|read_file|search|rg|file|stat|du|df|env|which|whereis|history|ps|top|date)\b",
    re.I,
)
# 특정 IDE/Desktop originator 는 자기 sprite 유지 (vscode-pet 큐브). 그 외 generic 은 버킷 분류.
_CODEX_SPECIFIC_ORIG = {"codex-vscode", "codex-vsc", "codex-ide", "codex-desktop"}


def _classify_codex(desc: str) -> str:
    if not desc:
        return "exec"
    if _CODEX_EDIT_PAT.search(desc):
        return "edit"
    if _CODEX_SHELL_PAT.search(desc):
        return "shell"
    return "exec"


def _parse_ts(s: str | None) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def slug_from_cwd(cwd: str) -> str:
    """Codex `cwd` → 프로젝트 slug.
    Claude 의 `~/.claude/projects/<slug>/` 와 정렬: `/Users/x/foo/bar` → `-Users-x-foo-bar`.
    """
    if not cwd:
        return ""
    return cwd.replace("/", "-").replace(".", "-")


def _summarize_args(args_raw: str) -> tuple[str, str]:
    """function_call.arguments (JSON 문자열) → (description, prompt_first_line)."""
    if not args_raw:
        return ("", "")
    try:
        d = json.loads(args_raw)
        if isinstance(d, dict):
            # 우선순위 키 — Codex 의 exec_command 는 cmd, apply_patch 는 input 등
            for key in ("cmd", "input", "command", "path", "text", "instructions"):
                v = d.get(key)
                if isinstance(v, str) and v.strip():
                    first = v.splitlines()[0]
                    return (first[:120], first[:80])
            # fallback: 첫 string 값
            for v in d.values():
                if isinstance(v, str) and v.strip():
                    first = v.splitlines()[0]
                    return (first[:120], first[:80])
    except (json.JSONDecodeError, AttributeError):
        pass
    first = args_raw.splitlines()[0]
    return (first[:120], first[:80])


def _exit_code_from_output(output: str) -> int | None:
    """function_call_output 헤더의 `Process exited with code N` 추출."""
    if not output:
        return None
    for line in output.splitlines()[:6]:  # 상단 6줄만 확인 (헤더 영역)
        if line.startswith("Process exited with code "):
            try:
                return int(line.split()[-1])
            except (ValueError, IndexError):
                return None
    return None


def parse_codex_jsonl(
    lines: Iterable[str],
    *,
    project_slug: str = "",
    session_id: str = "",
    now: datetime | None = None,
) -> ParsedEvents:
    """Codex rollout JSONL → call_id → AgentEvent.

    `session_meta` (첫 줄) 에서 cwd / id 자동 추출. 인자로 명시하면 그게 우선.
    `function_call` + matching `function_call_output` (by call_id) 페어를 하나의 AgentEvent 로.

    Defensive: 알 수 없는 type / 필드 shape 는 무시.
    """
    now = now or datetime.now(timezone.utc)
    events = ParsedEvents()
    outputs: dict[str, dict] = {}
    parse_failures = 0

    meta_cwd = ""
    meta_session = ""
    meta_originator = ""
    max_total_tokens: int | None = None

    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            parse_failures += 1
            continue

        ts = _parse_ts(d.get("timestamp"))
        outer_type = d.get("type")
        payload = d.get("payload")
        if not isinstance(payload, dict):
            continue

        if outer_type == "session_meta":
            meta_cwd = str(payload.get("cwd", "") or "")
            meta_session = str(payload.get("id", "") or "")
            meta_originator = str(payload.get("originator", "") or "")
            continue

        if outer_type == "event_msg":
            if payload.get("type") == "token_count":
                info = payload.get("info")
                usage = info.get("total_token_usage") if isinstance(info, dict) else None
                total_tokens = usage.get("total_tokens") if isinstance(usage, dict) else None
                if isinstance(total_tokens, int):
                    max_total_tokens = (
                        total_tokens
                        if max_total_tokens is None
                        else max(max_total_tokens, total_tokens)
                    )
            continue

        if outer_type != "response_item":
            continue

        ptype = payload.get("type")
        if ptype == "function_call":
            call_id = str(payload.get("call_id", "") or "")
            if not call_id:
                continue
            name = str(payload.get("name", "") or "")
            args_raw = payload.get("arguments", "") or ""
            desc, first = _summarize_args(args_raw if isinstance(args_raw, str) else "")
            # Codex 도구 이름이 거의 단일(exec_command)이라 description 에 도구명 prefix 로 구분 도움.
            if name and not desc.startswith(name):
                desc = f"{name}: {desc}"[:120]
            # 펫 매핑: IDE originator (vscode/desktop/ide) 는 유지, 그 외 generic 은
            # description 키워드로 shell/edit/exec 3 버킷 분류 → 한 세션 내 다양성.
            raw_orig = (meta_originator or "codex").strip()
            norm_orig = raw_orig.lower().replace("_", "-").replace(" ", "-")
            if not norm_orig.startswith("codex"):
                norm_orig = f"codex-{norm_orig}"
            if norm_orig in _CODEX_SPECIFIC_ORIG:
                pet_type = norm_orig
            else:
                pet_type = f"codex-{_classify_codex(desc)}"
            # function_call.name 은 description 에 prefix 로 이미 노출됨 — 정보 보존.
            events[call_id] = AgentEvent(
                source="transcript",
                project_slug=project_slug or slug_from_cwd(meta_cwd),
                project_cwd=meta_cwd,
                session_id=session_id or meta_session,
                tool_use_id=call_id,
                subagent_type=pet_type or None,
                description=desc,
                prompt_first_line=first,
                started_at=ts,
                tool="codex",
            )
        elif ptype == "function_call_output":
            call_id = str(payload.get("call_id", "") or "")
            if not call_id:
                continue
            output = str(payload.get("output", "") or "")
            exit_code = _exit_code_from_output(output)
            outputs[call_id] = {
                "ts": ts,
                "is_error": exit_code is not None and exit_code != 0,
            }

    for call_id, ev in events.items():
        r = outputs.get(call_id)
        if r is not None:
            ev.finished_at = r["ts"]
            ev.is_error = r["is_error"]
            ev.status = "failed" if r["is_error"] else "done"
        else:
            age = (now - ev.started_at).total_seconds()
            ev.status = "stale" if age > _STALE_AFTER_SEC else "running"

    if max_total_tokens is not None and events:
        latest = max(events.values(), key=lambda event: event.started_at)
        latest.tokens = max_total_tokens

    events.parse_failures = parse_failures
    return events
