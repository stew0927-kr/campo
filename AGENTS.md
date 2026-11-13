# 캠포 (CAMPO)

대학 캠퍼스 길안내 서비스. 정문·역 출구에서 강의실 문 앞까지 안내하고, 계단 길과 엘리베이터 길을 구분해 보여 준다. 지금 만드는 것은 지도 데이터 편집기와 공용 길찾기 코드다. 전체 명세는 docs/SPEC.md.

## 반드시 지킬 것

- 작업 전에 docs/SPEC.md와 docs/decisions.md를 읽는다. 둘과 다르게 만들어야 하면 먼저 사람에게 묻는다.
- IMPORTANT: 길찾기는 층 번호를 비교하지 않는다. 구간(edge) 연결만 따른다.
- 데이터 스키마(data/schema/campo.schema.json, packages/core의 타입)를 바꾸면 SPEC.md 4장, fixture, 테스트를 같은 PR에서 함께 고친다.
- 구글·네이버·카카오 지도나 위성사진을 편집기 배경이나 데이터 출처로 넣지 않는다.
- 맡은 폴더 밖의 파일은 고치지 않는다. 필요하면 PR 설명에 이유를 쓴다.
  - packages/core, data/schema, packages/tools: 리드
  - packages/editor: 편집기 담당
  - data/campuses: 데이터 담당(건물 단위로 나눠 맡음)
  - apps/mobile: 현장 조사 앱 담당 (명세는 docs/mobile/SPEC-mobile.md)
- 화면 문구는 한국어 존댓말. 코드 식별자와 커밋 메시지는 영어.
- 데이터를 바꾸는 코드는 packages/core/src/edit의 동작(action)만 쓴다.
- 패키지 설치와 package.json 변경은 메인 세션만 한다. 서브에이전트는 하지 않는다.
- v0.2 작업 중에는 docs/v0.2/SPEC-v0.2.md가 SPEC.md보다 우선한다.

## 명령어

- `npm install` 처음 한 번
- `npm test` 전체 테스트 (Vitest)
- `npm run validate` 데이터 검사
- `npm run editor` 편집기 실행 (로컬 개발 서버, 저장 시 data/에 파일을 씀)
- `npm run typecheck` 타입 검사

## 작업 방식

- 기능 하나 = 브랜치 하나 = PR 하나. 하루~이틀 안에 합칠 수 있는 크기로 나눈다.
- 끝났다고 말하기 전에 `npm test`, `npm run typecheck`, (데이터를 고쳤으면) `npm run validate`를 돌리고 결과를 보여 준다.
- 화면을 바꿨으면 실행해서 확인한 내용을 PR 설명에 적는다.
- 중요한 결정을 했으면 docs/decisions.md에 날짜·내용·이름을 한 줄로 남긴다.

## 테스트와 보고 규칙

- 테스트 실행: 수정 중에는 관련 테스트 파일 하나만 돌린다. typecheck와 전체 테스트(루트 `npm test`)는 커밋 직전에 한 번만 돌리고, 결과가 바뀔 이유 없이 같은 명령을 다시 돌리지 않는다.
- 작업 끝 보고(모든 작업 공통): 루트 `npm test` 결과(전체 테스트 수, 실패 수)와 `npm run typecheck` 결과를 붙인다.
- `git log --oneline` 최근 커밋과 `git diff --stat`을 붙인다.
- 계획과 다르게 한 것, 기존 테스트를 바꾼 것(이유 포함)을 따로 적는다.
