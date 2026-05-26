# AGENTS.md — agent-dashboard (Agentville)

## 🎯 프로젝트 컨셉 (한 줄)

**Agentville** — 모든 Codex 세션의 서브에이전트 활동을 펫-키퍼 메타포로 라이브 표시하는 1인 로컬 모니터.

- 프로젝트 = 집(house) · 세션 = 사람(humanoid sprite) · `subagent_type` = 펫(blob/bird/pup/slime/bunny/star/frog/egg)
- 펫은 호출이 없으면 잠들고, 호출되면 깨어나 walk-cycle 애니메이션
- 단일 머신, 단일 사용자, 인증/DB/원격 없음 — 1인 로컬 한정

**Pixel Agents 풍 "방 안에 캐릭터들이 사는" 그림이 목표** — 카드 대시보드 / 테이블 / RPG·summoner 메타포는 의도적으로 버려진 방향이므로 재도입 금지.

## 🧠 역할: 손 (hands)

이 저장소는 멀티 툴 환경이다(**Claude Code = 머리, Codex/Cursor = 손**). 역할 분담의 1순위 기준은 루트 [`COLLAB.md`](./COLLAB.md). Codex 는 범위가 명확한 구현 작업을 실행하고, 애매하면 추측 말고 사람에게 되묻는다. 커밋 전 `ruff check agent_dashboard` + `pytest -q` 를 직접 돌린다(훅은 Claude Code 에서만 자동 실행).

## 📁 SSOT 문서 (1순위 절대)

| 문서 | 내용 |
|------|------|
| [`DESIGN.md`](./DESIGN.md) | 데이터 소스(transcript JSONL), 추출 이벤트 스키마, 아키텍처 |
| [`ROADMAP.md`](./ROADMAP.md) | P0~P9 진행 현황, 다음 후보 우선순위 |
| [`README.md`](./README.md) | 사용자용 설치/실행 가이드 |
| [`COLLAB.md`](./COLLAB.md) | 멀티 툴(Claude Code/Codex/Cursor) 역할 분담 |
| [`.claude/WORKFLOW.md`](./.claude/WORKFLOW.md) | 에이전트/훅/스킬 카탈로그 |

작업 기록은 **별도 work-log.md 두지 않음 — `git log` 가 SSOT**. 커밋 메시지는 conventional commit 풍으로 정직하게 작성.

## 📐 프로젝트 기본

- Python 3.11+ / FastAPI + SSE / 단일 정적 HTML/CSS/JS / watchdog
- 핵심 경로:
  - 프론트: `agent_dashboard/ui_web/static/{index.html,style.css,app.js}` — 픽셀 SVG 스프라이트는 `app.js` 의 `SPRITES` 객체 (16×16 ASCII 그리드)
  - 백엔드: `agent_dashboard/ui_web/server.py` (FastAPI + SSE)
  - 코어: `agent_dashboard/core/{parser,store,watcher,wt_status}.py`
  - 네이티브: `agent_dashboard/ui_app.py` (pywebview)
  - 빌드: `setup_py2app.py` + `agent_dashboard/build_app.py`
- 테스트: `pytest` (단위만, 외부 시스템 X)
- 로컬 실행: `agent-dashboard serve` 또는 `python -m agent_dashboard serve` → `http://127.0.0.1:7878`

## 🤖 서브에이전트 카탈로그 (`.codex/agents/`)

| 에이전트 | 모델 | 역할 |
|---------|------|------|
| `auto-orchestrator` | opus | `/auto` 의 Decide phase 단발 호출. 진단 보고서 2개 → 이슈 추출·파일 도메인 분류·task-spec 작성·dispatch plan 반환. 디스패칭은 parent 가 수행 |
| `product-strategist` | opus | `/propose` 가 부르는 방향성 제안자. 비전(메모리) vs 현재 vs 외부(WebSearch) 갭 분석 → `proposal-*.md`. 코드 X |
| `pixel-artist` | sonnet | `app.js` `SPRITES` 16×16 ASCII 그리드 작업 (신규 종, walk frame 2, 비율 수정) |
| `scene-tester` | sonnet | Playwright 스크린샷 + 시각 이슈 보고서 (`scratch/scene-report-*.md`) |
| `ui-critic` | sonnet | 디자인 의견 only — 코드 변경 X. Pixel Agents 레퍼런스 기준 비평 |
| `frontend-dev` | sonnet | HTML/CSS/JS 구현. SSE 흐름·CSS keyframe·inline-SVG 스프라이트. **Python 미터치** |

**라우팅 원칙**: 스프라이트 그리드 → `pixel-artist` · CSS/JS 구현 → `frontend-dev` · 디자인 비평 → `ui-critic` · 시각 회귀 검증 → `scene-tester` · 프로젝트 방향성/스코프 갭 → `product-strategist` (`/propose`) · `/auto` 루프의 Decide 단계 → `auto-orchestrator` (단발). **fan-out/dispatching 은 항상 parent Codex 가 수행** — Codex 가 sub-agent 에 Agent tool 을 grant 하지 않기 때문. 일반 코드 작성도 parent 가 직접.

## 🪝 훅 카탈로그 (`.codex/hooks/`)

