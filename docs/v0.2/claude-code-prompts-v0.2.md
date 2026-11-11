# v0.2 Claude Code 실행 프롬프트 세트

## 사용법

- 저장소 루트에서 `claude`를 실행하고, 아래 프롬프트를 **번호 순서대로 하나씩** 붙여 넣는다.
- 한 프롬프트가 끝나고 결과를 확인한 뒤에 다음으로 간다. 프롬프트 사이에는 `/clear`로 대화를 비운다. 각 단계가 필요한 내용은 파일로 남기기 때문에 대화 기억이 필요 없다.
- 표시가 붙은 단계는 계획을 먼저 본다.
  - **[계획]**: `Shift+Tab`으로 plan 모드에서 시작한다. 계획이 SPEC과 맞으면 승인한다.
  - **[병렬]**: 메인 세션이 서브에이전트 여러 개를 동시에 띄운다.

## 서브에이전트 구성

`.claude/agents/`에 다섯 개가 있다. 메인 세션(너와 대화하는 Claude Code)이 지휘하고, 결과를 합치고, 스키마·의존성·문서를 직접 맡는다.

| 에이전트 | 맡는 일 | 쓰는 폴더 | 모델 |
|---|---|---|---|
| `oss-researcher` | 어사이드·웹 조사 | `docs/v0.2/research/` | sonnet |
| `core-routing` | 길찾기 점검·수정 | `packages/core/src/routing`, 테스트 | opus |
| `edit-engine` | 편집 동작, 매크로, changeset, CLI | `packages/core/src/edit`, `reports`, `packages/tools` | opus |
| `editor-ui` | 편집기 화면 | `packages/editor` | sonnet |
| `qa-verifier` | 독립 검증, 코드 수정 안 함 | `docs/v0.2/qa-report.md` | opus |

동시에 돌리는 에이전트는 쓰는 폴더가 겹치지 않게 짰다. 다만 `package.json`과 `package-lock.json`은 모두가 같이 쓰는 파일이다. 그래서 **패키지 설치는 메인 세션만** 하고, 병렬 단계 전에 미리 끝낸다.

```
0 준비 ─ 1 조사[병렬×3] ─ 2 길찾기 점검(테스트 먼저) ─ 3 스키마·마이그레이션
   ─ 4 길찾기 수정 ─ 5 편집 엔진 ─┬─ 6 매크로 (edit-engine)       ─┬─ 8 범위·포탈·화장실·매크로 UI ─ 9 changeset·제보 ─ 10 검증 ─ 11 마무리
                                 └─ 7 선택·끌기·삭제 UI (editor-ui) ─┘
```

---

## 0. 준비

```
v0.2 작업을 시작한다.

1. git 상태가 깨끗한지 확인하고 main에서 v0.2 브랜치를 만들어.
2. 이 저장소에 새로 들어온 파일을 읽어: docs/v0.2/SPEC-v0.2.md, docs/v0.2/research-architecture.md, .claude/agents/*.md.
3. AGENTS.md의 "반드시 지킬 것"에 아래 세 줄을 추가해.
   - 데이터를 바꾸는 코드는 packages/core/src/edit의 동작(action)만 쓴다.
   - 패키지 설치와 package.json 변경은 메인 세션만 한다. 서브에이전트는 하지 않는다.
   - v0.2 작업 중에는 docs/v0.2/SPEC-v0.2.md가 SPEC.md보다 우선한다.
4. 의존성을 미리 설치해. 설치 시점의 최신 안정 버전으로 고정해.
   - packages/core: immer, fast-check(dev), @turf/nearest-point-on-line, @turf/along, @turf/line-slice-along, @turf/length, @turf/helpers, rbush
   - packages/editor: @playwright/test(dev)
   이미 있는 것은 건너뛰어.
5. 아래 명령이 v0.1 상태로 모두 통과하는지 확인해: npm test, npm run typecheck, npm run validate.
6. 어사이드를 쓸 수 있는지 확인해. MCP 도구(aside exec/repl)로 보이면 그걸 쓰고, 아니면 `aside --help`로 CLI 사용법을 확인해서 첫 20줄을 보여 줘.
7. Immer는 패치 기능을 쓰려면 앱 시작 때 enablePatches()를 한 번 불러야 해. packages/core의 진입점에서 부르게 해 두고, 테스트 설정(vitest setup)에서도 불러.

끝나면 1~7 각각의 결과를 표로 보여 줘. 커밋은 "chore: prepare v0.2" 하나로.
```

