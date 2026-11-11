# 편집기 조사 (주제 A)

조사일 2026-11-11. 코드는 고치지 않았다. 확인용 스크립트는 임시 폴더에서만 돌렸다.

## 1. 한 줄 결론

- **검사 실시간화**: iD는 편집을 확정할 때마다 "바뀐 항목 + 같은 문제에 묶인 항목 + 이어진 길"만 다시 검사하고, 결과를 항목별 캐시에 넣는다. 끌기(`change`) 중에는 돌리지 않는다. 캠포도 이 구조(규칙 = `(항목, 상태) => 문제[]`, 문제 id는 결정적, 항목별 캐시)를 가져오면 된다.
- **splitEdgeAt**: iD는 "길 나누기(actionSplit)"와 "길에 지점 끼우기(actionAddMidpoint)"가 따로 있고, 새 id는 전역 카운터에서 받는다. 캠포 SPEC 4.1에는 (a) 끌던 기존 지점을 그 자리에 끼우는 경우, (b) `step_count` 나누기, (c) 결정적 id, (d) 어느 쪽이 원래 id를 갖는지가 빠져 있다.
- **Rapid**: 편집 이력과 검사 실행의 기본 구조는 iD와 같다. 차이는 이력이 `base / stable / staging` 세 단계이고, 검사가 `stable` 확정에 걸린다는 점이다. 검사도 워커가 아니라 메인 스레드의 유휴 시간에서 돈다.
- **MapLibre**: 설치된 6.17.0에 `GeoJSONSource.updateData`가 **있다**. 모든 Feature에 고유 id가 있으면 쓸 수 있다. 현재 편집기는 이미 `id: f.id`(문자열)를 넣고 있어 조건을 만족한다. 다만 성능이 실제로 나아지는지는 이 환경에서 재 보지 못했다(추정).

## 2. 이미 조사된 사실의 재확인 (research-architecture.md 1장)

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| ngraph `oriented` 기본값 없음 | **확인됨**. 실행: A→B 링크만 두고 `find('B','A')`가 `['A','B']`(경로 있음). `oriented:true`면 `[]` | `node_modules/ngraph.path/a-star/a-star.js:37` + 직접 실행 |
| 비 multigraph는 같은 두 지점 링크가 하나로 | **확인됨**. 링크 2번 추가 → `getLinksCount()` 1. `multigraph:true`면 2 | `ngraph.graph/index.js:42,55` + 직접 실행 |
| 결과 순서 도착→출발 | **확인됨**. `['C','B','A']` | 직접 실행 |
| 막힌 구간 너머 도착점이 `['C']`로 나옴 | **확인됨**. 그래프 A→B→C에서 `blocked`로 C로 가는 링크를 막아도 `['C']` | 직접 실행 |
| `distance`/`blocked` 인자 순서(다음 지점, 현재 지점, 링크) | **확인됨**. 호출 기록 `[B,A,링크A→B]`, `[C,B,링크B→C]` | `a-star.js:116,121` + 직접 실행 |
| Terra Draw select `flags`, `snappable`, `toCustom` | **확인됨**(1.39.0). `feature.coordinates.{snappable, midpoints, draggable, resizable, deletable}`, `toCustom(event, context) => Position \| undefined` | `terra-draw/dist/modes/select/select.mode.d.ts:15-26`, `common.d.ts:116-140` |
| Terra Draw 이벤트 | **확인됨**. `ready, finish, change, select, deselect, history` | `terra-draw.d.ts:40-46` |
| Terra Draw 자체 되돌리기 | **확인됨, 보충**. 옵션 이름이 `undoRedo: { modeLevel?, sessionLevel?, keyboardShortcuts? }`이고 전부 선택이다. 압축된 소스에서 `sessionUndoRedoEnabled`는 `false`로 시작하고 `undoRedo.sessionLevel`이 있을 때만 켜진다. 그래서 **아무것도 안 넘기면 꺼져 있다**(소스 읽기. 실행은 안 함) | `terra-draw.d.ts:71-82`, `terra-draw.cjs` |
| Turf 7.4.0 단위·속성 | **확인됨**. 단위 기본값 `kilometers`, 새 속성 `segmentIndex/totalDistance/lineDistance/segmentDistance/pointDistance`, 옛 `index/location/dist`는 `@deprecated` | `@turf/nearest-point-on-line/dist/esm/index.d.ts:14-18,27,47-61` |
| Immer `enablePatches` | **확인됨**(11.2.10). `enablePatches()`, `enableMapSet()` 따로 있음. **새로 보임**: `enableArrayMethods`도 export됨(용도는 이 조사에서 안 읽음) | `immer/dist/immer.d.ts:219-221,338` |
| iD 동작·끌기·이력, OTP, Valhalla | 이 조사에서는 다시 열지 않음(지시대로) | |

버전: maplibre-gl 6.17.0, terra-draw 1.39.0, @turf/helpers 7.4.0, immer 11.2.10, ngraph.graph 20.1.2, ngraph.path 1.6.1. 설치본과 research-architecture.md가 적은 버전이 같다.

## 3. 질문 1. iD 검사(validations) 실행과 표시

