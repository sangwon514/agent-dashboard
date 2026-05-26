# Agentville — Claude Code 워크플로우

전체 그림 1장. 개별 파일 읽기 전에 본 문서.

## 진입점

| 커맨드 | 용도 | 빈도 |
|-------|------|------|
| `/auto` | 자율 개선 루프 (시각 이슈 진단 → 디스패치 → 검증) | 최고 |
| `/auto <text>` | 자연어 task 받아 자동 진행 | 높음 |
| `/auto status` | 현재 루프 상태 + 최근 로그 | 중 |
| `/auto stop` | 루프 강제 종료 | 저 |
| `/propose` | product-strategist 호출 — 비전 vs 현재 갭 분석 + 방향성 제안 | 중 |
| `/propose <focus>` | focus 영역 한정 제안 | 중 |

기타 일반 슬래시 커맨드(`/init`, `/review`, `/security-review` 등)는 글로벌이며 본 프로젝트 룰과 무관.

## /auto 파이프라인 (parent-driven, true parallel)

```
1. /auto <args>
   ↓
2. SKILL.md → 세션 ID 해석 + STATE_FILE 생성
   ↓
3. parent Claude 가 직접 fan-out (sub-agent 에 Agent tool 없음):

   Phase 1 — 병렬 진단 ⚡
     단일 메시지에 두 call:
       ├─ scene-tester  → scratch/scene-report-{ts}.md
       └─ ui-critic     → scratch/ui-review-{ts}.md

   Phase 2 — Decide (단발)
     auto-orchestrator (보고서 경로만 전달)
       → scratch/task-spec-{slug}.md × N
       → dispatch plan {tasks, parallel_safe}

   Phase 3 — Implement
     parallel_safe ? 단일 메시지에 N call : 순차 dispatch
       ├─ pixel-artist (app.js#SPRITES)
       └─ frontend-dev (style.css | index.html | app.js#logic)
       → scratch/done-{slug}.md × N

   Phase 4 — Verify
     scene-tester (delta) → PASS / FAIL
   ↓
4. PASS + iter < max → Phase 1 로 루프
   STOP 조건 충족 → STATE_FILE.active=false → 3줄 보고
```

상태 파일: `/tmp/agentville-out/auto-loop-state-{session_id}.json`
로그: `/tmp/agentville-out/auto-loop-{session_id}.log`

## 에이전트 카탈로그

| 에이전트 | 모델 | 호출 경로 | 역할 |
|---------|------|----------|------|
| `auto-orchestrator` | opus | parent (Phase 2 단발) | 보고서 2개 → 이슈 분류·task-spec 작성·dispatch plan 반환 (디스패칭 X) |
| `product-strategist` | opus | `/propose` | 비전 vs 현재 갭 분석 + 방향성 제안 (코드 X) |
| `pixel-artist` | sonnet | parent (Phase 3) | 16×16 ASCII 스프라이트 그리드 |
| `scene-tester` | sonnet | parent (Phase 1, 4) | Playwright 스크린샷 + 시각 이슈 보고 |
| `ui-critic` | sonnet | parent (Phase 1) | 디자인 비평 (코드 X) |
| `frontend-dev` | sonnet | parent (Phase 3) | HTML/CSS/JS 구현 |

도메인 분류 규칙은 [`agents/auto-orchestrator.md`](./agents/auto-orchestrator.md) 참조. **fan-out 은 parent 만 한다** — sub-agent 는 Agent tool 을 받지 않는다.

## Hook 카탈로그

| Hook | 이벤트 | 역할 |
|------|--------|------|
| `post-edit-screenshot.sh` | PostToolUse Edit\|Write\|MultiEdit | static/* 편집 시 백그라운드 스크린샷 |
| `pre-commit-check.sh` | PreToolUse Bash | git commit 전 ruff + pytest, `--no-verify` 차단 |
| `stop-notify.sh` | Stop | macOS 알림 |
| `pre-compact-save.sh` | PreCompact | git 상태 → `.claude/compact-state.md` |

## 출력 규칙

- **50줄+** = `/tmp/agentville-out/` 에 저장 후 Grep/Read
- **에이전트 간 공유** = `.claude/scratch/` (gitignore, 휘발성)
- **명명**: `{type}-{slug-or-ts}.md` — type ∈ {scene-report, ui-review, task-spec, done, proposal}
- 위임 프롬프트마다 위 두 룰 인용 의무

## 디렉토리 빠른 참조

```
.claude/
├── agents/             # 6 .md (위 카탈로그)
├── skills/
│   ├── auto/           # /auto SKILL.md
│   └── propose/        # /propose SKILL.md
├── hooks/              # 4 .sh
├── settings.json       # hooks 등록 + permissions
├── scratch/            # 에이전트 간 공유 파일 (gitignore)
├── WORKFLOW.md         # 본 문서
└── compact-state.md    # PreCompact 자동 (gitignore)
```

## 변경 시 갱신할 곳

새 에이전트/훅/스킬 추가 시:
1. 해당 디렉토리에 파일
2. 본 문서 카탈로그 표
3. `CLAUDE.md` 카탈로그
4. (필요 시) 메모리 갱신 — `~/.claude/projects/-Users-sangwonlee-agent-dashboard/memory/`