## 1. 오픈소스 조사 [병렬]

```
oss-researcher 서브에이전트 세 개를 동시에 띄워. 각각의 주제와 결과 파일은 아래와 같아.

docs/v0.2/research-architecture.md 1장에 이미 소스로 확인한 사실이 있어(ngraph 동작 5가지, iD 동작·끌기·이력, Terra Draw flags·이벤트, Turf 7.4 단위·속성, Immer enablePatches, OTP 엘리베이터 구간, Valhalla 벌점).
그건 다시 조사하지 말고, 설치된 버전의 node_modules에서 그대로인지만 확인해. 시간은 아래 남은 질문에 써.

A) 편집기 → docs/v0.2/research/editor.md
   - iD modules/validations: 편집할 때마다 검사를 어떻게 돌리고(전체/바뀐 부분만), 화면에 어떻게 보여 주는지. 캠포 검사 탭을 실시간으로 만들 때 가져올 구조.
   - iD modules/actions/split.ts와 add_midpoint.ts: 길을 나눌 때 속성과 id를 어떻게 처리하는지 (캠포 splitEdgeAt에 적용).
   - facebook/Rapid: iD와 편집 시스템·검사 실행이 무엇이 다른지.
   - 설치된 maplibre-gl 버전의 GeoJSONSource.updateData(부분 갱신) 지원 여부와 사용 조건(feature id, promoteId). 지점 끌기 성능에 쓸 수 있는지.

B) 길찾기 → docs/v0.2/research/routing.md
   - GraphHopper의 foot/wheelchair 프로필에서 계단·엘리베이터·경사 처리.
   - OpenTripPlanner의 WalkStep / ElevatorUse: 이어진 엘리베이터 구간을 안내 문장 하나로 합치는 방법 (SPEC-v0.2 3.6에 적용).
   - ngraph.path의 nba(양방향) 탐색기가 aStar와 같은 "막힌 도착점" 동작을 하는지 직접 실행해서 확인.

C) 반자동 입력과 제보 파이프라인 → docs/v0.2/research/pipeline.md
   - JOSM의 충돌 해결(conflict) 방식과 OSM osmChange 형식에서, rev 충돌 감지·병합에 가져올 만한 것.
   - MapRoulette의 작업 상태(created/fixed/false positive/already fixed 등)와 묶기(bundle) 방식 → 캠포 제보 상태 설계에 적용.
   - 실내 지도에서 문을 복도선에 자동으로 잇는 기능이 있는 도구를 한 번 더 찾아봐. 지난 조사에서는 QGIS "Shortest line between features" 정도만 찾았어. 못 찾으면 "없음"이라고 써.

세 노트가 다 오면 네가 직접 합쳐서:
1. docs/v0.2/research/SUMMARY.md를 써. SPEC-v0.2.md와 다르거나 SPEC이 틀린 점을 표로 정리하고, 각 항목에 "SPEC을 고칠지" 제안을 붙여.
2. SPEC을 고쳐야 할 항목이 있으면 고치지 말고 나에게 먼저 물어봐.
```

## 2. 길찾기 전수 점검: 테스트 먼저 [계획]

