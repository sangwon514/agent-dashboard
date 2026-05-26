---
name: auto
description: |
  Agentville 자율 개선 루프 (parent-driven, true parallel).
  사용:
    /auto              — 시각 이슈 자동 진단 → 디스패치 → 검증 (개선거리 없으면 STOP)
    /auto <text>       — text 를 작업으로 받아 자동 진행
    /auto stop         — 현재 세션 루프 강제 종료
    /auto status       — 현재 루프 상태 + 최근 로그
---

# /auto — Agentville 자율 개선 루프

인자: `$ARGUMENTS`

## ⚠️ Architecture: parent-driven

이 스킬의 모든 sub-agent dispatching 은 **parent Claude (이 SKILL.md 를 읽는 컨텍스트) 가 직접 수행**한다.
Claude Code 는 sub-agent 에게 Agent tool 을 grant 하지 않으므로, sub-agent 가 다른 sub-agent 를 부를 수 없다.
따라서 fan-out 은 항상 parent 책임. 이 구조 덕에 **scene-tester + ui-critic 진단 병렬**, **disjoint 파일 도메인의 implementer 병렬** 이 진짜로 동작한다.

## Session scope

```bash
mkdir -p /tmp/agentville-out
PROJECT_ENCODED=$(echo "$PWD" | sed 's|[/.]|-|g')
PROJECT_DIR="$HOME/.claude/projects/${PROJECT_ENCODED}"
SESSION_ID=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1 | xargs -I{} basename {} .jsonl)
SESSION_ID="${SESSION_ID:-default}"
STATE_FILE="/tmp/agentville-out/auto-loop-state-${SESSION_ID}.json"
LOG_FILE="/tmp/agentville-out/auto-loop-${SESSION_ID}.log"
```

## Mode branch (first token)

- `stop` → STATE_FILE 비활성화, 종료 메시지.
- `status` → STATE_FILE 내용 + LOG_FILE 마지막 10줄.
- 그 외 → 자율 루프 시작 (인자 비었으면 triage 모드, 있으면 directed 모드).

### `/auto stop`

```bash
if [ -f "$STATE_FILE" ]; then
  jq '.active=false | .stage="stopped"' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  echo "🛑 auto-loop 정지 — session=${SESSION_ID:0:8}"
else
  echo "활성 루프 없음 — session=${SESSION_ID:0:8}"
fi
```

### `/auto status`

```bash
echo "=== session=${SESSION_ID:0:8} ==="
[ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo "(state 없음 — 루프 미시작)"
echo "--- log (last 10) ---"
tail -10 "$LOG_FILE" 2>/dev/null || echo "(로그 없음)"
```

## Loop (parent executes)

### 0) 재진입 가드 + 상태 초기화

```bash
if [ -f "$STATE_FILE" ] && [ "$(jq -r '.active // false' "$STATE_FILE")" = "true" ]; then
  STAGE=$(jq -r '.stage' "$STATE_FILE")
  echo "⚠️ 이미 활성 루프 — session=${SESSION_ID:0:8}, stage=$STAGE"
  echo "강제 재시작: /auto stop 후 다시 호출"
  exit 0
fi
MODE=$([ -z "$ARGUMENTS" ] && echo "triage" || echo "directed")
cat > "$STATE_FILE" <<EOF
{"active": true, "mode": "$MODE", "stage": "triage", "fail_streak": 0, "iter": 0, "max_iters": 5, "task": "$ARGUMENTS"}
EOF
echo "🔁 auto-loop 시작 — session=${SESSION_ID:0:8}, mode=$MODE"
```

각 phase 전환 시 parent 가 `STATE_FILE` 의 `stage` / `iter` 를 갱신.

### Phase 1 — Triage (병렬 진단) ⚡ true parallel

Parent 가 **단일 메시지에 두 개의 Agent tool call** 을 발사:

- `scene-tester` → `scratch/scene-report-{ts}.md` + `/tmp/agentville-out/triage-*.png`
- `ui-critic` → `scratch/ui-review-{ts}.md`

둘 다 read-only, 파일 충돌 없음. 두 보고서 동시 도착.

**Directed 모드** (`/auto <text>`) 에서 text 가 명시적이면 (예: "horizon 고쳐줘") triage 를 skip 하고 바로 Phase 3 으로 — text 자체가 task-spec 의 시드.

### Phase 2 — Decide (auto-orchestrator 호출 — 단발)

Parent 가 `auto-orchestrator` 를 호출, **report 경로만 전달** (parent 컨텍스트에 보고서 전문 안 싣기 위함).