기준: iD `develop` 커밋 `ecd922e1fa9f6f4ccb4bcb3eaf50fa73f10cd526` (2026-11-11 시점). 라이선스 ISC. 아래 줄 번호는 이 시점의 파일 기준이다.

URL 기본: `https://github.com/openstreetmap/iD/blob/develop/` 뒤에 파일 경로.

### 3.1 언제, 무엇을 돌리나

| 사실 | 근거 (파일:줄) | 확인 방법 |
|---|---|---|
| 규칙은 `(항목, 그래프) => 문제[]` 함수다. 항목 하나에 모든 규칙을 돌린다 | `modules/core/validator.js:601-620`, `modules/core/validation/models.ts`(`Validator` 인터페이스) | 소스 |
| 규칙 목록은 `modules/validations/index.ts`에서 내보낸 함수를 전부 모아 등록한다 | `validator.js:80-86`, `validations/index.ts:1-17` | 소스 |
| 캐시가 둘이다. `base`(편집 전), `head`(편집 후). 사용자가 고친 것/망친 것을 가리기 위해서다 | `validator.js:20-21,659-689` | 소스 |
| **전체가 아니라 바뀐 부분만** 돌린다. 직전에 검사한 그래프(`_headCache.graph`)와 지금 그래프의 차이(`coreDifference`)에서 바뀐 항목 id를 얻는다 | `validator.js:477-496` | 소스 |
| 바뀐 항목에 더해 (1) 같은 문제에 엮인 항목(`withAllRelatedEntities`), (2) 바뀐 항목의 지점에 이어진 길(이전·현재 그래프 둘 다), (3) 관계 멤버 변화로 영향받는 항목을 다시 돌린다 | `validator.js:496-528`, `validator.js:934-` (`withAllRelatedEntities`) | 소스 |
| 다시 돌릴 항목은 100개씩 묶어 `requestIdleCallback`으로 처리한다. 한 번에 다 하지 않고 브라우저가 한가할 때 돈다 | `validator.js:734-737,782-803` | 소스 |
| 검사 중에 그래프가 또 바뀌면, 진행 중인 Promise를 그대로 돌려주고 끝난 뒤 다시 따라잡는다 | `validator.js:486-489,534-538` | 소스 |
| 규칙은 `context.graph()`가 아니라 **검사 시작 때 찍어 둔 스냅샷**을 받는다(비동기라 그래프가 바뀔 수 있어서) | `validator.js:581-587` 주석 | 소스 |
| 검사를 거는 시점: `undone`, `redone`, `restore`, `reset`, 그리고 **편집 모드를 떠날 때**(`exit`). `change`(그리는 중, 끄는 중)에는 걸지 않는다 | `validator.js:546-561` | 소스 |
| 결과가 아직 확정이 아니면(`provisional`) 5초 뒤 그 항목만 다시 돌린다 | `validator.js:29,616-618,759-769` | 소스 |
| `disconnected_way`는 항목마다 이어진 길을 너비 우선으로 끝까지 따라가 "섬"을 찾는다. 섬 전체가 문제 하나의 `entityIds`가 된다 | `modules/validations/disconnected_way.ts:95-150` | 소스 |

### 3.2 문제(issue) 모델과 캐시

| 사실 | 근거 | 확인 방법 |
|---|---|---|
| 문제 필드: `type`, `subtype`, `severity`(error/warning/suggestion), `message()`, `entityIds`, `loc`, `data`, `dynamicFixes()`, `hash` | `modules/core/validation/models.ts`(`validationIssue`) | 소스 |
| **문제 id는 결정적**이다: `type[:hash][:subtype]:정렬한 entityIds`. 같은 문제는 같은 id. 목록 갱신용 `key`는 id에 생성 시각을 붙인다 | `models.ts`(`generateID`, `generateKey`) | 소스 |
| 캐시는 `issuesByIssueID`와 `issuesByEntityID`(항목 id → 문제 id 집합) 두 개. 항목을 다시 돌릴 때 그 항목의 옛 문제를 먼저 지우고 새로 넣는다 | `validator.js:819-` (`validationCache`), `validator.js:710-711,728` | 소스 |
| 조회 옵션: `what: 'all' \| 'edited'`(내가 건드린 것만), `where: 'all' \| 'visible'`(화면 안만), `includeIgnored`. 무시한 문제와 "해결한" 문제는 별도 집합 | `validator.js:140-` (`getIssues`) | 소스 |
| 수정 제안(`fixes`)을 문제가 갖는다. 오류가 아니면 "무시" 수정이 자동으로 붙는다. 수정마다 `disabledReason`(못 하는 이유)이 있다 | `models.ts`(`fixes`, `validationIssueFix`) | 소스 |
| 규칙별 켜기/끄기는 저장소(prefs)에 저장하고, 바꾸면 바로 다시 검사. URL 해시로 심각도를 덮어쓸 수 있다 | `validator.js:32-74,423-448` | 소스 |

### 3.3 화면에 보이는 방식

