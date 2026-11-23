# security-audit 스킬 — 어디서 왔고 무엇을 바꿨나

## 출처

- 업스트림: <https://github.com/cloudflare/security-audit-skill> (Cloudflare, MIT License)
- 가져온 커밋: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8` — "Clarify guidance and full audit modes" (2026-09-14)
- 업스트림 원본 위치: `skills/security-audit/` — 이 저장소에는 Claude Code가 자동으로 찾는 `.claude/skills/security-audit/`에 두었다.
- `LICENSE`도 업스트림 저장소 루트에서 그대로 가져왔다(MIT, Copyright (c) 2025-2026 Cloudflare, Inc.).

## 바꾼 것

없음. 스킬 파일 20개와 `LICENSE`를 업스트림 그대로 복사했다. 이 문서만 이 저장소에서 새로 썼다.

- 업스트림 `SKILL.md`·`VALIDATION-AND-REPORTING.md` 등에 박혀 있는 경로 참조는 없다(`skills/security-audit` 문자열 0건).
  검증 스크립트는 `__dirname` 기준으로 `report-schema.json`을 읽으므로 폴더 위치를 바꿔도 그대로 동작한다.
- `package.json`은 **넣지 않았다** (불필요). 이 저장소 루트 `package.json`은 `"type": "module"`이지만,
  `.cjs` 확장자는 패키지 타입과 무관하게 항상 CommonJS로 해석된다. 이 스킬의 실행 파일은 전부 `.cjs`이고
  `.js`는 하나도 없어서, `wireflow-review`처럼 폴더 단위로 `"type": "commonjs"`를 고정할 이유가 없다.

## ESM 충돌 없이 도는지 확인한 내용 (Node v22.14.0, 2026-11-23)

`.claude/skills/security-audit`에서:

| 확인 | 명령 | 결과 |
|---|---|---|
| findings 검증기 테스트 | `node --test validate-findings.test.cjs` | 34 tests, **34 pass / 0 fail** |
| coverage-ledger 검증기 테스트 | `node --test validate-coverage-ledger.test.cjs` | 31 tests, **31 pass / 0 fail** |
| CLI 진입점(`require.main === module`) | `node validate-findings.cjs` (인자 없이) | 사용법 출력, exit 1 |
| CLI 진입점 | `node validate-coverage-ledger.cjs` (인자 없이) | 사용법 출력, exit 1 |
| 없는 파일 지정 | `node validate-findings.cjs /tmp/nope.json` | 읽기 실패 메시지, exit 1 |

- `require("./report-schema.json")`(테스트), `require("node:fs")`·`require("fs")` 모두 정상. ESM 해석 오류 없음.
- 루트 `npm test`(Vitest)와는 충돌하지 않는다. 루트 `vitest.config.ts`는 `projects: ['packages/*', 'apps/*']`만
  수집하므로 `.claude/` 아래 `.cjs` 테스트 파일은 테스트 목록에 들어오지 않는다(같은 형태의 최소 설정으로
  `vitest list`를 돌려 `.claude` 아래 `*.test.cjs`가 수집되지 않는 것을 확인).

## 쓰는 법

- Claude Code에서 "이 코드베이스 보안 감사해줘", "취약점 찾아줘", "security audit this codebase"처럼 요청한다.
  보안 질문·부분 리뷰는 guidance 모드, 명시적 전체 감사/펜테스트 요청만 full audit 모드로 동작한다.
- 감사 산출물 기본 경로: `~/security-audit-skill/<repo-name>/run-<N>` (저장소 밖).
- 검증 스크립트 직접 실행:
  `node .claude/skills/security-audit/validate-coverage-ledger.cjs <coverage-ledger.json>`
  `node .claude/skills/security-audit/validate-findings.cjs <findings.json>`

## 요구 사항과 주의

- Node.js 필요(검증기용, 의존성 0개). 이 저장소 `.nvmrc`는 22.
- 대상 코드의 빌드·테스트·프로세스 실행은 OS 수준 샌드박스(외부 네트워크 차단, 환경 정리, 쓰기 제한, 자원 제한)가
  있을 때만 한다. 없으면 실행하지 말고 `needs_validation`으로 남긴다 — 업스트림 규칙이며 `SKILL.md`에도 있다.

## 라이선스

MIT. `LICENSE` 파일 포함. 재배포 시 저작권 고지와 라이선스 전문을 유지한다.
업스트림을 갱신할 때는 새 커밋과 이 폴더를 비교하고, 위 "바꾼 것"(없음) 상태를 다시 확인한다.
