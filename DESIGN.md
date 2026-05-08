# agent-dashboard — 설계 문서

> 작성일: 2026-05-08
> 상태: **설계 단계 (구현 전)**
> 목적: contrabass-admin-service `scripts/wt-dashboard.py` 를 프로젝트 외부로 이전 + 모든 Claude Code 세션의 서브에이전트 활동을 한 곳에서 라이브 관찰.

---

## 1. 목표 (Goals)

1. **모든 세션 가시성** — 단일 프로젝트가 아닌 `~/.claude/projects/*` 전체에서 진행 중인 서브에이전트 활동을 한 화면에 통합.
2. **라이브 (수동 갱신 X)** — 사용자가 `wt-update.sh` 따로 치지 않아도 transcript 자체를 데이터 소스로 자동 반영.
3. **가벼움** — 1인 로컬 도구. 인증·권한·DB 없음. 단일 머신, 단일 사용자 가정.
4. **프로젝트 분리** — contrabass-admin-service 저장소에서 분리. 어떤 프로젝트에서 Claude 를 띄우든 동작.

### Non-Goals

- 원격 접속 / 팀 공유 / 멀티 머신 sync (1인 로컬 한정)
- transcript 영구 archive·검색 (jsonl 자체가 이미 디스크에 있음, 본 도구는 *현재* 만 보여줌)
- 서브에이전트 결과 분석·요약 (tool_use 호출 사실과 description 만 표시)

---

## 2. 데이터 소스: Claude transcript 라이브 파싱

### 2.1 위치
```
~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
```
- `<encoded-cwd>` = 프로젝트 cwd 의 `/` 를 `-` 로 치환한 슬러그
- 한 세션 = 한 jsonl 파일, 라인별 JSON (append-only)
- 디렉토리 추가/삭제 = inotify (macOS: `fsevents` via `watchdog`) 로 watch

### 2.2 추출 대상 이벤트

서브에이전트 활동 = `message.content[]` 안 `type:"tool_use"` + `name:"Agent"` 이벤트.

```jsonc
// 한 라인 (요약)
{
  "type": "assistant",
  "sessionId": "b3932baa-...",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_xxx",
        "name": "Agent",
        "input": {
          "description": "Branch ship-readiness audit",
          "subagent_type": "code-reviewer",   // 없으면 fork
          "prompt": "..."                      // 길어서 미표시 / 첫 줄만
        }
      }
    ]
  },
  "uuid": "...",
  "timestamp": "2026-05-08T01:30:00Z"
}
```

이어지는 `tool_result` (동일 `tool_use_id`) 가 들어오면 = **완료**. 없으면 = **진행 중**.

### 2.3 라이브 상태 머신

| 상태 | 조건 |
|------|------|
| `running` | `tool_use` 발견 + 매칭 `tool_result` 미존재 |
| `done`    | `tool_result` 매칭 + `is_error` 없음 |
| `failed`  | `tool_result.is_error: true` |
| `stale`   | `running` 인데 마지막 라인 timestamp 가 N분 이상 묵음 (N=10 기본) |

세션 자체가 종료된 경우 (`last-prompt` 이후 잔여 `running` 이 있으면) `orphaned` 로 표기.

### 2.4 스키마 변경 리스크

Claude Code 버전마다 jsonl 스키마가 달라질 수 있음 (`isSidechain`, `parentUuid`, `attachment` 등 신규 필드 관측됨). 따라서:
- **defensive parsing** — 모르는 필드는 무시, 핵심 필드(`message.content[].type`, `name`, `input`)만 의존.
- **버전 감지** — Claude Code 버전 별 회귀 발생 시 즉시 알 수 있게 파싱 실패 카운터 노출.

---

## 3. Form Factor 비교 (정확한 무게)

> 사용자 질문: "가장 무겁다는 게 뭐야?" — 옵션 (3) macOS menubar 가 옵션 설명에서 그렇게 표기되어 있었음. 아래 표가 정확한 비교.