| 사실 | 근거 | 확인 방법 |
|---|---|---|
| 오류 목록과 경고 목록이 별도 구역이다. 구역은 `validated` 이벤트를 받으면 `requestIdleCallback` 안에서 문제를 다시 읽고 다시 그린다 | `modules/ui/sections/validation_issues.js:134-139` | 소스 |
| 기본 조회는 `what: 'edited'`(내가 건드린 것만), `where: 'all'`. 설정에서 바꿀 수 있다 | `validation_issues.js:30-35` | 소스 |
| 목록 항목을 누르면 그 문제로 이동(`focusIssue`), 마우스를 올리면 관련 항목을 강조(`utilHighlightEntities`) | `validation_issues.js:94-105` | 소스 |
| 화면 아래 "정보 상자"는 제안(suggestion)을 뺀 문제 수만 센다 | `modules/ui/issues_info.js:29-32` | 소스 |
| 지도를 움직이면 `where:'visible'`일 때만 문제를 다시 읽고, 정렬(지도 중심에서 가까운 순)만 다시 한다 | `validation_issues.js:141-` | 소스 |
| 항목 하나를 고를 때 속성 창에도 그 항목의 문제가 나온다 | `modules/ui/sections/entity_issues.js`(파일 존재만 확인. 내용은 안 읽음) | 파일 목록 |

지도 위 아이콘 표시 방식(`svg` 쪽)은 이 조사에서 확인하지 못했다. 관련 문자열 검색에서 `vertices.js`/`lines.js`에는 의미 있는 검사 참조가 안 잡혔다(추정: 지도에는 선택/강조만 하고 별도 오류 아이콘 레이어는 없거나 다른 파일에 있음).

### 3.4 캠포에 가져올 구조 (제안)

- 항목 = 지점/구간/건물. 규칙 = `(item, state) => Issue[]`. `Issue = { code(E9, W5 …), subtype, severity, entityIds, loc, message, fixes? }`. id = `code:subtype:정렬한 entityIds` (iD와 같음).
- 캐시 `issuesByEntityID`를 둔다. 동작이 확정되면 "바뀐 id"를 얻는다. Immer 패치의 경로(`nodes/<id>`, `edges/<id>`)에서 바로 얻을 수 있다(추정: 패치 경로 형식은 설계 측 확인 필요). 여기에 (1) 바뀐 지점에 이어진 구간(이전·현재 상태 둘 다), (2) 같은 `elevator_id` 묶음, (3) 캐시에서 같은 문제에 엮인 항목을 더해 다시 검사한다.
- **끌기 중에는 검사하지 않는다.** 끌기 놓을 때(설명 있는 `replace`)와 `undo/redo` 때만 돈다. iD도 `change`에는 안 걸고 모드를 떠날 때 건다.
- 연결 검사(E10, E11, W8, W9)처럼 "이어진 묶음 전체"를 봐야 하는 규칙은 iD `disconnected_way`처럼 문제 하나에 묶음 전체의 id를 넣는다. 그래야 묶음 안 어느 항목이 바뀌어도 다시 돈다.
- 한 층이 수백 개 수준이면 동기 실행으로 시작해도 될 것이다(추정. 측정 안 함). 느려지면 iD처럼 100개씩 `requestIdleCallback`으로 나누고, 진행 중에 상태가 바뀌면 끝난 뒤 따라잡는 방식을 쓴다.
- 표시: 오류/경고 두 목록, 항목에 마우스를 올리면 관련 지점·구간 강조, 클릭하면 이동. "내가 건드린 것만 / 전체" 전환은 제보 반영 화면에서 쓸 만하다.
- I1~I6은 구조 불변식이므로 실시간 검사가 아니라 속성 테스트와 저장 직전 `validateCampus`에서 돌린다(iD `validations`에는 해당 개념이 없음. 설계 판단).

## 4. 질문 2. iD split.ts / add_midpoint.ts

URL: `https://github.com/openstreetmap/iD/blob/develop/modules/actions/split.ts`, `.../add_midpoint.ts`. 커밋 `ecd922e1…`. 라이선스 ISC.

### 4.1 사실