```
core-routing 서브에이전트를 써서 v0.1 길찾기를 전수 점검해. 이 단계에서는 코드를 고치지 않는다.

1. packages/core의 routing 코드 전체(buildGraph, findRoute, costs, 안내 문장)를 읽고, docs/v0.2/SPEC-v0.2.md 3.7의 점검표 R1~R15 각각에 대해 지금 코드가 어떻게 동작하는지 판단해.
   특히 SPEC-v0.2 3.3 표의 ngraph 동작 다섯 가지를 지금 코드가 어떻게 다루는지 하나씩 확인해:
   oriented를 넘기는지, multigraph인지, 결과를 뒤집는지, find 결과가 [도착점] 하나일 때 경로 없음으로 처리하는지, 방향별 비용을 link.fromId로 계산하는지.
   v0.1의 "경로 없음" 테스트가 무엇을 검사하는지도 읽어 봐.
2. 각 항목마다 실패를 드러내는 테스트를 packages/core/test/routing/audit.test.ts에 써. 테스트 이름은 "R1: ..." 형식.
   - 지금 코드가 이미 맞으면 통과하는 테스트로 남겨.
   - 지금 틀리면 실패하는 테스트로 남기되 it.fails로 표시해서 전체 테스트가 깨지지 않게 해.
3. 필요한 fixture는 packages/core/test/fixtures/에 추가해. 최소한 7층 건물 엘리베이터, 계단과 경사로가 같은 두 지점을 잇는 경우, 일방 구간, step_free가 비어 있는 실내 복도가 있어야 해.
4. 점검표 밖에서 찾은 결함도 R13부터 번호를 붙여 같이 적어.

결과는 docs/v0.2/audit-routing.md에 표로 써: 번호 | 지금 동작 | 판정(정상/결함) | 근거 파일:줄 | 테스트 이름.
마지막에 npm test 결과를 보여 줘.
```

## 3. 스키마 v0.2와 마이그레이션 (메인 세션) [계획]

```
이 단계는 서브에이전트 없이 네가 직접 해. 스키마는 모든 단계가 의존하기 때문이야.

docs/v0.2/SPEC-v0.2.md 2장대로:
1. data/schema/campo.schema.json과 packages/core 타입을 고쳐: step_free 세 값, elevator_id, restroom node_type과 속성, door의 room_ref/door_role, 선택 사항인 kind: room(Polygon), 모든 Feature의 rev, campus.json의 schema_version.
2. overrides.json 스키마와 타입을 추가해.
3. packages/tools에 migrate CLI(npm run migrate)를 만들어. v0.1 → v0.2 규칙은 SPEC-v0.2 2.1과 2.5(rev: 1)를 따르고, 같은 데이터에 두 번 돌려도 결과가 같아야 해.
4. 기존 fixture를 migrate로 바꾸고, 화장실 2개(남/여, 하나는 wheelchair: yes)와 room_ref가 있는 문을 추가해.
5. validateCampus에 SPEC-v0.2 8장의 E9~E11, W5~W7을 추가하고, 각각 fixture를 망가뜨리는 테스트를 써.
6. data/campuses/hanyang-seoul에 migrate를 돌리고 바뀐 개수를 보여 줘.
7. docs/SPEC.md 4장과 7장에 SPEC-v0.2 2장과 8장 내용을 합쳐.

끝나면 npm test, npm run typecheck, npm run validate 결과를 보여 주고 "feat(schema): v0.2" 로 커밋해.
```

## 4. 길찾기 수정

```
core-routing 서브에이전트를 써서 docs/v0.2/audit-routing.md의 결함을 모두 고쳐.

- SPEC-v0.2 3장대로 비용을 초 단위로 통일하고, 엘리베이터를 board/hop/alight로 펼치고, multigraph·oriented·blocked를 적용해.
- find 결과는 한곳에서만 처리해: 뒤집고, 출발점이 첫 지점이 아니면(= ngraph가 [도착점] 하나만 돌려준 경우) "경로 없음"으로 바꿔. 출발점과 도착점이 같은 경우는 거리 0 경로.
- 방향별 비용(board/alight, 앞으로 넣을 오르막 계단)은 distance 인자 순서가 아니라 link.fromId / link.toId로 계산해.
- step_free로 경로가 없으면 fewest_steps로 다시 찾고, 결과에 피할 수 없는 계단 수를 넣어 (SPEC-v0.2 3.4).
- 결과 타입: nodes(출발→도착 순), cost, timeSec, distanceM, stairsCount, steps[] (kind, fromLevel, toLevel, distanceM, timeSec, text), uncertainSegments[], fallback(없거나 'fewest_steps').
- findNearest(graph, fromId, predicate, profile)를 추가해 (SPEC-v0.2 3.5 가상 도착점 방식).
- overrides를 받는 옵션을 추가해: buildGraph(campus, { overrides, now }).
- audit.test.ts의 it.fails를 모두 it으로 바꾸고 통과시켜.
- R4는 fast-check로 무작위 그래프 200개를 만들어 A* 비용과 다익스트라(휴리스틱 0) 비용이 같은지 확인해.

docs/v0.2/audit-routing.md 표에 "고침" 열을 채우고, npm test 결과를 보여 줘. 커밋은 "fix(routing): v0.2 audit".
```

