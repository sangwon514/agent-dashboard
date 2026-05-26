# COLLAB.md — 멀티 툴 협업 모델 (SSOT)

이 저장소는 세 AI 도구가 **같은 코드**를 만진다. 역할이 다르다. 이 문서가 "누가 무엇을 하는가"의 1순위 기준이다.

## 🧠 역할 분담

| 도구 | 역할 | 진입 파일(자기가 읽는 룰) | 주 업무 |
|------|------|--------------------------|---------|
| **Claude Code** | 🧠 머리 (head) | `CLAUDE.md` | 계획·아키텍처 결정·SSOT 관리·오케스트레이션(`/auto`,`/propose`)·최종 리뷰 |
| **Codex** | ✋ 손 (hands) | `AGENTS.md` | 명확히 정의된 구현 작업. `.codex/` 에 에이전트/훅 보유 |
| **Cursor** | ✋ 손 (hands) | `.cursor/rules/*.mdc` | 명확히 정의된 구현 작업. 인라인 편집·빠른 단발 수정에 강함 |

## 원칙

1. **머리가 계획, 손이 구현.** 복잡한 멀티파일 변경·방향성 결정·진단 루프는 Claude Code 가 먼저 한다. Cursor/Codex 는 **범위가 명확한 작업**을 받아 실행한다. 손이 애매한 작업을 받으면 추측하지 말고 머리(사람)에게 되묻는다.
2. **SSOT 가 계약서.** 모든 도구는 `DESIGN.md`(데이터/아키텍처) · `ROADMAP.md`(우선순위) · `README.md`(설치/실행) · 본 문서 · Agentville 컨셉을 따른다. **충돌 시: SSOT 문서 > 도구별 룰 > 추측.**
3. **`git log` 가 공유 작업 기록.** 별도 work-log 없음. 손이 작업하면 conventional commit 으로 정직하게 남긴다. 머리는 `git log` / `git diff` 로 리뷰한다.
4. **도구 무관 안전망 = git 네이티브 훅.** 루트 `.githooks/pre-commit` 이 커밋 전 ruff+pytest 를 돌려 실패 시 차단한다 — Claude Code/Codex/Cursor/수동 **어느 경로로 커밋해도** 동일 적용. 클론/머신당 1회 활성화: `git config core.hooksPath .githooks`. (`.claude/hooks/`·`.codex/hooks/` 의 자동 훅은 각 도구 전용이라 Cursor 엔 안 돈다.) `git commit --no-verify` 금지 — git 설계상 이 훅을 우회하므로 절대 쓰지 않는다.
5. **버려진 방향 재도입 금지** (전 도구 공통): 카드 대시보드 · 테이블 UI · RPG/소환사 메타포. Agentville 은 "방 안에 캐릭터가 사는" 픽셀 펫-키퍼 그림이 목표다.

## 핸드오프 절차 (손 → 머리)

손(Cursor/Codex)이 작업을 마치면:
- 변경 파일 + 검증 결과(어떤 테스트/lint 를 돌렸고 통과했는지)를 commit message 또는 응답에 명시.
- 회귀 위험·미해결 항목이 있으면 명시.
- 컨셉·구조를 바꿨다면 관련 SSOT 문서(DESIGN/ROADMAP/README)도 같은 커밋에서 갱신.

## 🚧 동시 작업 충돌 방지 정책

Codex 와 Cursor 가 **동시에** 일할 수 있으므로, 충돌을 사후 해결이 아니라 **원천 차단**한다.

1. **파일 도메인 분리 (1차 방어 — 가장 중요).** 두 손의 작업 영역을 disjoint 하게 고정한다:
   - **Cursor →** `agent_dashboard/ui_web/static/**` (`app.js` · `style.css` · `index.html`) **만**.
   - **Codex →** Python (`agent_dashboard/**/*.py` · `tests/**`) **만**.
   - 두 집합은 겹치지 않으므로 같은 파일을 동시에 만질 일이 없다. (기존 `frontend-dev`=static / Python=백엔드 역할 분리와 동일 원칙.)
2. **한 파일 한 주인.** 머리(Claude Code)가 배정할 때 같은 파일을 두 도구에 동시에 주지 않는다.
3. **같은 `main` + disjoint 파일이면 브랜치 없이도 안전.** 1인 로컬이라 원격 push 경쟁이 없다 — 도메인만 분리돼 있으면 순차 커밋으로 충돌이 안 난다. 작업 단위는 잘게, **끝나면 즉시 커밋**. 더 깔끔한 히스토리를 원하면 `codex/<slug>` · `cursor/<slug>` 브랜치 후 머리가 머지(도메인 disjoint 라 머지 충돌 ≈ 0).
4. **경계 파일은 직렬화(병렬 금지).** 두 도메인이 만나는 파일을 둘 다 건드려야 하는 작업은 머리가 한 도구씩 순서대로 배정한다: `pyproject.toml`, `server.py` 의 static 서빙 부분 등. (`index.html` 은 static 이라 Cursor 전담 — Codex 는 손대지 않는다.)
5. **백엔드↔프론트 의존 작업은 머리가 분해.** "API 필드 추가(Codex) + 그 표시(Cursor)" 처럼 엮인 건 병렬 금지 — 한쪽 먼저 끝내고 순서대로. 서로 독립인 작업만 병렬로 돌린다.
6. **현재 점유는 [`TASKS.md`](./TASKS.md) 가 표시.** 손은 자기 lane 항목만 집고, 시작 시 🔵in-progress / 완료 시 ✅done 으로 갱신해 다른 손이 점유 상태를 본다.
