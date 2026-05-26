#!/bin/bash
# Stop hook: Claude 응답 완료 시 macOS 알림

set -euo pipefail

# input 은 받지만 사용 안 함 (소음 방지)
cat > /dev/null

command -v osascript &>/dev/null || exit 0

osascript -e 'display notification "작업 완료" with title "Agentville" sound name "Glass"' 2>/dev/null || true

exit 0