| 항목 | (1) TUI 그대로 | (2) 가벼운 웹 (FastAPI) | (3) macOS menubar |
|------|---------------|------------------------|-------------------|
| 코드량 추정 | ~250줄 | ~400줄 (서버 200 + HTML 200) | ~500줄 (앱 250 + 팝업 UI 250) |
| 신규 의존성 | `rich`, `watchdog` | `fastapi`, `uvicorn`, `watchdog` | `rumps`, `pyobjc-core`, `watchdog`, (`py2app`) |
| 프로세스 형태 | 포그라운드 1개 | 데몬 1개 (`uvicorn`) + 브라우저 탭 | 데몬 1개 (백그라운드) + 트레이 |
| 항시 가시성 | 터미널 띄울 때만 | 브라우저 탭 띄울 때만 | **메뉴바에 상시** |
| 시작 방법 | 터미널에서 `agent-dashboard` | 터미널 `serve` + 브라우저 | LaunchAgent (자동 시작) |
| macOS 통합 | 없음 | 없음 (브라우저) | Cocoa (앱 번들/아이콘/팝업) |
| 디버깅 난이도 | 쉬움 (stdout) | 쉬움 (uvicorn 로그) | **어려움** (백그라운드 데몬, console.app) |
| 패키징 | 불필요 | 불필요 | py2app 또는 `pyinstaller` 권장 |
| **종합** | 가장 가벼움 | 중간 | **가장 무거움** |

### "무겁다" 의 의미

- ✗ 런타임 메모리·CPU 가 무겁다 → **아님**. 셋 다 거의 동일 (~30-50MB)
- ✓ **구현 복잡도** — Cocoa 호출, 메뉴 콜백, 팝업 윈도우, py2app 패키징, LaunchAgent 등록
- ✓ **디버깅 비용** — 백그라운드 데몬 → stdout 안 보임 → 로그 파일·`Console.app` 필요
- ✓ **유지보수** — Claude Code 스키마 변경 시 메뉴바 데몬은 재시작 빈도 ↑

### 권장 정정

"항상 보이는" 효과가 핵심이라면 (3) 가 답이지만, 의외로 (2) 가벼운 웹 + 브라우저 북마크 + macOS Dock 에 PWA 추가가 비슷한 효과를 더 적은 비용으로 줍니다. 본 설계는 **두 옵션 모두 진입 가능하도록** 코어 로직(파서·watcher)을 분리해서 쓰겠습니다.

---

## 4. 권장 아키텍처 (Two-stage)

### Stage 1 — 코어 (의존성·UI 무관)
```
~/agent-dashboard/
├── core/
│   ├── parser.py        # jsonl 라인 → AgentEvent 도메인 객체
│   ├── watcher.py       # ~/.claude/projects/**/*.jsonl tail (watchdog)
│   ├── store.py         # in-memory 상태 머신 (running/done/failed/stale)
│   └── model.py         # AgentEvent, SessionState dataclass
└── tests/
    └── fixtures/        # 실제 jsonl 발췌 샘플
```

### Stage 2 — UI (선택)
```
~/agent-dashboard/
├── ui_tui/              # rich 기반 (현 wt-dashboard 대체)
├── ui_web/              # FastAPI + 정적 HTML (Stage 2 1차 권장)
└── ui_menubar/          # rumps (Stage 2 2차, 옵션)
```

코어는 UI 무관. UI 셋 다 코어를 import 만 하면 됨. **실제 진입은 ui_web 1개만 우선 구현 권장**.

---

## 5. 디렉토리 구조 (제안)

```
~/agent-dashboard/
├── DESIGN.md                    ← 본 문서
├── README.md                    ← 사용법 (구현 후)
├── pyproject.toml               ← uv/pip 설치
├── core/
│   ├── __init__.py
│   ├── model.py
│   ├── parser.py
│   ├── watcher.py
│   └── store.py
├── ui_web/
│   ├── server.py                ← FastAPI app
│   ├── static/
│   │   ├── index.html
│   │   ├── app.js               ← SSE/WebSocket 구독
│   │   └── style.css
│   └── api.py                   ← /api/sessions, /api/events SSE
├── ui_tui/                      ← (옵션) wt-dashboard.py 대체
│   └── tui.py
├── ui_menubar/                  ← (옵션, Stage 3)
│   └── menubar.py
├── bin/
│   └── agent-dashboard          ← 실행 진입점 (사용자 PATH)
└── logs/
    └── agent-dashboard.log      ← 백그라운드 데몬 로그
```

