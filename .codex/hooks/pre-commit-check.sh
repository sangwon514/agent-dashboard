#!/bin/bash
# PreToolUse hook: git commit 전 정합성 체크 + --no-verify 차단
# stdin: {"tool_name":"Bash","tool_input":{"command":"..."}}
# exit 0 = 허용, exit 2 = 차단 (stderr JSON)

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0
echo "$COMMAND" | grep -qE 'git commit' || exit 0

# --no-verify 차단 (heredoc 본문 제외)
CMD_BEFORE_HEREDOC=$(echo "$COMMAND" | sed '/<<.*EOF/,$d')
if echo "$CMD_BEFORE_HEREDOC" | grep -qE '\-\-no-verify'; then
  echo '{"decision":"block","reason":"--no-verify is not allowed. Fix the underlying issue."}' >&2
  exit 2
fi

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p /tmp/agentville-out

# ruff (있으면)
if command -v ruff &>/dev/null; then
  RUFF_OUT="/tmp/agentville-out/ruff.txt"
  if ! ruff check "$PROJECT_DIR" --quiet > "$RUFF_OUT" 2>&1; then
    HEAD=$(head -20 "$RUFF_OUT")
    echo "{\"decision\":\"block\",\"reason\":\"ruff check failed:\\n${HEAD//\"/\\\"}\\n(전체: $RUFF_OUT)\"}" >&2
    exit 2
  fi
fi

# pytest 짧게 (있으면)
if command -v pytest &>/dev/null && [[ -d "$PROJECT_DIR/tests" ]]; then
  TEST_OUT="/tmp/agentville-out/test.txt"
  if ! (cd "$PROJECT_DIR" && timeout 60 pytest -q --no-header --tb=line) > "$TEST_OUT" 2>&1; then
    HEAD=$(grep -E "FAILED|ERROR|^E " "$TEST_OUT" | head -10)
    echo "{\"decision\":\"block\",\"reason\":\"pytest failed:\\n${HEAD//\"/\\\"}\\n(전체: $TEST_OUT)\"}" >&2
    exit 2
  fi
fi

exit 0