| 사실 | 근거 | 확인 방법 |
|---|---|---|
| iD에서 길 나누기(`actionSplit`)는 **이미 있는 지점**에서만 나눈다. 새 지점을 만드는 일은 하지 않는다 | `split.ts:34` (인자가 `nodeIds`) | 소스 |
| 끝점에서는 못 나눈다(닫힌 길 제외). 안쪽 지점이어야 `isSplittable` | `split.ts:141-157` | 소스 |
| 나눠진 한쪽 길은 `new osmWay({ id: newWayId, tags: wayA.tags })`로 **속성을 그대로 복사**해서 만든다 | `split.ts:112` | 소스 |
| 새 id를 인자로 줄 수 있다(`newWayIds`). 주석: "테스트 편의용. 보통은 undefined라 자동 배정" | `split.ts:27-34,108` | 소스 |
| 자동 배정은 **전역 카운터**다. `osmIdManager.next`가 -1에서 시작해 내려간다. 즉 실행 순서에 따라 id가 달라진다 | `modules/osm/id_manager.ts`(`next`, `newId`) | 소스 |
| **어느 쪽이 원래 id를 갖나**: 기본 `keepHistoryOn = 'longest'`. 더 긴 쪽(지점 사이 거리 합)이 원래 id를 가진다. 뒤쪽이 더 길면 원래 길이 뒤쪽 지점들을 갖는다 | `split.ts:40,137-152` | 소스 |
| **합산 속성**은 길이 비율로 쪼갠다. 대상은 `osmSummableTags` = `step_count`, `parking:{both,left,right}:capacity`. 값이 양의 정수일 때만. `A = round(count × lengthA/(lengthA+lengthB))`, `B = count − A` | `split.ts:154-177`, `modules/osm/tags.ts:428-433` | 소스 |
| 나눈 결과 한쪽이라도 지점이 2개 미만이면 아무것도 안 한다 | `split.ts:135` | 소스 |
| 못 나누면 `disabled()`가 이유 코드(`not_eligible`, `parent_incomplete`, `simple_roundabout`)를 돌려준다 | `split.ts:166-203` | 소스 |
| 관계(relation) 멤버 정리 코드가 대부분이다(split.ts 약 절반). 캠포에는 해당 없음 | `split.ts:182-234,272-` | 소스 |
| `actionAddMidpoint`는 **지점 하나를 길 위 좌표로 옮기고 그 길의 지점 목록에 끼워 넣는다**. 새 지점을 만들지 않고 인자로 받은 지점을 쓴다. 두 끝 지점의 공통 부모 길을 모두 찾아 각각 한 번씩 넣는다 | `add_midpoint.ts:9-31` | 소스 |
| 끌기에서 쓰임: (1) 구간 가운데 손잡이를 끌기 시작할 때 `new osmNode()`를 만들어 끼움, (2) 놓을 때 길 위면 **끌던 그 지점**을 끼움(설명 있는 `replace`), (3) 놓을 수 있는지 미리 확인하려고 임시 그래프에 끼워 봄 | `modes/drag_node.js:144-149,270-292,386-395` | 소스 |
| 조작(operation) 쪽: `operationSplit`이 `actionSplit(선택한 지점들)`을 `context.perform(action, annotation)`으로 실행하고, 쪼개진 길을 선택 상태로 만든다 | `modules/operations/split.ts:23,44-46,134` | 소스 |

### 4.2 캠포 `splitEdgeAt`에 적용할 점

1. **두 동작을 구분하거나, 한 동작에 "기존 지점 쓰기" 옵션을 둔다.** SPEC 4.1은 `splitEdgeAt(edgeId, coord)`가 항상 "새 지점을 만든다"고 한다. 그런데 SPEC 5.1의 "구간 위에 놓으면 그 구간을 나누고 그 자리에 잇는다"는 iD의 `actionAddMidpoint`(끌던 지점을 그대로 끼움)에 해당한다. 새 지점을 만든 뒤 `mergeNodes`로 합치면 동작이 둘이 되고, 합치기 거부 규칙(범위가 다름, 중요 종류 둘)에 걸릴 수 있다. → `splitEdgeAt(edgeId, coord, { nodeId? })`가 필요하다. 이건 SPEC에 없다(아래 5장).
2. **id는 호출자가 주거나 결정적으로 만든다.** iD도 테스트에서는 `newWayIds`를 직접 넣는다. 전역 카운터는 되돌리기·다시 하기·Immer 패치 재생·changeset 적용에서 같은 결과를 보장하지 못한다. 캠포는 새 지점 id와 새 구간 id를 인자 또는 상태 안의 카운터로 정해야 한다(설계 판단).
3. **속성은 전부 복사한다.** 캠포 구간 속성은 `highway, edge_type, bidirectional, step_free, needs_check, source, covered, hours, level_from/to, building_from/to, step_count`(`data/schema/campo.schema.json:188-212`). 두 구간 모두 같은 값을 갖는다. 방향(`from→to`)은 유지해서 앞쪽은 `from→새 지점`, 뒤쪽은 `새 지점→to`로 한다. 그래야 방향 있는 구간(R2, R14)이 뒤집히지 않는다.
4. **`step_count`는 쪼갠다.** 스키마에 이미 `step_count`(정수, 최소 1)가 있어서 iD의 합산 속성과 같은 문제다. iD 방식(길이 비율, 반올림, 나머지)을 그대로 쓰면 한쪽이 0이 될 수 있는데, 캠포 스키마는 최소 1이다. → 한쪽이 0이면 그쪽은 속성을 빼거나 1로 올리는 규칙을 정해야 한다. **사람이 정할 것**(제안: `count ≥ 2`면 각 쪽 최소 1을 보장, `count = 1`이면 긴 쪽에만 둠).
5. **원래 id를 어느 쪽이 갖나**: iD는 긴 쪽. 캠포에서는 `rev`와 changeset의 `base_revs`가 id 기준이라 규칙이 단순해야 한다. 제안: 앞쪽(`from→새 지점`)이 원래 id를 갖고 `rev`가 1 늘며, 뒤쪽은 새 id에 `rev` 1. iD처럼 "긴 쪽"으로 하면 같은 입력도 좌표에 따라 id가 뒤바뀌어 이력 비교가 어려워진다(추정. 결정 필요).
6. **나누면 안 되는 구간**: iD가 끝점·부모 불완전 등을 `disabled` 이유로 돌려주듯, 캠포도 `disabled(state)`에 이유를 넣는다. 후보: 좌표가 구간 끝 지점과 1.0m 안이면 새 지점을 만들지 말고 그 끝 지점을 쓴다(SPEC 이미 있음). `highway=elevator` 구간과 `edge_type=bridge` 구간(`level_from/level_to`, `building_from/to` 필요)은 나누면 층·건물 의미가 깨질 수 있다(추정. 스키마에서 `bridge`는 두 건물·두 층을 필수로 요구함). 이런 구간의 나누기 허용 여부는 **사람이 정할 것**.
7. **끝 좌표 참조 구조에서는 단순해진다.** 구간이 `from/to`와 중간 꺾임점만 가지므로, 나눌 때 꺾임점을 좌표 위치 기준으로 앞/뒤에 배분하고, 분할 지점이 꺾임점 1.0m 안이면 그 꺾임점을 지점으로 승격한다(SPEC 4.1의 "기존 꼭짓점" 규칙과 같다).
8. **평행 구간(R3)**: iD의 `actionAddMidpoint`는 두 지점의 공통 부모 길 모두에 끼워 넣는다. 캠포는 `edgeId` 하나를 나눈다. 같은 두 지점 사이에 계단+경사로가 평행하면 하나만 나뉜다. 의도적이면 문서에 적어 두고, 아니면 "같은 두 지점의 평행 구간은 함께 나눌지" 결정해야 한다(사람이 정할 것).