## 5. 편집 엔진 [계획]

```
edit-engine 서브에이전트를 써서 SPEC-v0.2 4장의 편집 엔진을 packages/core/src/edit에 만들어.

1. EditState는 Map이 아니라 일반 객체 { nodes, edges, buildings }로 만들어. 패치를 JSON으로 저장해야 하기 때문이야.
   편집 상태의 구간은 iD처럼 지점을 참조만 해: from, to, 중간 꺾임점 vertices. 양 끝 좌표는 저장하지 않아.
   Action 타입(apply, annotation, disabled). History는 iD core/history.ts처럼 perform / replace / overwrite / undo / redo로 만들고, undo·redo는 annotation이 있는 항목까지 건너뛰어. 최대 200개.
   Immer의 produceWithPatches를 써서 동작마다 patches/inversePatches를 History에 같이 저장해. enablePatches()는 0단계에서 켜 뒀어.
   iD의 actions/delete_node.ts, connect.ts, move_node.ts, modes/drag_node.js, core/history.ts를 참고해도 돼(ISC 라이선스). 코드를 가져오면 파일 맨 위에 출처 주석을 달아.
2. 4.1의 동작 8개를 모두 만들어. 각 동작에 단위 테스트를 써.
   - 특히 deleteNodes heal, deleteBuilding 연쇄 삭제, 엘리베이터 정차 지점 moveNode 동시 이동, 층이 다른 지점 mergeNodes 거부.
3. 4.2 불변식 I1~I6을 검사하는 checkInvariants(state)를 만들고, fast-check로 무작위 동작 열 1,000개를 fixture에 적용한 뒤 위반 0인지 확인하는 속성 테스트를 써.
4. loadCampus 결과 ↔ EditState 변환 함수와, EditState를 SPEC 4.3 파일 배치로 다시 쓰는 serialize 함수를 만들어.
   - 불러올 때 구간 끝 좌표가 지점과 다르면 오류(I2)로 알려.
   - 저장할 때는 끝 좌표를 지점에서 채워 완전한 LineString으로 펼쳐.
   - 불러와서 바로 저장하면 파일이 바이트 단위로 같아야 해(테스트).

이 단계에서는 packages/editor를 건드리지 않는다. 끝나면 동작별 테스트 수와 npm test 결과를 보여 주고 "feat(edit): engine" 으로 커밋해.
```

## 6~7. 매크로와 기본 편집 UI [병렬]

