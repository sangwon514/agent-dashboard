# agent-dashboard — ROADMAP

> 작성: 2026-05-08 · 상태: P0~P5 + 1차 고도화 완료, P6+ 미착수
> 전제: 1인 로컬 도구. Non-Goal 은 [DESIGN.md §1](./DESIGN.md) 그대로.

## 현재 상태 (2026-05-08)

- ✅ **P0** core (parser/watcher/wt_status/store/model) — 단위 테스트 9건 PASS
- ✅ **P1** ui_web (FastAPI + SSE + 단일 HTML) — 실측 810 sessions / 669 agent calls 추출
- ✅ **P2** CLI (`agent-dashboard {serve,tui,menubar,install,uninstall,status,help}`)
- ✅ **P3** LaunchAgent installer (`launchctl bootstrap` + 폴백)
- ✅ **P4** ui_tui (rich Live)
- ✅ **P5** ui_menubar (rumps + osascript notification)
- ✅ **고도화 1차**:
  - 웹 UI 검색 + status 필터 + localStorage 보존
  - 클릭 시 expanded 패널 (prompt 첫 줄·duration·tool_use_id)
  - menubar 새 failure 감지 시 macOS notification
  - 자동 재연결 (SSE)
  - contrabass `scripts/wt-dashboard.py` deprecation 주석

## P6 — 정확도·신뢰성 (다음 후보)

| # | 항목 | 가치 | 추정 |
|---|------|------|------|
| P6-1 | sidechain 메시지 트리 표시 (`isSidechain: true` parent 추적) | 서브에이전트 *내부* 활동 가시화 | 중 |
| P6-2 | Claude Code 버전 감지 + 파싱 실패 카운터 노출 | 스키마 회귀 조기 감지 | 소 |
| P6-3 | 증분 read (last_offset 추적) — 4MB 파일 매번 전체 재파싱 회피 | 100+ 세션에서 CPU 절감 | 중 |
| P6-4 | session 종료 감지 (`last-prompt` 이후 N분 idle → orphaned 표시) | 진짜 중단된 호출 식별 | 소 |
| P6-5 | tool_result content 일부 expanded 에 표시 (성공·실패 사유) | 디버깅 가치 ↑ | 중 |
| P6-6 | parser 단위 테스트 fixture 확장 (sidechain·이상치) | 회귀 방어 | 소 |

## P7 — 사용성

| # | 항목 | 가치 | 추정 |
|---|------|------|------|
| P7-1 | 통계 패널: subagent_type 별 호출 수 / 평균 duration / 최근 24h | 패턴 파악 | 중 |
| P7-2 | timeline 뷰 (수평 gantt-like, running 동시 시각화) | "지금" 직관성 ↑ | 중 |
| P7-3 | 프로젝트별 색상 자동 할당 (해시 기반) | 시각 구분 | 소 |
| P7-4 | empty session toggle (events 없는 세션 보기) | 디버깅 | 소 |
| P7-5 | 키보드 단축키 (`/` 검색 포커스, `f` 필터 토글) | 파워 사용자 | 소 |
| P7-6 | dark/light theme toggle (현재 dark 고정) | 환경 적응 | 소 |
| P7-7 | menubar 클릭 시 활성 세션 목록 → 클릭 → 해당 세션 jsonl 경로 reveal | 빠른 이동 | 중 |

## P8 — 운영

| # | 항목 | 가치 | 추정 |
|---|------|------|------|
| P8-1 | 자가 헬스 체크 엔드포인트 (`/healthz`, watcher 살아있나) | LaunchAgent KeepAlive 보강 | 소 |
| P8-2 | logs rotation (logback 등가) | 디스크 보호 | 소 |
| P8-3 | 메모리 cap (오래된 세션 evict — 7일 idle) | 800+ 세션 누적 시 메모리 | 중 |
| P8-4 | uninstall 시 logs/ 잔존물 옵션 정리 | 깔끔 | 소 |
| P8-5 | macOS `Background App Refresh` / Focus 모드 인지 | 알림 노이즈 ↓ | 중 |

## P9 — 고급 (선택)

| # | 항목 | Non-Goal? |
|---|------|-----------|
| P9-1 | 검색 인덱스 + 과거 transcript archive 검색 | Yes (Non-Goal §1) — *건너뜀* |
| P9-2 | 팀 공유 (multi-user broadcast) | Yes (Non-Goal §1) — *건너뜀* |
| P9-3 | 원격 monitor (Tailscale 경유) | 1인 환경에서 혼자 사용 시만 — *대기* |
| P9-4 | Slack 알림 (failure 발생 시 webhook) | 옵셔널 — *대기* |
| P9-5 | Linear/Jira 자동 티켓 생성 (장기 failed 호출) | 과한 자동화 — *대기* |

## P10 — 시각 폴리시 & 앰비언트 생명감 (다음 세션 이어서)

