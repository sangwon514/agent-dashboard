#!/usr/bin/env bash
# Agentville 디스패처 — 머리(Claude Code)가 손(Codex/Cursor)에게 헤드리스로 작업을 시킨다.
#
# 사용:
#   tools/dispatch.sh codex  "<task 설명>"
#   tools/dispatch.sh cursor "<task 설명>"
#
# 정책(COLLAB.md 동시 작업 충돌 방지):
#   - 손은 자기 lane 파일만 만진다 (codex=Python, cursor=static/**) → 동시 실행해도 파일 충돌 0.
#   - 손은 **커밋하지 않는다** — 편집 + 자체검증까지만. 머리가 git diff 리뷰 후 lane 별로 커밋.
#     (동시 git commit 의 index.lock 경쟁 회피 + 머리 리뷰 루프 유지.)
#   - 출력은 /tmp/agentville-out/dispatch-<tool>-<ts>.log 로 저장(50줄+ 파일 우선 룰).
set -euo pipefail

TOOL="${1:?usage: dispatch.sh <codex|cursor> <task>}"; shift
TASK="${*:?task 설명을 인자로 주세요}"

ROOT="$(git rev-parse --show-toplevel)"
OUT=/tmp/agentville-out; mkdir -p "$OUT"
LOG="$OUT/dispatch-$TOOL-$(date +%Y%m%d-%H%M%S).log"

case "$TOOL" in
  codex)  LANE="Python 파일만 (agent_dashboard/**/*.py · tests/**). static/** 절대 금지."; RULES="AGENTS.md + COLLAB.md";;
  cursor) LANE="frontend 파일만 (agent_dashboard/ui_web/static/**). Python 절대 금지.";   RULES=".cursor/rules/ + COLLAB.md";;
  *) echo "tool 은 codex|cursor 만"; exit 2;;
esac

read -r -d '' PROMPT <<EOF || true
너는 Agentville 프로젝트의 '손(hands)'이다. 머리(Claude Code)가 시킨 아래 작업을 수행한다.

규칙: $RULES 를 먼저 읽고 따른다.
작업 영역(lane): $LANE  — lane 밖 파일은 절대 건드리지 마라.
커밋 금지: 파일 편집 + 자체검증까지만. git commit 하지 마라 (머리가 리뷰 후 커밋한다).
자체검증: 끝나기 전 가능하면 ruff/pytest 또는 serve 눈확인으로 점검.
출력 50줄+ 는 /tmp/agentville-out/ 에 파일로 저장 후 grep.
애매하면 추측하지 말고, 무엇이 불명확한지 한 줄로 보고하고 멈춰라.

[작업]
$TASK
EOF

echo "▶ [$TOOL] dispatch 시작 → 로그: $LOG" >&2
set +e
case "$TOOL" in
  codex)  codex exec -C "$ROOT" -s workspace-write "$PROMPT" </dev/null 2>&1 | tee "$LOG"; rc=${PIPESTATUS[0]};;
  cursor) ( cd "$ROOT" && cursor-agent -p --force --output-format text "$PROMPT" </dev/null ) 2>&1 | tee "$LOG"; rc=${PIPESTATUS[0]};;
esac
set -e

# 쿼터/토큰 소진 감지 → 머리가 분기할 수 있게 마커 출력 (COLLAB.md 토큰 소진 대응)
QUOTA_RE='rate.?limit|quota|usage limit|too many requests|\b429\b|limit reached|insufficient|out of (credit|token)|exhaust|일일 한도|한도를 초과'
if grep -qiE "$QUOTA_RE" "$LOG" 2>/dev/null; then
  RESULT=quota_exhausted
elif [ "${rc:-0}" -ne 0 ]; then
  RESULT=error
else
  RESULT=ok
fi
echo "DISPATCH_RESULT=$RESULT rc=${rc:-0} TOOL=$TOOL LOG=$LOG" >&2
echo "✓ [$TOOL] 완료(result=$RESULT) → $LOG  (머리: git diff 리뷰 후 커밋 / quota 면 폴백)" >&2