| Hook | 이벤트 | 역할 |
|------|--------|------|
| `post-edit-screenshot.sh` | PostToolUse (Edit\|Write\|MultiEdit) | `agent_dashboard/ui_web/static/*` 편집 시 서버가 7878에 떠 있으면 백그라운드로 Playwright 스크린샷 → `/tmp/agentville-out/last-edit.png` |
| `pre-commit-check.sh` | PreToolUse (Bash, `git commit`) | `--no-verify` 차단 + `ruff check` + `pytest -q` 짧은 거 |
| `stop-notify.sh` | Stop | macOS `osascript` 알림 (`Glass` 사운드) |
| `pre-compact-save.sh` | PreCompact | git 상태 → `.codex/compact-state.md` 자동 저장 |

## 🗂 Output-to-File-First 룰

**50줄 이상 출력은 파일에 먼저 쓰고 Grep/Read 로 탐색.**

```bash
pytest -q > /tmp/agentville-out/test.txt 2>&1
# 이후: Grep(pattern="FAILED|ERROR", path="/tmp/agentville-out/test.txt")
```

- 임시 출력 디렉토리: `/tmp/agentville-out/` (`mkdir -p` 자동, OS 가 정리)
- 짧은 명령(`git status`, `ls`, `wc -l`) 직접 실행 OK
- **서브에이전트 위임 프롬프트에도 본 룰 인용 의무** — 토큰 누수 방지

## 🔗 서브에이전트 간 정보 공유 규칙 (`.codex/scratch/`)

여러 에이전트가 같은 작업 흐름을 이어받을 때, 결과물을 다음 컨벤션으로 파일에 남긴다. `.gitignore` 처리됨 (휘발성).

| 파일명 | 작성자 | 내용 |
|-------|-------|------|
| `scene-report-{YYYY-MM-DD-HHMMSS}.md` | scene-tester | 스크린샷 경로 + 발견 이슈(severity/위치/제안) |
| `ui-review-{YYYY-MM-DD-HHMMSS}.md` | ui-critic | 디자인 비평 (텍스트만, 코드 X) |
| `task-spec-{slug}.md` | auto-orchestrator | 다음 에이전트에게 위임할 작업 사양 + 수용 기준 |
| `done-{slug}.md` | frontend-dev / pixel-artist | 변경 파일 목록 + 검증 결과 + 후속 리스크 |

**규칙**: 새 보고서 작성 전 같은 타입 최신 파일 1개 read. 7일 이상 된 파일은 자유롭게 삭제. 한 작업 = 한 파일.

## 🔄 자율성 정책 (`/auto`) — parent-driven

`/auto` 는 자율 루프 슬래시 스킬 (`.codex/skills/auto/SKILL.md`). **모든 fan-out 은 parent Codex 가 수행** (sub-agent 가 Agent tool 을 못 받기 때문).

- **`/auto` (인자 없음)** → triage 모드
  1. **Phase 1 — 병렬 진단**: parent 가 `scene-tester` + `ui-critic` 를 단일 메시지에 동시 호출 (둘 다 read-only)
  2. **Phase 2 — Decide**: parent 가 `auto-orchestrator` 단발 호출 (보고서 경로만 전달) → orchestrator 가 task-spec 작성 + dispatch plan 반환 (`parallel_safe` 플래그 포함)
  3. **Phase 3 — Implement**: parent 가 plan 따라 implementer 들을 **disjoint 파일이면 단일 메시지에 병렬, 겹치면 순차** 디스패치
  4. **Phase 4 — Verify**: parent 가 `scene-tester` 1회 호출 (delta mode)
  5. PASS + iter < max_iters → Phase 1 로 루프
- **`/auto <text>`** → directed 모드. text 가 명시적이면 Phase 1 skip, parent 가 바로 task-spec 작성 후 Phase 3 으로.
- **STOP 조건** (하나라도 충족 시 정지):
  1. 합의 무이슈 — scene-tester "no actionable" + ui-critic "no meaningful weaknesses"
  2. fail_streak ≥ 2 (verify 2회 연속 fail)
  3. 사용자 `/auto stop`
  4. iter == max_iters (5)

상태 파일: `/tmp/agentville-out/auto-loop-state-{session_id}.json` (세션별 격리)

## 🛡 안전장치

- `git push --force` / `rm -rf` / DB-style 위험 명령은 부모 Codex 의 기본 가드만 사용 (별도 hook 미설정 — 1인 로컬이라 과한 보호 불필요)
- `git commit --no-verify` 는 `pre-commit-check.sh` 가 차단
- Hooks 실패 시 절대 `--no-verify` 로 우회 X — 근본 원인 수정

## 📝 변경 시 갱신 의무

신규 에이전트/훅/스킬 추가 또는 컨셉 변경 시:
1. 해당 디렉토리에 파일 추가
2. 본 AGENTS.md 카탈로그 표 갱신
3. `.codex/WORKFLOW.md` 도 갱신
4. 메모리(`~/.codex/projects/-Users-sangwonlee-agent-dashboard/memory/`) 의 관련 항목 갱신 — 컨셉이 바뀌었다면 `project_agentville.md` 도 함께