---

## 6. 핵심 도메인 모델

```python
# core/model.py
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

Status = Literal["running", "done", "failed", "stale", "orphaned"]

@dataclass
class AgentEvent:
    project_slug: str          # "-Users-sangwonlee-git-okestro-..."
    project_cwd: str           # 디코딩된 경로
    session_id: str            # jsonl 파일 stem
    tool_use_id: str
    subagent_type: Optional[str]   # None = fork
    description: str
    prompt_first_line: str         # 첫 80자
    started_at: datetime
    finished_at: Optional[datetime]
    status: Status
    is_error: bool
    duration_sec: Optional[float]

@dataclass
class SessionState:
    session_id: str
    project_cwd: str
    last_activity: datetime
    active_agents: list[AgentEvent]
    completed_agents: list[AgentEvent]
```

---

## 7. UI 화면 (웹 기준 mockup)

```
┌─ agent-dashboard ─────────────────────────────────────────────────┐
│ Live · 4 sessions · 2 running · 18 done · 1 failed · refresh: 1s  │
├───────────────────────────────────────────────────────────────────┤
│ contrabass-admin-service                                          │
│   session b3932baa  (active 2분전)                                │
│     ▶ RUN  general-purpose  Branch ship-readiness audit   [01:23] │
│     ✓ DONE code-reviewer    Migration safety review       [00:45] │
│   session c2739232  (idle 38분전)                                 │
│     ✓ DONE rule-aware-qa    Side-effect verification      [02:11] │
│                                                                   │
│ trombone-contrabass-admin-api                                     │
│   session fcd6bebd  (active 3초전)                                │
│     ▶ RUN  surveyor         Heat domain inventory         [00:12] │
└───────────────────────────────────────────────────────────────────┘
```

- 클릭 시 prompt 전문 / tool_result 일부 펼치기 (옵션)
- 빨간색 = failed, 회색 = stale, 시안 = running

---

## 8. 의존성 / 설치

```toml
# pyproject.toml (요지)
[project]
name = "agent-dashboard"
requires-python = ">=3.11"
dependencies = [
  "watchdog>=4.0",     # fsevents wrapper
]

[project.optional-dependencies]
web     = ["fastapi", "uvicorn[standard]", "sse-starlette"]
tui     = ["rich"]
menubar = ["rumps", "pyobjc-core"]

[project.scripts]
agent-dashboard = "ui_web.server:main"   # 기본은 web
```

```bash
# 설치
cd ~/agent-dashboard
uv pip install -e ".[web]"     # 또는 .[web,tui]

# 실행
agent-dashboard                # http://localhost:7878
```

---

## 9. 백그라운드 데몬화 (옵션)