## 5. 질문 3. facebook/Rapid와 iD의 차이

저장소 이름이 바뀌었다. `facebook/Rapid`는 `meta/Rapid`(저장소 id 161120445)로 이동한다(GitHub API가 `Moved Permanently`로 응답). 기본 브랜치 `main`, 커밋 `249abff91e6982c6cc99c3e8bae4718a02913fa3`, 마지막 푸시 2026-05-28, 보관(archived) 아님. 라이선스 ISC (GitHub API `spdx_id`). 근거: `https://api.github.com/repositories/161120445`.

| 항목 | iD | Rapid | 근거 |
|---|---|---|---|
| 모듈 구성 | `coreContext` 안에 `history`, `validator` 등 | `AbstractSystem`을 상속한 `EditSystem`, `ValidationSystem`, `MapSystem` 등 "시스템" 단위. `initAsync/startAsync/resetAsync` 생명주기 | `meta/Rapid modules/core/*System.js` (파일 목록), `ValidationSystem.js:36-165` |
| 편집 이력 | `coreHistory`. 스택에 그래프와 설명. `perform/replace/overwrite`, `undo/redo`, 설명 있는 항목까지 건너뜀 | `EditSystem`. 이력은 **`base` → `stable` → `staging`** 세 이름이 있다. `perform`은 `staging`에서 작업하고, `commit`이 `staging`을 이력에 확정, `commitAppend`는 `stable`을 바꿔치기(`replace`와 비슷), `revert`는 `staging`을 `stable`로 되돌림 | `EditSystem.js:20-70,296-310,403-475` |
| 이벤트 | 이력 `change` 등 | `stagingchange`(작업 중), **`stablechange`(확정 이력이 바뀔 때만)**, `historyjump`, `merge`, `backupstatuschange` | `EditSystem.js:68-73,1330-1355` |
| 거래(transaction) | 없음 | `beginTransaction/endTransaction`: 여러 동작 동안 이벤트를 막았다가 끝에 한 번에 낸다 | `EditSystem.js:61-65,669-690` |
| 부드러운 전환 | 동작이 단순 함수 | 동작이 `transitionable`이면 150ms 동안 시간 인자 t(0..1)로 여러 번 실행해 애니메이션(`performAsync`) | `EditSystem.js:315-360` |
| 검사를 거는 시점 | 이력 `undone/redone/restore/reset`과 모드 종료 | **`stablechange`마다**(`editor.on('stablechange', …)`). 작업 중(`staging`)에는 안 돎. 개념은 iD의 "그리는 중엔 안 돎"과 같고, 모드 종료 대신 이력 확정 이벤트에 건다 | `ValidationSystem.js:118-122,522-` |
| 검사 범위 | 바뀐 항목 + 관련 항목 + 이어진 길 | 바뀐 항목 + `withAllRelatedEntities`. 두 시스템 모두 캐시를 `base`/`head` 둘로 나눈다. 이어진 길 확장(iD 8758 이슈)이 Rapid의 해당 구간에서는 안 보임(추정: 읽은 부분 `validateAsync`에는 없음. 다른 곳에 있는지는 전부 확인 못 함) | `ValidationSystem.js:550-556` |
| 실행 방식 | `requestIdleCallback` 100개씩 | 같다. 파일 머리말에 "워커에서 하면 더 좋겠지만 워커는 Graph/Edits에 쉽게 접근 못 한다"고 적혀 있다 | `ValidationSystem.js:13-24,742-` |
| `ValidationSystem`의 심각도 덮어쓰기 | error/warning/suggestion/disable | error/warning/disable (`suggestion` 덮어쓰기는 안 보임) | `ValidationSystem.js:107-110` |
| 규칙 목록 | iD 17개 | 비슷하지만 `ambiguous_crossing_tags`, `curb_nodes`, `duplicate_way_segments`, `y_shaped_connection` 추가, `short_road`는 주석 처리, `mutually_exclusive_tags`, `osm_api_limits`는 없음 | `meta/Rapid modules/validations/index.js` |
| 길 나누기 | `osmSummableTags`(여러 키) 쪼갬. 닫힌 길 파트너 지점 인자 지원 | **`step_count`만** 쪼갬(`split.js:139-157`). 나머지 구조는 같고 `osmWay` 새 id는 `newWayIDs`로 줄 수 있음 | `meta/Rapid modules/actions/split.js` |
| `add_midpoint` | 지점을 옮겨 끼움 | **동일**(`@rapid-sdk/math`의 `geomEdgeEqual`만 다름) | `add_midpoint.js` |
| 저장/복구 | `history.toJSON` | `EditSystem.toJSON/fromJSONAsync`, 백업·복구(`saveBackup`, `restoreBackup`)를 시스템이 담당 | `EditSystem.js:898-1260` |

