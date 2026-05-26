#!/bin/bash
# PostToolUse hook: agent_dashboard/ui_web/static/* 편집 후 자동 스크린샷
# stdin: {"tool_name":"Edit|Write|MultiEdit","tool_input":{"file_path":"..."}}
# Non-blocking — exit 0 항상.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# static/ 파일 변경에만 동작
if [[ ! "$FILE_PATH" =~ agent_dashboard/ui_web/static/ ]]; then
  exit 0
fi

# 서버 살아있나 확인 (timeout 1초)
if ! curl -s -m 1 -o /dev/null -w "%{http_code}" http://127.0.0.1:7878/ 2>/dev/null | grep -q "200"; then
  exit 0
fi

# Playwright 하네스 확인
SHOT_JS="/tmp/agentville-test/shot.js"
if [[ ! -f "$SHOT_JS" ]]; then
  echo "ℹ️ post-edit-screenshot: Playwright harness missing at $SHOT_JS — skip" >&2
  exit 0
fi

mkdir -p /tmp/agentville-out
OUT="/tmp/agentville-out/last-edit.png"

# 백그라운드 실행 (편집 흐름 차단 X)
( node "$SHOT_JS" "http://127.0.0.1:7878" "$OUT" >/dev/null 2>&1 && \
  echo "📸 $(date '+%H:%M:%S') $OUT" >> /tmp/agentville-out/screenshot.log ) &

exit 0