LaunchAgent plist (`~/Library/LaunchAgents/com.user.agent-dashboard.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>com.user.agent-dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/sangwonlee/.local/bin/agent-dashboard</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/sangwonlee/agent-dashboard/logs/out.log</string>
  <key>StandardErrorPath</key><string>/Users/sangwonlee/agent-dashboard/logs/err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.user.agent-dashboard.plist
```

부팅 시 자동 기동 + 종료 시 자동 재시작. 사용자가 원치 않으면 생략.

---

## 10. 구현 단계 (Phased)

| Phase | 산출물 | 의존 | 검증 기준 |
|-------|--------|------|----------|
| **P0** | `core/` (parser+watcher+store) | watchdog | tests/ 의 fixture jsonl 5개로 단위 테스트 통과 |
| **P1** | `ui_web/` 최소 (SSE + 단일 HTML) | P0 + fastapi | localhost:7878 에서 현재 세션 활동 라이브 표시 |
| **P2** | `bin/agent-dashboard` + pyproject + README | P1 | `pip install -e .` 로 설치, PATH 명령어 동작 |
| **P3** | LaunchAgent plist + 자동 시작 가이드 | P2 | 재부팅 후 자동 기동 확인 |
| **P4 (opt)** | `ui_tui/` 마이그레이션 + contrabass `scripts/wt-dashboard.py` deprecation 주석 | P0 | 기존 `/tmp/wt-status` 보드와 병행 가능 |
| **P5 (opt)** | `ui_menubar/` rumps | P0 + rumps | 메뉴바 아이콘 + 팝업 |

**1 turn 안에 가능한 범위**: P0 + P1 + P2 (코어 + 웹 + 진입점). P3 이후는 사용자 환경 의존이라 분리.

---

## 11. 마이그레이션 — 기존 `scripts/wt-dashboard.py` 처리

`/tmp/wt-status/*.json` 워크트리 협업 보드는 transcript 파싱과 **데이터 소스가 다름** (수동 갱신 vs 자동). 따라서:

- **Option A (권장)** — 두 가지 모두 표시. transcript = 상단 패널, wt-status = 하단 패널. `scripts/wt-dashboard.py` 는 그대로 유지하되 README 에 "agent-dashboard 가 상위 호환" 표기.
- **Option B** — `scripts/wt-dashboard.py` 즉시 deprecated 주석 + agent-dashboard 로 redirect. 단, 기존 `wt-update.sh` 흐름이 끊김.
- **Option C** — agent-dashboard 가 `/tmp/wt-status/*.json` 도 같이 watch 하도록 두 번째 어댑터 추가. P4 에서 처리.

**제안: Option C**. 코어 watcher 가 두 source 를 어댑터 패턴으로 통합.

---

## 12. 리스크 / 미해결 결정

| # | 항목 | 옵션 | 결정 필요 시점 |
|---|------|------|---------------|
| R1 | jsonl 스키마 변동 회귀 | defensive parser + 버전 감지 카운터 | P0 구현 시 |
| R2 | sidechain 메시지 처리 (`isSidechain: true`) | 별도 nested 트리로 표시 vs 합산 | P1 |
| R3 | 진짜 "실시간" 빈도 (1Hz vs SSE push) | SSE push (변경 시에만) 권장 | P1 |
| R4 | tool_result 매칭 누락 시 stale 임계 | 기본 10분, env override | P0 |
| R5 | menubar 진짜 필요한가? | Phase P5 옵션, 우선 보류 | P2 종료 후 사용자 재판단 |
| R6 | wt-status JSON 통합 시점 | P4 vs P1 | P1 종료 시 |
| R7 | 인증 (localhost-only bind 충분?) | 127.0.0.1 only + 토큰 옵션 | P1 |

---

## 13. 사용자 검토 포인트

본 문서 검토 시 아래만 확인 부탁드립니다:

1. **Form factor 최종** — DESIGN §3 비교표 본 후 (1) 웹 / (2) menubar / (3) 둘 다 코어 공유 후 P5 에서 menubar 추가 — 어디로?
2. **마이그레이션** — DESIGN §11 Option A/B/C 중 어느 것?
3. **자동 시작** — DESIGN §9 LaunchAgent 등록까지 진행할지, 수동 실행만으로 충분한지?
4. **Phase 진입 범위** — 1 turn 에 P0+P1+P2 묶음으로 갈지, P0 만 먼저 검증할지?

위 4건 결정 주시면 다음 turn 에 구현 진입하겠습니다.

---

## 부록 A. transcript 샘플 통계 (2026-05-08 측정)

대상: `c2739232-17e6-46c9-bc7f-46369a22c250.jsonl` (4.4MB, 본 프로젝트)

```
sidechain msgs: 0
Agent tool calls: 28
Top tools:
  Bash: 204
  mcp__playwright__browser_*: ~400 (합계)
  Agent: 28
  Read: 16
```

→ Agent 호출 28건 = 본 대시보드에서 라이브 카드로 표시될 **세션당 typical 부하**. 14개 세션 디렉토리 × 평균 5 세션/디렉토리 × 28 = ~2000 카드 상한. 메모리·렌더링 무리 없음.

## 부록 B. 보안

- bind 는 `127.0.0.1` 만. 외부 노출 X.
- transcript 에 비밀이 들어있을 수 있음 (`.env`, API key 페이스트 등). 본 도구는 prompt **첫 줄 80자만** 표시. 전문은 클릭 시에만 확장 + 경고 표시.
- 로컬 단일 사용자 가정. 다중 사용자 / 공유 머신 환경은 Non-Goal.