**캠포에 의미 있는 차이 3가지**
1. `staging`/`stable` 분리는 우리 SPEC의 "끌기 = perform(noop) → replace → 설명 있는 replace"를 **상태 두 개로 풀어 쓴 것**과 같은 목적이다. 검사를 `stable`에만 거는 방식이 더 명시적이다. 캠포도 "작업 중 상태"(끄는 동안 임시 값)와 "확정 이력"을 나누고, 검사·자동 저장은 확정 이력 변경에만 걸면 된다.
2. 거래(`begin/endTransaction`)는 매크로 하나가 동작 50개를 만들 때 이벤트·검사·화면 갱신을 마지막에 한 번만 내는 방법이다. SPEC 4장의 "매크로 하나 = 이력 항목 하나"에 이미 맞고, 이벤트 억제까지 같이 있으면 더 낫다(설계 제안).
3. `transitionable` 동작(애니메이션)은 캠포에 필요 없다. 가져오지 않는다.

Rapid 전용 기능(AI 도로 제안 수락 `rapid_accept_feature`, 지도 3D, 사진 시스템 등)은 캠포와 무관하다.

## 6. 질문 4. MapLibre `GeoJSONSource.updateData`

설치본: `node_modules/maplibre-gl` 6.17.0, BSD-3-Clause. 소스와 타입 정의를 읽었다. 렌더링 실행(WebGL)은 하지 않았다.

| 사실 | 근거 | 확인 방법 |
|---|---|---|
| `updateData(diff): Promise<void>`가 있다 | `dist/maplibre-gl.d.ts:6982`, `src/source/geojson_source.ts:319-327` | 타입 정의 + 소스 |
| diff 형식: `{ removeAll?, remove?: id[], add?: Feature[], update?: [{ id, newGeometry?, removeAllProperties?, removeProperties?: string[], addOrUpdateProperties?: [{key, value}] }] }`. 처리 순서는 remove → add → update | `dist/maplibre-gl.d.ts:6750-6790`, `src/source/geojson_source_diff.ts`(`applySourceDiff`) | 타입 정의 + 소스 |
| id는 `number \| string` | `d.ts:6745` | 타입 정의 |
| **조건**: 모든 Feature에 고유 id가 있어야 한다. id는 Feature의 `id`이거나, `promoteId`로 지정한 **속성 이름**(문자열)이다. 중복이 있거나 id가 없으면 `updateData`를 처음 부를 때 `GeoJSONSource "…": GeoJSON data is not compatible with updateData` 오류가 난다 | `geojson_source.ts:590-596`, `geojson_source_diff.ts`(`toUpdateable`) | 소스 |
| `promoteId`가 표현식(객체)이면 업데이트에는 안 쓰인다. 문자열일 때만 쓴다(`_promoteIdKey`) | `geojson_source.ts:260-263` | 소스 |
| 없는 id에 `update`/`remove`를 해도 오류 없이 무시한다("best-effort"). `add`로 이미 있는 id를 넣으면 통째로 교체 | `geojson_source_diff.ts`(`applySourceDiff`), `d.ts:6976-6980` | 소스 |
| `data`가 URL 문자열인 소스에는 적용되지 않는다(`_data.url`이면 `undefined` 반환) | `geojson_source.ts:592-598` | 소스 |
| **부분 갱신**: 바뀐 Feature의 이전·새 도형 범위를 모아 그 범위와 겹치는 타일만 다시 만든다. 클러스터링을 켠 소스는 전부 다시 만든다 | `geojson_source.ts:575-630`(`_applyDiffToSource`, `shouldReloadTile`) | 소스 |
| 연달아 부르면 대기 중인 diff와 합친다(`mergeSourceDiffs`). 비동기이며 워커로 보내진다 | `geojson_source.ts:319-327`, `geojson_source_diff.ts:205-236` | 소스 |
| 워커는 `@maplibre/geojson-vt`(^6.3.0)의 `updateData`로 인덱스를 갱신한다 | `geojson_worker_source.ts:273-276`, `maplibre-gl/package.json` | 소스 |
| 현재 편집기는 `addSource(..., { type:'geojson', data })`로 만들고 상태가 바뀔 때마다 `setData`(전체 교체)로 그린다. Feature에는 이미 `id: f.id`(문자열)가 들어 있고 `doc.features`가 Map이라 id는 고유하다 | `packages/editor/src/map/MapView.tsx:114,173`, `map/layers.ts:16-31` | 소스(캠포) |

