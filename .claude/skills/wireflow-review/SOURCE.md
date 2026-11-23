# wireflow-review 스킬 — 어디서 왔고 무엇을 바꿨나

## 출처

- 업스트림: <https://github.com/JeongK7998/wireflow-review> (공개 저장소, XU Wireflow Review)
- 가져온 커밋: `8b78d9a` (Simplify project setup for public link access, 2026-11-22) · 배포판 v0.5.5
- 업스트림 원본 위치: `.agents/skills/wireflow-review/` — 이 저장소에는 Claude Code가 자동으로 찾는 `.claude/skills/wireflow-review/`에 두었다.

## 이 저장소에 맞춰 바꾼 것 (2가지)

1. `references/independent-verification.md`의 경로
   `.agents/skills/wireflow-review` → `.claude/skills/wireflow-review` (6곳). 명령을 그대로 복사해 실행할 수 있게 하기 위해서다.
2. `package.json` 추가 — `{"private": true, "type": "commonjs"}`
   이 저장소 루트 `package.json`이 `"type": "module"`이라, 이 폴더의 `assets/*.js`가 ESM으로 해석되어
   `require()`가 빈 객체를 돌려주고 `wireflow.validateModel is not a function`으로 실패한다.
   스킬 폴더만 CommonJS로 고정하면 해결된다. (스킬 코드는 손대지 않았다.)

그 밖의 파일은 업스트림과 같다. 스킬을 갱신할 때는 새 버전과 비교하고 위 두 가지를 다시 적용한다.

## 쓰는 법

- Claude Code에서 `/wireflow-review` 또는 "이 기획을 클릭 가능한 와이어플로우로 펼쳐줘"처럼 요청한다.
- 기본 검사·HTML 생성: Node.js 18 이상.
  `node .claude/skills/wireflow-review/scripts/wireflow.cjs check FLOW.json`
  `node .claude/skills/wireflow-review/scripts/wireflow.cjs build FLOW.json VIEWER.html`
- 독립 브라우저 검증(선택): Node.js 20 이상 + `npm ci --prefix .claude/skills/wireflow-review/verification`

## 라이선스

업스트림 저장소에 LICENSE 파일이 없다. 이 저장소 안에서 팀이 쓰는 것은 문제없지만,
저장소 밖으로 재배포하거나 공개 배포물에 넣기 전에는 업스트림 작성자에게 허락을 확인한다.