> 추가: 2026-05-27 · `/auto` 5+ iter + `/auto wild` 도입 과정에서 쌓인 캐리오버.
> 인프라 메모: cursor 헤드리스 언블록됨(`tools/dispatch.sh` PTY+`-f`, commit 28d9a22). `imagineer` 에이전트는 세션 시작 시 로드 → **다음 세션부터 `/auto wild` 가 머리 takeover 없이 실제 에이전트로 동작**.

### P10-A — 교정 UI 폴리시 (`/auto` 수렴 모드)

| # | 항목 | 우선 | 비고 |
|---|------|------|------|
| P10-A1 | **dark-mode speech-bubble override** | 높음 | iter2 에서 시작했다 중단됨. dark 에서 말풍선이 light cream 으로 떠 보임. `:root[data-theme="dark"] .speech-bubble` + tail(`::after/::before`) navy 적응. task-spec: `scratch/task-spec-iter2-darkbubble-searchbar.md` |
| P10-A2 | **search bar at-rest 톤다운** | 중 | light mode 에서 검색창이 가장 밝은 객체 → 위계 역전(ui-critic should). 비포커스 시 들판에 녹고 focus 시 또렷. (P10-A1 과 동일 task-spec 에 묶여 있음) |
| P10-A3 | room interior scale (dollhouse → 확대) | 중 | 방 floor 패널이 viewport ~50%, humanoid/펫 ~10px. `.scene` width/height 대공사라 별도 iter |
| P10-A4 | signpost/placard label mid-word 절단 | 저 | "git-okest…" 하이픈/단어 경계 ellipsis 로 |
| P10-A5 | active-card amber border 영속 → decay | 저 | tool-call 활동 없으면 border 사라지게(`:focus`만 highlight 등) |
| P10-A6 | speech-bubble right-edge clip (저빈도 재현) | 저 | bubble TTL 로 노출 줄었으나 긴 quest 시 재확인 |

> 머리 판정(false positive, 재대응 금지): "dark 타운 탭 strip 이 tan" — 실제는 navy 정상(specificity `:root[data-theme=dark] #town-signpost` 가 이김). scene-tester/ui-critic 오탐.

### P10-B — 앰비언트 창의 후보 (`/auto wild` single-shot)

> wild 첫 산출 = bird flyby(commit 591231c) 완료. 아래는 imagineer 발산에서 보류한 후속 1건씩.

| # | 아이디어 | lane | 비고 |
|---|---------|------|------|
| P10-B1 | night 별 반짝임 + 가끔 별똥별 (`data-tod=night`) | static | 밤에만 보임 — 검증은 시계 조작/주입 필요 |
| P10-B2 | 세션 완료 순간 그 집 펫이 폴짝 + 반짝 | static | delight 최상, 메타포 강화. 검증 타이밍이 관건 |
| P10-B3 | 길고양이가 마을 가로질러 산책 (집 뒤 z-low) | static/sprite | cat 스프라이트 존재. 카드 z-order 주의 |
| P10-B4 | evening/night 반딧불이 drift | static | 밤 한정 |
| P10-B5 | night 집 창문에 불 켜짐 | static | 카드 장식화 표류 위험 — 신중 |
| P10-B6 | 낮에 나비가 꽃 데코 주변 맴돔 | static/sprite | 꽃 위치 결합 복잡 |

## 의존성 / 호환

- Python 3.11+ (Match 패턴, `dict[str, T]` 타입)
- watchdog (fsevents) — macOS native
- rumps — macOS only (menubar 옵셔널)
- 비-macOS: `serve` + `tui` 만 동작 (menubar / LaunchAgent 자동 skip)

## 위험·회귀 시나리오

| # | 시나리오 | 대응 |
|---|---------|------|
| R-1 | Claude Code jsonl 스키마 변경 (필드 rename) | defensive parser, 미지 필드 무시. P6-2 로 감지 |
| R-2 | 800+ sessions 누적 → 메모리 부담 | P8-3 (idle evict) |
| R-3 | watchdog fsevents 누락 (macOS bug) | PollingObserver fallback (P6-3 같이 처리) |
| R-4 | rumps 데코레이터 메뉴 갱신 race | menu.clear + 재구성 (현재 구현) |
| R-5 | LaunchAgent bootstrap 실패 (SIP / PowerSlave) | uninstall + 수동 `launchctl load` 안내 (현재 fallback 존재) |

## 우선순위 추천 (다음 1 sitting)

1. **P6-2** (파싱 실패 카운터) — 5분, 회귀 조기 감지
2. **P6-4** (orphaned 식별) — 10분, 정확도
3. **P7-1** (통계 패널) — 30분, 가시성 폭증
4. **P8-1** (`/healthz`) — 5분, LaunchAgent KeepAlive 의미화

총 ~1 hour. 그 이후는 사용 패턴 따라 P7-2 / P6-5 결정.