### 6.1 지점 끌기 성능에 쓸 수 있나

- **쓸 수 있다(조건 충족).** 현재 Feature id가 고유한 문자열이므로 코드 변경 없이 `updateData({ update: [{ id, newGeometry }] })`로 지점 하나와 이어진 구간 몇 개만 갱신할 수 있다.
- 이득이 얼마인지는 **재 보지 못했다**. 소스로 확인한 것은 "전체 `setData` 대신 영향받은 Feature만 바꾸고 영향받은 타일만 다시 만든다"는 구조뿐이다. 층당 Feature가 수백 개 수준이면 `setData`도 충분히 빠를 수 있다(추정). 실제 선택은 측정 후에 하는 것이 맞다.
- SPEC 5.1의 "끄는 동안 작은 임시 소스(끄는 지점과 이어진 구간만)를 rAF마다 갱신"은 `setData`로 작은 소스를 쓰는 방식이라 이것과 별개이고, 이미 충분히 가벼울 가능성이 크다. 다만 임시 소스를 쓰면 **원래 Feature를 지도에서 숨기는 일**(필터 또는 투명)이 따로 필요하다. `updateData`를 쓰면 숨길 필요 없이 원본 소스 하나만 갱신한다.
- 주의(추정): `updateData`는 `Promise`를 돌려주며 워커를 거친다. 매 프레임 호출하면 diff가 합쳐져 대기하는데(위 표), 화면 반영은 워커 왕복만큼 늦다. 끌기 중 지연이 눈에 띄는지 측정이 필요하다.
- 주의: 순서. 현재 코드는 `emphasis` 순으로 정렬해서 강한 Feature가 위에 그려지게 한다(`layers.ts:36`). `updateData`의 내부 저장은 `Map`이라, 이미 있는 id를 갱신하면 원래 순서를 유지한다. 범위(scope)가 바뀌어 `emphasis`가 바뀌면 전체 `setData`로 다시 정렬해야 한다. 끌기만 `updateData`로 하고 범위 전환은 `setData`로 하는 식으로 나누면 된다(추정).
- 주의: `feature-state`(마우스 올림 강조 등)를 쓰려면 문자열 id는 `promoteId`가 필요할 수 있다. 이 조사에서는 확인하지 않았다.

## 7. SPEC-v0.2.md와 다른 점, 빠진 점

| # | SPEC 위치 | 내용 | 수준 |
|---|---|---|---|
| 1 | 4.1 `splitEdgeAt` | iD `actionAddMidpoint`처럼 **기존 지점을 구간에 끼우는 경우**가 빠져 있다. 5.1 끌기에서 필요하다. `splitEdgeAt(edgeId, coord, { nodeId? })` 형태가 필요 | SPEC 보완 필요 |
| 2 | 4.1 `splitEdgeAt` | `step_count` 처리가 없다. 스키마에 이미 있고(`minimum: 1`), iD는 이 속성을 길이 비율로 쪼갠다. 0이 되는 경우 규칙이 필요 | SPEC 빠짐 |
| 3 | 4.1 `splitEdgeAt` | 새 지점·구간 id를 어떻게 만드는지 없다. iD는 전역 카운터이고 이는 patch/changeset 재생과 맞지 않는다 | SPEC 빠짐 |
| 4 | 4.1 `splitEdgeAt` | 나누기 후 어느 쪽이 원래 id와 `rev`를 갖는지, `level_from/to`·`building_from/to`를 가진 구간(`bridge`, `elevator`)을 나눌 수 있는지 없다 | SPEC 빠짐 |
| 5 | 8장 검사 | 검사를 **언제 어떻게** 돌릴지(실시간, 바뀐 부분만, 끌기 중 제외)가 SPEC에 없다. 이 조사의 3.4가 제안 | SPEC 빠짐 |
| 6 | 6장 Turf 주의 | "옛 이름은 다음 주 버전까지만 남는다"는 7.4.0 타입 정의에서 확인되지 않는다. 확인된 것은 `@deprecated` 표시뿐이고 제거 시점 문구는 없다 | 표현 수정 권장(추정: 어딘가에서 옮겨 온 문장) |
| 7 | 5.1 Terra Draw | "자체 되돌리기(`undoRedo` 옵션)를 끈다"는 표현. 설치본 1.39.0에서는 옵션이 `{ modeLevel, sessionLevel, keyboardShortcuts }` 객체이고 안 넘기면 꺼져 있다. 즉 "끄기 설정"이 아니라 **"넘기지 않기"**가 맞다 | 표현 수정 권장 |
| 8 | 5.1 끌기 | `updateData`를 쓰는 대안이 SPEC에 없다(6.1). 임시 소스 방식도 유효하며 반드시 바꿀 필요는 없다 | 선택 사항 |
| 9 | 5.1 | "`Shift`를 누르고 있으면 상자 선택", "`Alt`는 붙이기를 끔"은 이 조사에서 iD 원본을 다시 읽지 않았다(재조사 금지 지시). research-architecture.md의 내용을 따름 | 미확인 |