```
5단계가 끝났으니 서브에이전트 두 개를 동시에 띄워. 쓰는 폴더가 겹치지 않으니 같은 작업 폴더에서 돌려도 돼. 둘 다 패키지 설치는 하지 마.

[edit-engine] SPEC-v0.2 6.1~6.4 매크로를 packages/core/src/edit/macros에 만들어.
- splitEdgeAt 재사용, 허용치는 edit/tolerances.ts.
- Turf는 거리 단위 기본값이 킬로미터야. 모든 호출에 { units: 'meters' }를 넘기고, 빠뜨린 곳이 없는지 grep으로 확인하는 테스트(또는 lint 규칙)를 하나 둬.
- nearestPointOnLine 결과는 7.4의 새 속성 이름(segmentIndex, lineDistance, pointDistance)을 써. 설치 버전이 7.4보다 낮으면 멈추고 알려 줘.
- attachDoor: 복도를 못 찾으면 상태를 바꾸지 않고 { ok: false, reason }을 돌려줘.
- 각 매크로 테스트: 직선 복도, 꺾인 복도, 문이 복도 끝 바깥쪽에 있는 경우, 수선의 발이 기존 지점 0.5m 옆인 경우(새 지점을 만들지 않음), 다른 층 복도가 더 가까운 경우(무시).
- 매크로 하나 = 이력 항목 하나인지, 되돌리기 후 불변식이 지켜지는지 테스트.
- 문 연속 찍기 UI가 쓸 미리보기 함수 previewAttachDoor(state, coord)도 만들어(상태를 바꾸지 않고 발 좌표와 대상 구간만 돌려줌).

[editor-ui] SPEC-v0.2 5.1과 5.3의 기본 편집을 packages/editor에 만들어.
- 편집기 상태를 @campo/core의 EditState + History로 바꿔. 기존에 Feature를 직접 고치던 코드는 모두 동작 호출로 바꿔.
- 선택(클릭, Shift+클릭 여러 개, 드래그 상자), 삭제, 이어 붙이며 삭제, 합치기, 되돌리기/다시 하기, 키는 5.3 표대로.
- 지점 끌기: MapLibre 이벤트로 직접 구현. SPEC-v0.2 5.1의 iD 끌기 규칙을 모두 지켜.
  - 이력은 시작 perform(noop) → 움직이는 동안 replace → 놓을 때 설명 있는 replace.
  - 끄는 동안 임시 소스만 갱신.
  - 놓는 자리 5px 안에 같은 범위 지점이 있으면 강조하고, 놓으면 mergeNodes.
  - 같은 범위 구간 위에 놓으면 splitEdgeAt 후 그 자리에 잇기.
  - 놓을 수 없는 곳이면 금지 커서를 보여 주고 원래 자리로.
  - Alt는 붙이기 끔. 시작에 Shift면 상자 선택.
  - 구간 가운데 손잡이를 끌면 새 지점.
- Terra Draw는 새 선 그리기에만 남겨.
  - finish 이벤트에서 동작으로 바꿔 넣은 뒤 Terra Draw 저장소에서 지워.
  - Terra Draw 자체 되돌리기(undoRedo)는 꺼.
  - 그리는 중 붙이기는 coordinates.snappable의 toCustom으로 같은 범위 지점만.
- 저장은 5단계의 serialize를 써.
- 스크린샷: 지점 끌기 전후, 삭제 확인 대화상자(건물 삭제 개수 표시).

두 결과가 다 오면 네가 npm test, npm run typecheck를 돌리고, 충돌이나 빠진 동작이 있으면 정리해서 보여 줘. 커밋은 둘로 나눠: "feat(edit): corridor and door macros", "feat(editor): select, drag, delete".
```

## 8. 범위 자동 판단, 포탈, 화장실, 매크로 도구 UI [계획]

```
editor-ui 서브에이전트를 써서 SPEC-v0.2 5.2와 6.5, 화장실 도구를 만들어.

1. 범위 자동 판단: 건물 모드에서 외곽선 안을 찍으면 현재 층, 밖이면 outdoor. O 키를 누르고 있으면 강제로 outdoor. 커서 옆에 지금 범위("바깥" / "A동 3층")를 작게 보여 줘.
2. 붙이기는 같은 범위 지점과 출입구 지점에만. 다른 층 지점은 흐리게, 클릭 안 됨.
3. 바깥 길을 그리다 출입구 지점에 붙이면 그 구간을 edge_type: portal로 자동 생성.
4. 화장실 도구: 클릭 → 성별·휠체어·기저귀 교환대 선택 패널 → 가장 가까운 복도에 attachDoor 방식으로 자동 연결. 아이콘은 성별·휠체어 여부가 구분되게.
5. 문 연속 찍기(D)와 강의실 줄(R): SPEC-v0.2 6.5대로. 마우스를 움직일 때 previewAttachDoor로 수선의 발과 연결선을 미리 보여 줘. 호실 번호 자동 증가, Shift+클릭 뒷문, 숫자 2로 간격 2, F로 앞뒤 뒤집기.
6. 길찾기 탭에 "가장 가까운 화장실" 버튼(일반 / 휠체어)을 추가해. core의 findNearest를 그대로 불러 써.
7. packages/editor/e2e/floor-in-60-clicks.spec.ts: 빈 층에서 시작해 복도 1개, 강의실 20개(문 30개), 계단 1개, 엘리베이터 1개를 만들고 클릭 수를 세어 출력해. 결과 데이터가 npm run validate를 통과해야 해.
8. scope.spec.ts: 건물 3층 작업 중 모드 전환 없이 바깥 길 2구간을 그리고 출입구에 붙여 포탈이 생기는지 확인.

스크린샷과 두 e2e 결과(클릭 수 포함)를 보여 주고 "feat(editor): scope, portal, restroom, door tools"로 커밋해.
```

## 9. changeset과 제보 파이프라인

