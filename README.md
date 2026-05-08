# agent-dashboard

Claude Code 의 모든 세션에서 호출되는 서브에이전트(`Agent` tool) 활동을 한 곳에서 라이브 모니터링하는 1인용 로컬 도구.

> 설계 문서: [`DESIGN.md`](./DESIGN.md)

## 무엇을 보여주나

- `~/.claude/projects/*/<session>.jsonl` 을 watch → `tool_use` (`name="Agent"`) 와 매칭되는 `tool_result` 를 라이브로 추적
- 각 서브에이전트 호출마다 `running / done / failed / stale / orphaned` 상태 표시
- 프로젝트 → 세션 → agent call 트리 (웹) / 테이블 (TUI) / 메뉴바 카운터 (menubar)
- `/tmp/wt-status/*.json` 워크트리 협업 보드도 함께 (legacy 어댑터)

## 설치

```bash
cd ~/agent-dashboard
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[menubar]"     # 웹+TUI+메뉴바
# 또는 메뉴바 빼고:
# pip install -e .
```

## 실행

```bash
agent-dashboard                       # 웹 서버 (기본). http://127.0.0.1:7878
agent-dashboard tui                   # 터미널 (rich)
agent-dashboard menubar               # macOS 메뉴바 (rumps 필요, 웹 서버 동시 실행 권장)
```

## 자동 시작 (LaunchAgent)

로그인 시 웹 서버 + 메뉴바 둘 다 자동 시작되도록 등록:

```bash
agent-dashboard install-launchagents
```

확인:
```bash
agent-dashboard status
```

해제:
```bash
agent-dashboard uninstall-launchagents
```

로그 위치: `~/agent-dashboard/logs/{web,menubar}.{out,err}.log`

## 환경 변수

| 변수 | 기본 | 설명 |
|------|------|------|
| `AGENT_DASHBOARD_HOST` | `127.0.0.1` | 웹 서버 bind 호스트 |
| `AGENT_DASHBOARD_PORT` | `7878` | 웹 서버 포트 |
| `AGENT_DASHBOARD_LOG`  | `INFO` | 로그 레벨 |
| `AGENT_DASHBOARD_URL`  | `http://127.0.0.1:7878` | menubar 가 폴링할 대상 |
| `AGENT_DASHBOARD_MENUBAR_POLL` | `3` | menubar 폴링 주기(초) |

## 아키텍처

```
agent_dashboard/
├── core/
│   ├── model.py        # AgentEvent, WtStatusEntry
│   ├── parser.py       # jsonl line → AgentEvent
│   ├── watcher.py      # ~/.claude/projects 파일 변경 감지
│   ├── wt_status.py    # /tmp/wt-status 어댑터
│   └── store.py        # in-memory 통합 상태
├── ui_web/             # FastAPI + SSE + 단일 HTML
├── ui_tui.py           # rich live table
├── ui_menubar.py       # rumps (HTTP 폴링 클라이언트)
└── launchagents.py     # plist 생성 + launchctl bootstrap
```

코어는 UI 무관. 어떤 UI 든 `Store` 를 import 하면 끝.

## 마이그레이션 노트

- contrabass-admin-service 의 `scripts/wt-dashboard.py` 는 그대로 유지하되 deprecation 주석 추가됨. `agent-dashboard` 가 상위 호환.
- 기존 `wt-update.sh` 흐름은 그대로 — `/tmp/wt-status/*.json` 어댑터가 같이 표시.

## 보안

- 기본 bind 는 `127.0.0.1`. 외부 노출 X.
- transcript 에 비밀이 있을 수 있음. 본 도구는 prompt 첫 줄 80자만 노출. 클릭 시 expanded 패널에서 확장 (전문 X).

## 개발

```bash
# 한 번 동작 확인
python3 -m agent_dashboard serve
# 다른 터미널
curl -s http://127.0.0.1:7878/api/snapshot | python3 -m json.tool | head -40
```

샘플 jsonl 테스트:
```bash
python3 -c "
from agent_dashboard.core.parser import parse_jsonl
import sys
events = parse_jsonl(open(sys.argv[1]), project_slug='test', project_cwd='/tmp', session_id='test')
print(f'{len(events)} agent calls')
for e in events.values(): print(f'  {e.status:8s} {e.subagent_type or \"(fork)\":20s} {e.description[:60]}')
" ~/.claude/projects/<some-session>.jsonl
```

## 라이선스

개인 도구. 공유·재배포 X.
