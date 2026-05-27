---
name: auto
description: |
  Agentville 자율 개선 루프 (parent-driven, true parallel).
  Default: Codex(Python lane) + Cursor(static lane) 병렬 디스패치 (tools/dispatch.sh). 손 블로커시 머리가 takeover (COLLAB.md Case A/B).
  사용:
    /auto              — 시각 이슈 자동 진단 → Codex+Cursor 병렬 디스패치 → 검증 (개선거리 없으면 STOP)
    /auto <text>       — text 를 작업으로 받아 자동 진행 (lane 별로 분해 후 병렬)
    /auto wild         — 창의 발산 단발: imagineer 가 "없어서 아쉬운 즐거움" 1건 제안 → 구현 → 검증 → STOP (루프 X)
    /auto stop         — 현재 세션 루프 강제 종료
    /auto status       — 현재 루프 상태 + 최근 로그
---

# /auto — Agentville 자율 개선 루프

인자: `$ARGUMENTS`

## ⚠️ Architecture: parent-driven

이 스킬의 모든 sub-agent dispatching 은 **parent Claude (이 SKILL.md 를 읽는 컨텍스트) 가 직접 수행**한다.
Claude Code 는 sub-agent 에게 Agent tool 을 grant 하지 않으므로, sub-agent 가 다른 sub-agent 를 부를 수 없다.
따라서 fan-out 은 항상 parent 책임. 이 구조 덕에 **scene-tester + ui-critic 진단 병렬**, **Codex + Cursor implementer 병렬** 이 진짜로 동작한다.

## 🤝 Default hands: Codex + Cursor (병렬)

Phase 3(Implement)의 **기본 디스패치는 Codex(Python lane) + Cursor(static lane) 병렬** ([`COLLAB.md`](../../../COLLAB.md) lane 분리 SSOT). 두 lane 은 항상 disjoint 하므로 매 iter 마다 **단일 메시지에 background `tools/dispatch.sh codex …` + `tools/dispatch.sh cursor …` 2개 발사**가 정상 동작.

- 한쪽만 이슈 후보가 있을 때 → 그쪽만 디스패치 + 빈 lane 은 skip.
- 양 lane 다 후보 있는데 한쪽이 **블로커 / 쿼터 소진**이면 → COLLAB.md "Case A": 살아있는 손 디스패치 + 막힌 lane 은 **머리가 직접 구현**(같은 메시지에 병렬). 크로스 배정 절대 금지.
- 양쪽 모두 블로커 → "Case B": 머리가 두 lane 을 순차 구현(병렬도 OK, 같은 머리 1개라 동시 X), 또는 reset 까지 보류.
- 백엔드↔프론트 의존 작업(예: API 필드+표시)은 **순차** — Codex 먼저 끝나면 결과를 Cursor 의 spec 에 포함시켜 디스패치.

`pixel-artist` / `frontend-dev` 는 **lane 이 모자랄 때의 보조 hand** — 신규 스프라이트(앗 그리드 작업)나 Cursor 블로커시 머리의 위임 채널로 사용. 기본 routing 아님.

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
- `wild` → **창의 발산 단발 모드** (아래 "Wild mode" 섹션). 수렴 루프와 분리된 single-shot.
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

## Wild mode (`/auto wild`) — 창의 발산 단발

**수렴 루프(아래 Loop)와 완전히 분리된 single-shot.** imagineer 가 "없어서 아쉬운 즐거움" 1건을 제안 → 구현 → 검증 → STOP. **절대 루프하지 않는다** (imagineer 는 아이디어가 무한해 "무이슈"라 말하지 않으므로, 1건 cap 으로 수렴 보장 유지).

```bash
# 상태: 별도 wild stage 로 기록 (재진입 가드는 동일)
jq -n '{"active": true, "mode": "wild", "stage": "imagine", "fail_streak": 0, "iter": 1, "max_iters": 1, "task": "wild"}' > "$STATE_FILE"
echo "✨ /auto wild — 창의 발산 단발 시작 (single-shot, 루프 X)"
```

### W1 — Imagine (imagineer 단발)

Parent 가 `imagineer` 1회 호출 (read-only). 산출: `scratch/imagine-{ts}.md` + stdout `Top: <한 줄> (lane=…)`.

- imagineer 는 현재 월드 인벤토리(SPRITES·데코·애니메이션) + 최신 스크린샷 + 외부 미감 레퍼런스를 보고 **빌드 가능한 1건**으로 좁힌다.
- prompt 에 필수 fragment(아래 "Required prompt fragments") 인용 + **북극성 앵커**("Pixel Agents 방 안 캐릭터", dashboard/RPG 금지) 명시.

### W2 — Spec (parent)

Parent 가 imagineer 의 Top pick 을 읽고 `scratch/task-spec-{slug}.md` 작성 + lane 분류:
- `static` → **Cursor** (`tools/dispatch.sh cursor`) — CSS/JS 앰비언트·미세 인터랙션
- `sprite` → **pixel-artist** — 신규 16×16 ASCII 종/오브젝트 (필요시 cursor 가 배선)
- `python` → **Codex** (드묾 — 보통 wild 은 static/sprite)

