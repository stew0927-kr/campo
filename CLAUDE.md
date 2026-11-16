@AGENTS.md

# 최종 사용자 앱 `apps/app` — 추가 규칙

위 `AGENTS.md`를 먼저 읽는다. 아래는 그것을 대체하지 않고, 이 저장소에 새로 들어온 **최종 사용자 앱**에만 더하는 규칙이다.
사용 설명서(프론트 담당용): `docs/FRONTEND_HANDOFF.md`.

## 저장소 지도와 경계

| 폴더 | 역할 | 이 앱의 작업자가 건드릴 수 있나 |
|---|---|---|
| `apps/app` | **최종 사용자 앱**(Expo, Android 우선). 5탭 화면 + 코어 계약 훅 | 예 — 단, 아래 계약 영역 규칙을 지킨다 |
| `apps/mobile` | 현장 조사 앱(지도 데이터를 만드는 도구) | 아니오 |
| `apps/editor` | 지도 데이터 편집기(Vite + React) | 아니오 |
| `packages/core` | 스키마 타입·그래프·길찾기·GPS 매칭(`matching/`). 모든 앱이 공유 | 아니오 — 필요하면 리드 확인 |
| `packages/tools`, `data/schema`, `data/campuses` | 데이터 검사·캠퍼스 데이터 | 아니오(데이터 담당) |
| `tools/elevation` | 고도 솔버(Python) | 아니오 |

`apps/app`의 화면은 이 앱 작업자(프론트)의 자유 영역이고, `packages/core`는 모든 앱이 함께 쓰는 공용 코드라
이 앱 때문에 바뀌면 안 된다. 코어를 고쳐야 할 것 같으면 먼저 이 앱의 계약 안에서 감싸서 해결할 수 있는지 본다.

## 계약 영역 (하위 호환 유지)

`apps/app/src/contracts.ts`, `src/hooks/`, `src/campus/`, `src/route/`, `src/matching/`은 **안정 계약**이다.
화면을 만드는 사람과 그 AI가 이 타입에 기대어 화면을 붙이므로 다음을 지킨다.

- **필드 이름·의미를 바꾸지 않는다.** 새 값은 **optional(`?`) 필드로만** 더한다. 필수 필드를 더하는 것도 깨지는 변경이다.
- 계약 타입은 `@campo/core`의 타입을 **그대로 쓰거나 감싼다**. 코어 타입을 다시 정의하지 않는다.
- 화면에 보이는 문구는 계약이 주는 `message`·`label`·`steps[].text`를 쓴다(이미 한국어 존댓말). 화면에서 새로 만들지 않는다.
- 계약을 바꿔야 한다고 판단되면 **바꾸지 말고 먼저 사람에게 묻는다.** PR 설명에 이유를 쓰는 것으로 대신하지 않는다.
- 순수 엔진(`src/route/routeEngine.ts`, `src/matching/matcherSession.ts`, `src/campus/loadBundledCampus.ts`)은 React를 import하지 않는다.
  그래야 Node에서 테스트할 수 있다(`apps/app/test/`, `environment: 'node'`).

## 앱에서 지킬 것

- **5탭 UI는 프론트 담당이 만든다.** 이 저장소의 스캐폴드 단계에서는 `App.tsx`에 빈 시작 화면 하나만 둔다(탭·네비게이션을 미리 만들지 않는다).
- **지도 배경은 `src/map/style.ts`의 OSM 래스터**를 쓴다. 구글·네이버·카카오 지도/타일/위성사진 금지, 출처 표시 필수.
- **길찾기는 층 번호를 비교하지 않는다.** 층은 화면 표시·GPS 후보 필터에만 쓴다(`floorChanges`·`steps[].fromLevel/toLevel`은 표시용).
- 캠퍼스 데이터는 `scripts/bundle-campus.mjs`가 `data/campuses/<id>`에서 묶어 `assets/campus.generated.json`으로 만든다.
  이 파일은 **커밋하지 않는다**. 데이터 자체(`data/`)도 이 앱에서 고치지 않는다.
- `app.json`의 Android 패키지명 `kr.hanyang.campo`, 권한 목록, `eas.json`의 프로필(development APK / preview APK / production AAB)은 팀이 합의한 값이다. 바꾸려면 6장을 읽고 먼저 묻는다.
- 화면 문구는 한국어 존댓말, 코드 식별자·커밋 메시지는 영어. 기능 하나 = 브랜치 하나 = PR 하나.

## 명령어 (`apps/app` 포함)

- `npm install` — 루트에서 처음 한 번(Node 22 이상, `.nvmrc`)
- `npm run app` — 최종 사용자 앱 실행(캠퍼스 번들 자동)
- `npm run mobile` — 현장 조사 앱 실행
- `npm run editor` — 편집기 실행
- `npm test` — 전체 테스트(Vitest, 루트)
- `npm run typecheck` — 워크스페이스 전체 타입 검사(앱은 캠퍼스 번들 후 `tsc`)
- `cd apps/app && npx eas build --profile preview --platform android` — 설치용 APK

## 완료 보고 (이 앱)

루트 `npm test`와 `npm run typecheck` 결과(테스트 수·실패 수), `git log --oneline`·`git diff --stat`을 붙인다.
계약(`src/contracts.ts`)이나 코어에 손댄 것이 있으면 따로 적는다.