그 밖에 research-architecture.md 1.1~1.7의 라이브러리 사실(ngraph, Terra Draw 플래그/이벤트, Turf 단위, Immer)은 설치본에서 **그대로**였다. SPEC 3.3과 6장의 해당 표도 맞다.

## 8. 캠포에 적용할 점

가져올 것
1. **검사 구조(iD)**: 규칙 = `(항목, 상태) => 문제[]`, 문제 id는 결정적, `issuesByEntityID` 캐시, 바뀐 항목 + 같은 문제 항목 + 이어진 구간만 다시 검사, 끌기 중에는 안 돌고 확정과 undo/redo 때만 돈다. 화면은 오류/경고 두 목록 + 마우스 올리면 강조 + 클릭하면 이동.
2. **검사 시점(Rapid)**: 검사와 자동 저장은 "확정된 이력 변경"에 건다. 끄는 중인 임시 상태는 제외. 매크로는 이벤트를 모았다가 끝에 한 번만 낸다(`beginTransaction/endTransaction`).
3. **`splitEdgeAt` 보완(iD `split.ts`, `add_midpoint.ts`)**: 기존 지점 끼우기 옵션, 속성 전체 복사 + 방향 유지, `step_count` 비율 분배(스키마 최소 1 보호), 결정적 id, `disabled()`에 이유 코드, 원래 id 규칙 정하기. 위 4.2 참고.
4. **MapLibre `updateData`**: 쓸 수 있는 상태다(id 고유). 끌기 성능은 측정 후 `setData`와 비교해서 고른다. 측정 없이 바꾸지 않는다.

가져오지 말 것
1. iD의 전역 id 카운터(`osmIdManager`). 재생과 changeset에 맞지 않는다.
2. iD `actionSplit`의 관계(relation) 처리 코드, 닫힌 길 분할 코드. 캠포에 없다.
3. Rapid의 `transitionable` 애니메이션 동작, AI 제안, 3D, 사진 시스템.
4. iD `disconnected_way`의 "길 단위 섬 찾기"를 그대로 쓰지 않는다. 캠포는 구간·지점 그래프에서 섬을 찾고, 엘리베이터 가상 지점(`~car:`)이나 `~sink`는 검사에서 제외해야 한다(설계 판단).
5. 워커 기반 검사. Rapid도 못 했고, 규모가 작아 필요 없다.

사람이 정할 것: `step_count` 0 처리, 원래 id를 어느 쪽이 갖나, `bridge`/`elevator` 구간 나누기 허용 여부, 평행 구간 함께 나누기.

## 9. 라이선스와 출처

| 대상 | 라이선스 | 비고 |
|---|---|---|
| openstreetmap/iD | ISC (GitHub API `spdx_id`) | 이 노트에 코드는 붙이지 않고 구조만 적었다 |
| meta/Rapid (구 facebook/Rapid) | ISC (GitHub API `spdx_id`) | |
| maplibre-gl 6.17.0 | BSD-3-Clause (`package.json`) | |
| terra-draw 1.39.0 | MIT | |
| ngraph.graph / ngraph.path | MIT (`ngraph.path/package.json`) | |
| iD 코드는 ISC라 복사해서 쓸 수는 있으나, 이 조사에서는 구조만 참고하고 새로 쓰는 것을 권장 | | |

출처
- iD: `modules/core/validator.js`, `modules/core/validation/models.ts`, `modules/validations/index.ts`, `modules/validations/disconnected_way.ts`, `modules/ui/sections/validation_issues.js`, `modules/ui/issues_info.js`, `modules/actions/split.ts`, `modules/actions/add_midpoint.ts`, `modules/modes/drag_node.js`, `modules/operations/split.ts`, `modules/osm/id_manager.ts`, `modules/osm/tags.ts`. 모두 `https://github.com/openstreetmap/iD/blob/develop/<경로>` (커밋 `ecd922e1fa9f6f4ccb4bcb3eaf50fa73f10cd526`).
- Rapid: `https://github.com/meta/Rapid/blob/main/modules/core/EditSystem.js`, `.../core/ValidationSystem.js`, `.../actions/split.js`, `.../actions/add_midpoint.js`, `.../validations/index.js` (커밋 `249abff91e6982c6cc99c3e8bae4718a02913fa3`).
- 설치된 패키지: `node_modules/maplibre-gl/{dist/maplibre-gl.d.ts, src/source/geojson_source.ts, geojson_source_diff.ts, geojson_worker_source.ts}`, `node_modules/terra-draw/dist/*.d.ts`, `node_modules/@turf/nearest-point-on-line/dist/esm/index.d.ts`, `node_modules/immer/dist/immer.d.ts`, `node_modules/ngraph.{graph,path}`.
- 줄 번호는 조사 시점에 내려받은 파일 기준이다. `develop`/`main`은 계속 움직이므로 커밋 해시로 고정해서 볼 것.