sprite+static 동시 필요하면(예: 새 스프라이트 + 렌더 배선) **pixel-artist 먼저 → 결과를 cursor spec 에 포함** (순차).

### W3 — Implement

W2 의 lane 으로 디스패치 (Codex/Cursor 는 `tools/dispatch.sh` background, pixel-artist 는 Agent tool). `DISPATCH_RESULT=ok` → `git diff` 리뷰 → 머리가 커밋. 블로커면 COLLAB.md Case A (머리 takeover).

### W4 — Verify

Parent 가 `scene-tester` 1회 호출 — **(a) 렌더되나 (b) 회귀 없나 (c) 북극성 미감 유지(대시보드화 안 됐나)**. PASS/FAIL.

### W5 — STOP (무조건 단발)

- PASS → `STATE_FILE` `active=false, stage="done", stop_reason="wild-shipped"`. 3줄 보고.
- FAIL → 1회 보정 시도 후 그래도 FAIL 이면 변경 revert 검토 + `stage="escalated"`. **재발산(W1) 으로 돌아가지 않는다.**

→ 더 만들고 싶으면 사용자가 `/auto wild` 를 다시 부른다. 자동 연쇄 금지.

## Loop (parent executes) — 수렴 모드 (`/auto`, `/auto <text>`)

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
3. 아니면 상위 1–3 이슈를 골라 **타겟 파일 도메인 분류** ([`COLLAB.md`](../../../COLLAB.md) lane SSOT):
   - Python (`agent_dashboard/**/*.py`, `tests/**`) → **Codex** (`tools/dispatch.sh codex`)
   - static (`agent_dashboard/ui_web/static/**` — `app.js`, `style.css`, `index.html`) → **Cursor** (`tools/dispatch.sh cursor`)
   - 신규 SPRITES 그리드(16×16 ASCII) → `pixel-artist` (보조)
   - Cursor 블로커시 static lane → 머리(`frontend-dev` 또는 직접) (Case A 폴백)
4. 각 이슈마다 `scratch/task-spec-{slug}.md` 작성
5. Parent 에게 dispatch plan 반환 (구조화):
   ```json
   {
     "stop": false,
     "tasks": [
       {"slug": "c3-incremental-read", "hand": "codex",  "files": ["core/watcher.py", "core/store.py", "tests/"], "spec_path": "..."},
       {"slug": "dark-mode-world",     "hand": "cursor", "files": ["static/style.css"],                          "spec_path": "..."}
     ],
     "parallel_safe": true
   }
   ```

`parallel_safe = true` ⇔ 모든 task 의 `files` 집합이 pairwise disjoint (lane 분리상 codex↔cursor 는 항상 disjoint, 같은 lane 내 다중은 disjoint 검사 필요).

### Phase 3 — Implement (Codex + Cursor 병렬 default)

**Default**: dispatch plan 의 `hand` 별로 **단일 메시지에 `tools/dispatch.sh` background 호출** 동시 발사 (Codex Python lane + Cursor static lane).

- `parallel_safe = true` → 모든 task 를 단일 메시지에 동시 background 디스패치 → 완료 알림은 비동기 도착
- `parallel_safe = false` → 의존 순서대로 sequential
- 각 dispatch 의 stdout 마지막 줄 `DISPATCH_RESULT=` 마커로 결과 판정:
  - `ok` → done 리포트 확인 + `git diff` 리뷰 → 머리가 lane 별로 commit
  - `quota_exhausted` / `error rc=1` → COLLAB.md 폴백 정책 적용 (한쪽 살아있으면 Case A, 둘 다 막히면 Case B)
- 손이 인증/쿼터 블로커면 머리가 즉시 같은 spec 으로 takeover (서로 다른 lane 이라 충돌 없음). `done-{slug}.md` 는 누가 쓰든 동일 컨벤션.

병렬 예시 (실전):
- ✅ codex (`core/watcher.py`) + cursor (`static/style.css`) → 단일 메시지에 background 2개
- ✅ codex (`core/cursor_usage.py`) + 머리 직접 (`static/style.css`, Cursor 블로커시) → 단일 메시지에 dispatch + Edit 병렬
- ❌ codex (`server.py` static-serve 부분) + cursor (`static/index.html`) → 경계 파일 의존, sequential

`pixel-artist` / `frontend-dev` 는 신규 SPRITES 또는 위임 폴백시 보조 — 일반 케이스는 Codex+Cursor 2-fan-out 이 기본.

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
/auto wild       # imagineer 가 "없어서 아쉬운 즐거움" 1건 제안 → 구현 → 검증 (단발)
/auto pixel-artist 한테 새 거북이 스프라이트 만들라고 시켜줘
/auto status
/auto stop
```
