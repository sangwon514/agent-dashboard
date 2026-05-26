---
name: propose
description: |
  product-strategist 호출 — 프로젝트 비전 vs 현재 vs 외부 레퍼런스 갭 분석 후 방향성 제안.
  사용:
    /propose             — 전체 프로젝트 갭 분석
    /propose <focus>     — focus 영역 (예: "펫 인터랙션", "스프라이트 종 다양성") 한정
---

# /propose — Agentville 방향성 제안

인자: `$ARGUMENTS` (선택 — focus 키워드)

## 목적

**사용자에게 묻지 않고 *추천*까지 끝내는** 의견서 1장. 코드 변경 없음.

- 입력: 메모리(원래 비전) + 프로젝트 문서 + git log + WebSearch 외부 레퍼런스
- 출력: `.claude/scratch/proposal-{YYYY-MM-DD-HHMMSS}.md` + stdout 1줄 요약

## 동작

`product-strategist` 에이전트를 Agent tool 로 1회 호출. 위임 프롬프트에 반드시 포함:

1. focus 인자 (`$ARGUMENTS`) — 비었으면 "open"
2. CLAUDE.md "Output-to-File-First" 룰 인용
3. `.claude/scratch/proposal-{ts}.md` 명명 규칙 인용
4. 비전 baseline 은 메모리(`~/.claude/projects/-Users-sangwonlee-agent-dashboard/memory/project_agentville.md`) 의 Why/How 섹션을 *반드시* 인용해서 시작할 것
5. WebSearch/WebFetch 외부 레퍼런스 *최소 1회* 의무 — 50줄+ 결과는 `/tmp/agentville-out/strategist-research-{ts}.txt` 로 먼저 저장
6. STOP 조건: proposal 파일 1개 작성 + stdout 1줄 보고

## 종료 시 사용자에게 보일 것

- 생성된 proposal 경로
- Top recommendation 1줄

루프 없음. 1회성 호출.

## 사용 예

```
/propose
/propose 펫 인터랙션 강화 방향
/propose 다른 IDE/에디터로 확장 검토
/propose 단일 머신 외에 팀 단위 시야 가능성
```

## 안전장치

- product-strategist 는 코드 미터치 (`tools: Read, Write, Glob, Grep, Bash, WebSearch, WebFetch` — Edit 없음).
- proposal 파일은 `.gitignore` 처리된 `.claude/scratch/` 안 → 휘발성, 채택된 항목만 사용자가 ROADMAP/메모리로 승격.