```
서브에이전트 두 개를 순서대로 써.

먼저 edit-engine:
1. SPEC-v0.2 7.1 changeset 형식의 타입과 스키마, History의 패치 묶음 → changeset 변환 함수.
2. packages/tools에 apply CLI(npm run apply -- <파일...> [--dry-run]): rev 충돌 검사, 적용, validateCampus, 사람이 읽는 요약. 하나라도 실패하면 아무것도 쓰지 않음.
3. packages/core/src/reports: 제보 타입과 kinds.ts(SPEC-v0.2 7.3 표), 제보 → 미리 채운 동작 또는 override 항목을 만드는 함수.
4. data/reports/sample/*.json에 가짜 제보 8개(종류마다 하나 이상, 같은 위치 중복 2개 포함).
5. 테스트: 충돌 감지, 같은 changeset 두 번 적용 거부, 일시 제보가 overrides에만 들어가는지, 만료 시각이 지나면 길찾기에서 빠지는지.

그다음 editor-ui:
6. 편집기에 '제보' 탭: 대기열(종류·위치·상태), 같은 Feature나 5m 안 제보 묶기, 클릭하면 지도 이동, "적용"은 미리 채운 동작을 실행하고 바뀐 점을 강조, "저장"은 changeset 파일을 changesets/에 쓰고 제보 상태를 바꿈.

끝나면 가짜 제보 8개를 편집기에서 처리해 생긴 changeset을 npm run apply -- changesets/*.json --dry-run으로 돌린 출력을 보여 줘. 커밋은 "feat(pipeline): changesets and reports".
```

## 10. 독립 검증

```
qa-verifier 서브에이전트를 써서 v0.2 전체를 검증해. 너(메인 세션)는 이 단계에서 코드를 고치지 마.

qa-verifier가 docs/v0.2/qa-report.md를 쓰면, 실패 항목을 담당 폴더별로 묶어서 나에게 보여 줘:
- packages/core/src/routing → core-routing
- packages/core/src/edit, reports, packages/tools → edit-engine
- packages/editor → editor-ui
그리고 각 담당 서브에이전트에게 줄 수정 지시문을 한 문단씩 써 줘. 내가 확인한 뒤에 실행할게.
```

수정이 끝나면 10번을 한 번 더 돌린다. 실패가 0이 될 때까지 반복한다.

## 11. 마무리

```
1. docs/v0.2/SPEC-v0.2.md 내용을 docs/SPEC.md에 모두 합치고(버전 v0.2로), SPEC-v0.2.md는 지워. 조사 노트와 qa-report는 docs/v0.2/에 남겨.
2. docs/decisions.md에 v0.2에서 정한 것을 한 줄씩 추가해: 비용 단위 초, 엘리베이터 펼치기, step_free 세 값, 편집 엔진 단일 원본, 범위 자동 판단, 일시 상태는 overrides, changeset 형식. 이름은 윤준혁.
3. docs/claude-code-prompts.md 끝에 "v0.2 이후 데이터 입력법" 절을 추가해: 문 연속 찍기와 강의실 줄 사용법, 제보 처리 순서.
4. npm test, npm run typecheck, npm run validate, 두 e2e를 마지막으로 돌리고, PR 설명을 써서 PR을 만들어. PR 설명에 완료 기준 D1~D6 표와 클릭 수 결과를 넣어.
```

---

## 막혔을 때

| 상황 | 할 일 |
|---|---|
| 서브에이전트가 맡은 폴더 밖을 고치려 함 | 멈추게 하고, 메인 세션에게 "필요한 변경을 설명만 하게 해"라고 시킨다 |
| 병렬 단계에서 package-lock 충돌 | 두 에이전트를 멈추고 메인 세션이 설치를 다시 한 뒤 다시 띄운다 |
| 테스트가 계속 실패하는데 원인을 모름 | `/clear` 후 "docs/v0.2/qa-report.md의 X 항목을 systematic하게 디버깅해. 가설을 세우고 하나씩 확인해" |
| 어사이드가 안 됨 | 조사 에이전트는 WebSearch/WebFetch로 대신한다(에이전트 파일에 적혀 있음) |
| 클릭 수가 60을 넘음 | qa-report의 클릭 기록을 보고 가장 많이 쓴 단계를 줄이는 방법을 editor-ui에게 묻는다 |
