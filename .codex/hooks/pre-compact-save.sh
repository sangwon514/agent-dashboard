#!/bin/bash
# PreCompact hook: 컴팩션 전 진행 상태 자동 저장 (CLAUDE.md SSOT 패턴)

set -euo pipefail

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STATE_FILE="$PROJECT_DIR/.claude/compact-state.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

BRANCH=$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || echo "unknown")
UNCOMMITTED=$(git -C "$PROJECT_DIR" diff --stat 2>/dev/null | tail -1)
UNTRACKED=$(git -C "$PROJECT_DIR" status --short 2>/dev/null | grep -c '^??' || true)
RECENT_COMMITS=$(git -C "$PROJECT_DIR" log --oneline -5 2>/dev/null || echo "none")
MODIFIED_FILES=$(git -C "$PROJECT_DIR" diff --name-only 2>/dev/null || echo "none")
STAGED_FILES=$(git -C "$PROJECT_DIR" diff --cached --name-only 2>/dev/null || echo "none")

cat > "$STATE_FILE" <<EOF
# Compact State — Auto-saved at $TIMESTAMP

## Branch
$BRANCH

## Recent Commits
$RECENT_COMMITS

## Uncommitted Changes
$UNCOMMITTED

## Modified Files (unstaged)
$MODIFIED_FILES

## Staged Files
$STAGED_FILES

## Untracked Files Count
$UNTRACKED

---
*PreCompact hook 자동 생성. 컴팩션 후 세션 재개 시 참고.*
EOF

exit 0