Orchestrator 가 하는 일:
1. 두 보고서 read
2. 합의 무이슈면 `{stop: true, reason: "consensus-no-issues"}` 반환 → parent 즉시 STOP
3. 아니면 상위 1–3 이슈를 골라 **타겟 파일 도메인 분류**:
   - sprites → `app.js` SPRITES → `pixel-artist`
   - style → `style.css` → `frontend-dev`
   - markup → `index.html` → `frontend-dev`
   - logic → `app.js` (SPRITES 외) → `frontend-dev`
4. 각 이슈마다 `scratch/task-spec-{slug}.md` 작성
5. Parent 에게 dispatch plan 반환 (구조화):
   ```json
   {
     "stop": false,
     "tasks": [
       {"slug": "room-horizon-fix", "agent": "frontend-dev", "files": ["style.css"], "spec_path": "..."},
       {"slug": "new-turtle-sprite", "agent": "pixel-artist", "files": ["app.js#SPRITES"], "spec_path": "..."}
     ],
     "parallel_safe": true
   }
   ```

`parallel_safe = true` ⇔ 모든 task 의 `files` 집합이 pairwise disjoint.

### Phase 3 — Implement (병렬 OR 순차)

Parent 가 dispatch plan 을 받아:

- `parallel_safe = true` → **단일 메시지에 N개 Agent tool call** 동시 발사
- `parallel_safe = false` → 한 번에 하나씩 순차 발사

각 implementer (`pixel-artist` / `frontend-dev`) 는 종료 시 `scratch/done-{slug}.md` 작성.

병렬 예시:
- ✅ pixel-artist (`app.js#SPRITES`) + frontend-dev (`style.css`) → 단일 메시지에 두 call
- ✅ frontend-dev (`style.css`) + frontend-dev (`index.html`) → 단일 메시지에 두 call
- ❌ frontend-dev (`app.js` 로직) + pixel-artist (`app.js#SPRITES`) → 순차 (같은 파일)

### Phase 4 — Verify

Parent 가 `scene-tester` 1회 호출 (delta mode — 직전 scene-report 와 diff). PASS/FAIL 판정.

### Phase 5 — Loop or stop

- 전체 PASS + triage 모드 + iter < max_iters → Phase 1 로 루프
- 전체 PASS + directed 모드 → STOP (1회 후 종료)
- FAIL → `fail_streak++`. fail_streak ≥ 2 → STOP + 사용자 개입 요청
- iter == max_iters → STOP + escalate

## Required prompt fragments (모든 dispatch 에 포함 의무)

매 Agent tool call 의 prompt 에 반드시:

1. **Output-to-File-First**: "50줄+ 출력은 `/tmp/agentville-out/<name>.txt` 로 먼저 쓰고 Grep/Read." (CLAUDE.md 인용)
2. **Scratch 명명 규칙**: `scene-report-{YYYY-MM-DD-HHMMSS}.md`, `ui-review-{YYYY-MM-DD-HHMMSS}.md`, `task-spec-{slug}.md`, `done-{slug}.md`. 같은 type 최신 파일 1개 read 후 작성.
3. **STOP 조건 echo**: 합의 무이슈 / fail_streak ≥ 2 / `/auto stop` / max_iters.
4. **Surgical**: 요청 범위 외 파일 절대 미터치.

## STOP 조건

1. **합의 무이슈** — scene-tester "no actionable" + ui-critic "no meaningful weaknesses"
2. **연속 실패** — fail_streak ≥ 2
3. **사용자 개입** — `/auto stop`
4. **반복 한도** — iter == max_iters (5)

## 종료 시 stdout 3줄

1. 입력 task (`$ARGUMENTS` 또는 "open-ended improvement")
2. 변경 파일 목록 (없으면 "변경 없음")
3. 남은 리스크 / 다음 후보 (1줄)

종료 시 `STATE_FILE` 의 `active=false`, `stage` ∈ {done, stopped, escalated} 으로 set.

## 안전장치

- 위험 명령은 부모 Claude 의 기본 가드 + `pre-commit-check.sh` 훅에 위임.
- ESC 또는 `/auto stop` 으로 사용자 중단 가능.
- 진단 단계 비용: scene-tester (Playwright 시동 ~3s) × 2/iter (triage + verify) — 한 iter 당 ≤2회 강제.

## 사용 예

```
/auto
/auto 펫이 떠 보이는 거 고쳐줘
/auto pixel-artist 한테 새 거북이 스프라이트 만들라고 시켜줘
/auto status
/auto stop
```
