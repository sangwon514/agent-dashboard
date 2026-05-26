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

### C2 · orphaned idle 감지 (ROADMAP P6-4) ⬜
- **파일**: `agent_dashboard/core/{store,parser}.py` + `tests/`
- **내용**: 마지막 활동 후 N분(예: 30m) idle 인 `running` 호출 → `orphaned`. (`Status` literal 에 이미 존재, 판정 로직만 없음.)
- **수용**: idle fixture → `orphaned` 단위테스트. 기존 stale 로직과 충돌 없게.

### C3 · 증분 read (ROADMAP P6-3) ⬜
- **파일**: `agent_dashboard/core/{watcher,store}.py` + `tests/`
- **내용**: 파일별 `last_offset` 추적 → 변경분만 파싱(매번 전체 재파싱 회피).
- **수용**: 기존 파서 테스트 전부 PASS + offset 재사용 단위테스트. 대용량 세션 CPU 절감.

---

## ✋ Cursor lane — frontend only (`agent_dashboard/ui_web/static/**`)

### U1 · 키보드 단축키 (ROADMAP P7-5) ✅
- **파일**: `app.js` (+ 필요시 `style.css`)
- **내용**: `/` 검색창 포커스 · `f` 필터 토글 · `Esc` expanded 패널 닫기.
- **수용**: `python3 -m agent_dashboard serve` 띄워 동작 확인. **input/textarea 포커스 중엔 단축키 무시.**

### U2 · dark/light 테마 토글 (ROADMAP P7-6) ⬜
- **파일**: `style.css`, `app.js`, `index.html`(토글 버튼)
- **내용**: CSS 변수 기반 light 테마 추가 + 토글, `localStorage` 보존. 현재 dark 고정.
- **수용**: 토글→새로고침해도 유지. **Agentville 픽셀 펫-키퍼 미감 유지(카드/테이블/RPG 금지).**

### U3 · 프로젝트 색상 해시 (ROADMAP P7-3) ⬜
- **파일**: `app.js`, `style.css`
- **내용**: 프로젝트(집)별 해시 기반 색 자동 할당으로 시각 구분.
- **수용**: 같은 프로젝트=항상 같은 색. 펫-키퍼 미감 유지.

---

## 🧠 머리 직접 / 직렬 (병렬 금지 — 의존·경계)
- **P6-2 파싱 실패 카운터**: 백엔드 카운트(parser/store/server = Codex) + 헤더 표시(app.js = Cursor) 가 의존 → 머리가 순서 배정. 지금 병렬 큐에 넣지 않음.
- **경계 파일**: `pyproject.toml`, `server.py` 의 static 서빙부 등 두 도메인이 만나는 변경.

---

### 병렬 안전성 메모
- C1·C2·C3 ↔ U1·U2·U3 은 **Python vs static/** 으로 도메인이 disjoint → Codex 와 Cursor 가 동시에 돌려도 파일 충돌 없음.
- 단, **같은 lane 안(C들끼리, U들끼리)은 한 도구가 순차로** — app.js/store.py 를 공유하므로 한 번에 하나씩.
