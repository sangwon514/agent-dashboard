# scratch — 서브에이전트 간 공유 파일

본 디렉토리는 Agentville 서브에이전트들이 한 작업 흐름을 이어받을 때 결과물을 두는 공간이다.

## 명명 규칙

| 파일명 | 작성자 | 내용 |
|-------|-------|------|
| `scene-report-{YYYY-MM-DD-HHMMSS}.md` | scene-tester | Playwright 스크린샷 경로 + 발견 이슈 |
| `ui-review-{YYYY-MM-DD-HHMMSS}.md` | ui-critic | 디자인 비평 (텍스트만) |
| `task-spec-{slug}.md` | auto-orchestrator | 다음 에이전트 위임 사양 + 수용 기준 |
| `done-{slug}.md` | frontend-dev / pixel-artist | 변경 파일 목록 + 검증 결과 + 후속 리스크 |

## 규칙

1. **새 보고서 작성 전 같은 타입 최신 1개 read** — 중복/회귀 방지.
2. **한 작업 = 한 파일** — 누적 파일 만들지 말 것.
3. **7일 이상 된 파일은 자유롭게 삭제** — 이미 stale.
4. **gitignore 처리됨** (`.gitignore` 의 `.claude/scratch/*`) — 본 README.md 만 추적.
5. **PNG/이미지는 두지 말 것** — `/tmp/agentville-out/` 으로. scratch 는 텍스트 보고서만.

## 슬러그 컨벤션

- 영소문자 + 하이픈 + 숫자
- 예: `floor-shadow-fix`, `new-turtle-sprite`, `label-collision-v2`

## 관련 문서

- 전체 흐름: [`../WORKFLOW.md`](../WORKFLOW.md)
- /auto 동작: [`../skills/auto/SKILL.md`](../skills/auto/SKILL.md)
- 컨셉/SSOT: [`../../CLAUDE.md`](../../CLAUDE.md)
