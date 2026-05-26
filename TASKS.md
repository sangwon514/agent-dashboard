# TASKS.md — 작업 할당 보드

> 머리(Claude Code)가 배정한다. 손(Codex/Cursor)은 **자기 lane 항목만** 집는다.
> 상태: ⬜ todo · 🔵 in-progress · ✅ done — 시작/완료 시 본인이 갱신.
> 충돌 방지 규칙: [`COLLAB.md` → 동시 작업 충돌 방지 정책](./COLLAB.md). lane 밖 파일 금지.
> 각 작업: 끝나면 `ruff check agent_dashboard` + `pytest -q` 통과 확인 후 conventional commit. (git 훅이 자동 차단.)

---

## ✋ Codex lane — Python only (`agent_dashboard/**/*.py`, `tests/**`)

### C1 · `/healthz` 엔드포인트 (ROADMAP P8-1) ✅  ← 여기부터
- **파일**: `agent_dashboard/ui_web/server.py` + `tests/`
- **내용**: `GET /healthz` → `{ok, watcher_alive, last_event_at, session_count}`. watcher 정상=200, 죽었으면 503.
- **수용**: `curl -s -o /dev/null -w '%{http_code}' /healthz` = 200. watcher dead 모킹 시 503. 단위테스트 1건.
- **lane**: server.py 의 라우트 등록부만. static 서빙/HTML 은 건드리지 않음(경계).

### C2 · orphaned idle 감지 (ROADMAP P6-4) ✅ (codex dispatch → head 리뷰·커밋)
- **파일**: `agent_dashboard/core/{store,parser}.py` + `tests/`
- **내용**: 마지막 활동 후 N분(예: 30m) idle 인 `running` 호출 → `orphaned`. (`Status` literal 에 이미 존재, 판정 로직만 없음.)
- **수용**: idle fixture → `orphaned` 단위테스트. 기존 stale 로직과 충돌 없게.

### C3 · 증분 read (ROADMAP P6-3) ⬜
- **파일**: `agent_dashboard/core/{watcher,store}.py` + `tests/`
- **내용**: 파일별 `last_offset` 추적 → 변경분만 파싱(매번 전체 재파싱 회피).
- **수용**: 기존 파서 테스트 전부 PASS + offset 재사용 단위테스트. 대용량 세션 CPU 절감.

### C4 · Cursor town 백엔드 (신규 피처) 🔵 (codex 자율 dispatch)
- **파일**: 신규 `core/cursor_parser.py`, `core/cursor_usage.py` + `core/model.py`(Tool 에 "cursor") + `core/watcher.py`(WATCH_ROOTS 한 줄) + `ui_web/server.py`(/api/usage 에 cursor) + tests. (Python only — 프론트는 U4)
- **데이터 소스** (탐색 완료):
  - 세션 jsonl: `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`
    - 라인: `{"role":"user|assistant","message":{"content":[{type:"text"|"tool_use",name,input}]}}`. **최상위 timestamp/type 없음** — timestamp 는 user content 텍스트의 `<timestamp>…</timestamp>` 에 내장(정규식 추출, 없으면 파일 mtime/now 폴백).
    - 서브에이전트: 같은 폴더의 `subagents/<uuid>.jsonl` → **각 서브에이전트 = 펫 1개** (subagent_type="cursor-agent").
    - **slug 는 leading dash 없음**(`Users-…`) — Claude(`-Users-…`)와 다름.
  - 사용량: `~/.cursor/ai-tracking/ai-code-tracking.db` (SQLite, `mode=ro&immutable=1` 로 open). 테이블 `ai_code_hashes`(source,model,timestamp,conversationId), `scored_commits`(linesAdded/Deleted, composerLinesAdded…). 최근 24h 라인변경량·요청수 집계 → usage dict.
- **설계(머리 지정)**: `codex_parser.py`/`codex_usage.py` 를 **템플릿으로 동형** 구현. `tool="cursor"`. 세션당 서브에이전트→펫, 서브에이전트 없으면 빈 events(휴머노이드만, store 가 허용). **over-engineer 금지** — 펫 다양화(tool_use 분류)는 후속.
- **수용**: cursor 트랜스크립트 fixture 로 파싱 테스트(세션·서브에이전트→펫·tool=='cursor'), ai-tracking 샘플로 usage 집계 테스트, 기존 테스트 PASS. `uv run pytest -q`. 커밋 금지(머리 리뷰 후).

---

## ✋ Cursor lane — frontend only (`agent_dashboard/ui_web/static/**`)

### U1 · 키보드 단축키 (ROADMAP P7-5) ✅
- **파일**: `app.js` (+ 필요시 `style.css`)
- **내용**: `/` 검색창 포커스 · `f` 필터 토글 · `Esc` expanded 패널 닫기.
- **수용**: `python3 -m agent_dashboard serve` 띄워 동작 확인. **input/textarea 포커스 중엔 단축키 무시.**

### U2 · dark/light 테마 토글 (ROADMAP P7-6) ✅ (head 직접 — cursor 블로커로 위임 불가)
- 비고: 전제 stale 였음(이미 양피지+tod 시스템). off-by-default 다크 팔레트 토글로 구현(`[data-theme="dark"]` var 오버라이드 + localStorage).
- **파일**: `style.css`, `app.js`, `index.html`(토글 버튼)
- **내용**: CSS 변수 기반 light 테마 추가 + 토글, `localStorage` 보존. 현재 dark 고정.
- **수용**: 토글→새로고침해도 유지. **Agentville 픽셀 펫-키퍼 미감 유지(카드/테이블/RPG 금지).**

### U3 · 프로젝트 색상 해시 (ROADMAP P7-3) ⬜
- **파일**: `app.js`, `style.css`
- **내용**: 프로젝트(집)별 해시 기반 색 자동 할당으로 시각 구분.
- **수용**: 같은 프로젝트=항상 같은 색. 펫-키퍼 미감 유지.

### U4 · Cursor town 프론트 (C4 의존) ⬜ — head 직접 (cursor 블로커)
- **파일**: `app.js` (+ `style.css`)
- **내용**: cursor 펫 스프라이트 + `cursor-*`→pet 매핑(codex 펫 패턴 참고) + town signpost 에 cursor 마을 + usage 헤더 cursor 세그먼트.
- **의존**: C4(백엔드 tool="cursor" + /api/usage cursor) 착지 후 직렬. 
- **수용**: serve 띄워 cursor 마을 + 펫 렌더 + 사용량 표시. 픽셀 펫-키퍼 미감 유지.

---

## 🧠 머리 직접 / 직렬 (병렬 금지 — 의존·경계)
- **P6-2 파싱 실패 카운터**: 백엔드 카운트(parser/store/server = Codex) + 헤더 표시(app.js = Cursor) 가 의존 → 머리가 순서 배정. 지금 병렬 큐에 넣지 않음.
- **경계 파일**: `pyproject.toml`, `server.py` 의 static 서빙부 등 두 도메인이 만나는 변경.

---

### 병렬 안전성 메모
- C1·C2·C3 ↔ U1·U2·U3 은 **Python vs static/** 으로 도메인이 disjoint → Codex 와 Cursor 가 동시에 돌려도 파일 충돌 없음.
- 단, **같은 lane 안(C들끼리, U들끼리)은 한 도구가 순차로** — app.js/store.py 를 공유하므로 한 번에 하나씩.
