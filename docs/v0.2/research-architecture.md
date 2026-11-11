# v0.2 오픈소스 조사와 아키텍처 해설

## 조사 방법

- **어사이드(Aside) 브라우저로 GitHub 원본 소스를 직접 읽었다.** iD, ngraph.path, ngraph.graph, Terra Draw, Turf, Immer 문서, OpenTripPlanner, Valhalla.
- **ngraph는 실제로 실행해 봤다.** 작은 스크립트로 막힌 경로, 방향, 중복 링크, 결과 순서를 확인했다.
- 공식 문서는 웹 검색으로 보충했다.
- v0.1 캠포 코드는 보지 않았다. 그래서 "v0.1에 이 결함이 있다"는 가설이고, 프롬프트 2가 실제 코드에서 확인한다.

조사 시점(2026-11-11) 최신 버전: ngraph.path 1.6.1, ngraph.graph 20.1.2, terra-draw 1.39.0, @turf/* 7.4.0, immer 11.2.10, fast-check 4.10.2.

---

## 1. 확인한 사실과 캠포에 넣은 것

### 1.1 ngraph.path / ngraph.graph (MIT)

소스 확인 + 직접 실행.

| 사실 | 영향 | SPEC |
|---|---|---|
| `aStar`의 `oriented` 기본값이 없다(undefined). 그래서 `forEachLinkedNode`가 방향을 무시한다. 실행해 보니 A→B 링크만으로 B→A 경로가 나왔다 | 일방 구간, 엘리베이터 board/alight가 반대로 쓰임 | 3.3, R2 |
| multigraph가 아니면 `createSingleLink`가 기존 링크의 `data`만 바꾼다. 실행 결과 링크 수 1 | 계단과 경사로가 같은 두 지점을 이으면 하나가 사라짐 | 3.3, R3 |
| `reconstructPath`가 도착점에서 부모를 따라 올라간다. 결과 `["C","B","A"]` | 출발→도착 순서로 뒤집어야 함 | 3.3, R5 |
| **막힌 구간 너머의 지점도 탐색 대기열(openSet)에는 들어간다.** 그래서 도착점이 막힌 구간으로만 이어지면, 그 상태가 나중에 꺼내질 때 "도착"으로 판정된다. 결과는 `["C"]`. 비용을 `Infinity`로 줘도 같다 | "경로 없음"이 한 지점짜리 경로로 보임 | 3.3, R13 |
| `distance` / `blocked`는 `(다음 지점, 현재 지점, 링크)` 순서로 불린다. A→B 탐색 때 `a=B, b=A` | 방향별 비용을 인자 순서로 계산하면 반대가 됨 | 3.3, R14 |

### 1.2 iD 편집기 (ISC)

`modules/actions/*.ts`, `modules/modes/drag_node.js`, `modules/core/history.ts`를 읽었다.

| 사실 | 캠포에 넣은 것 |
|---|---|
| 길(way)은 지점 id 목록만 가진다. 좌표는 지점에만 있다 | 편집 상태의 구간은 `from`/`to` 참조와 중간 꺾임점만 가진다. 저장할 때 펼친다 (4장) |
| `actionDeleteNode`는 지점을 쓰는 길에서 그 지점을 빼고, 지점이 2개 미만이 된 길(`isDegenerate`)은 함께 지운다 | `deleteNodes`가 이어진 구간을 함께 정리 (4.1) |
| `actionConnect`(지점 합치기)는 남길 지점을 "의미 있는 태그가 있고 오래된 지점" 순으로 고르고, 태그를 합친 뒤, 망가진 길을 지운다. `disabled()`로 못 합치는 경우를 알린다 | `mergeNodes` 규칙 (4.1) |
| `actionMoveNode`는 지점 하나의 좌표만 바꾼다. 길은 참조라서 저절로 따라온다 | `moveNode` |
| 끌기: 시작에 `perform(actionNoop())`, 움직이는 동안 `replace`, 놓을 때 설명 있는 `replace`. `undo`는 설명 있는 항목까지 건너뛴다 | 이력 perform / replace / overwrite (4장) |
| 끌다가 길 위에 놓으면 `actionAddMidpoint`로 그 길에 끼워 넣는다. 놓을 수 없는 곳이면 "nope" 표시 후 원래 자리로 되돌린다. `Alt`는 붙이기를 끈다. 끌기 시작에 `Shift`면 취소한다 | 끌기 규칙 (5.1) |
| 작업(Operation)은 `available`, `disabled`, `tooltip`, `annotation`, `keys`를 가진다 | 작업과 키 (5.1, 5.3) |

### 1.3 Terra Draw (MIT)

소스 확인.

- select 모드의 `flags`: `feature.draggable`, `feature.coordinates.{snappable, midpoints, draggable, resizable, deletable}`.
- `snappable`은 `true` 또는 `{ toLine, toCoordinate, toCustom }`.
- 이벤트: `ready`, `finish`, `change`, `select`, `deselect`, `history`.
- 자체 되돌리기 기능이 있다.
- **결론**: Feature가 서로 독립적이라 연결된 편집에는 맞지 않는다. 새 선 그리기에만 쓴다. 자체 되돌리기는 끄고, 그리는 중 붙이기는 `toCustom`으로 같은 범위만 허용한다 (5.1).

### 1.4 Turf (MIT)

`nearest-point-on-line` 7.4.0 소스 확인.

- 거리 단위 기본값이 **킬로미터**다.
- 반환 속성 이름이 7.4에서 바뀌었다: `segmentIndex`, `totalDistance`, `lineDistance`, `segmentDistance`, `pointDistance`. 옛 이름(`index`, `location`, `dist`)은 폐지 예정이다.
- SPEC 6장 주의사항에 반영했다.

### 1.5 Immer (MIT)

문서 확인.

- 패치 기능은 6부터 `enablePatches()`를 직접 불러야 켜진다.
- Map/Set을 쓰려면 `enableMapSet()`도 필요하다.
- **결론**: 편집 상태를 일반 객체로 두고, 패치를 그대로 JSON changeset으로 저장한다 (4장, 7장).

### 1.6 OpenTripPlanner (LGPL, 구조만 참고)

`ElevatorBoardEdge` / `HopEdge` / `AlightEdge`의 `traverse()`를 확인했다.

| 구간 | 비용 |
|---|---|
| board | `boardCost` + 기다림 시간 × reluctance |
| hop | 층마다 운행 시간. 휠체어 요청이면 접근성 정보 없음에 `unknownCost`, 불가에 `inaccessibleCost` |
| alight | 1 |

- 문서 기본값(v2.7): `elevatorBoardTime` 90, `elevatorHopTime` 20, `stairsTimeFactor` 3.0.
- 그래프를 만들 때 엘리베이터 데이터 경고를 낸다(`OnlyOneConnectionToElevatorNode`, `AllWaysOfElevatorNodeOnSameLevel` 등).
- 캠포에 넣은 것: 엘리베이터 펼치기(3.2), 모름 벌점(3.4), 검사 W8·W9(8장).

### 1.7 Valhalla (MIT)

`pedestriancost.cc`를 확인했다.

- 계단 벌점: 걷기 30초, 휠체어 600초.
- 엘리베이터 벌점 5초. 엘리베이터 노드에서는 **층 번호 차이 × 5초**로 계산한다.
- 벌점은 비용에만 더하고 시간에는 0을 더한다.
- 캠포에 넣은 것: `fewest_steps` 대체 경로(3.4), 비용·시간 분리 확인. 층 번호로 계산하는 방식은 캠포 규칙과 맞지 않아 쓰지 않는다.

### 1.8 그 밖

| 출처 | 내용 | 캠포에 넣은 것 |
|---|---|---|
| JOSM IndoorHelper (GPL, 생각만 참고) | 태그 달기, 검사, 보기 기능이 있다. 방·복도에 이어지지 않은 문·출입구를 오류로 알려 주지만 고치지는 않는다(검색 요약으로 확인, 플러그인 코드와 위키 원문은 못 읽음). "현재 작업 층을 새 물체에 자동으로 붙인다"는 확인하지 못했다 | 범위 자동 판단(5.2)은 캠포 자체 설계다. IndoorHelper에서 가져온 기능이 아니다 |
| OSM 화장실 태그 | `wheelchair=yes`도 실제 사용을 보장하지 않는다 | 화장실 속성(2.3) |
| MapRoulette + OSMCha | 작업 대기열과 변경 묶음 검토를 연결해 쓴다 | 제보 탭과 changeset(7장) |
| QGIS "Shortest line between features" | 점에서 가장 가까운 선까지 최단 선을 만든다. 문→복도 연결과 같은 연산이다. 다만 선을 나누지는 않는다 | 캠포 `attachDoor`는 여기에 "복도 나누기"와 "기존 지점 재사용"을 더했다 |
| IndoorGML 내비게이션 그래프 자동 추출 연구(ISPRS 2019, TU Delft) | 점군에서 그래프를 자동으로 뽑는 연구 단계 | 지금 캠포에는 과하다. 반자동 매크로가 현실적이다 |
| GitHub 실내 길찾기 저장소 검색 | 별이 적고 오래된 것뿐이었다(예: Leaflet.RSWE, 2016). 참고할 만한 활발한 웹 실내 그래프 편집기를 찾지 못했다 | 캠포 편집기를 iD 구조 위에 직접 만드는 쪽이 맞다 |

---

## 2. 왜 이렇게 바꾸나

### 2.1 원본 하나 + 참조형 구간

v0.1이 GeoJSON 구간에 끝 좌표를 복사해 두고 있다면, 지점을 옮길 때마다 이어진 구간 좌표를 찾아 고쳐야 한다. 하나라도 빠지면 지도가 어긋난다.

iD처럼 구간이 지점을 참조만 하면 이 문제가 처음부터 생기지 않는다. 파일 형식은 그대로 두고 편집기 안의 표현만 바꾸므로, 데이터 담당은 아무것도 다시 할 필요가 없다.

### 2.2 모든 편집은 동작 하나로

편집기 클릭, 매크로, 제보 반영이 모두 같은 동작을 쓴다. 그래서:

- 되돌리기가 항상 맞게 동작한다.
- 매크로를 화면 없이 테스트할 수 있다.
- 제보 반영 결과가 그대로 changeset 파일이 된다.

### 2.3 범위(scope)는 찍은 위치로

"건물 모드에서는 바깥 지점 금지"는 모드가 범위를 정해서 생긴 문제다. 위치로 정하고 붙이기를 같은 범위로 제한하면, 동선이 끊기지 않고 다른 층에 잘못 붙는 위험도 줄어든다.

### 2.4 엘리베이터는 구조로, 막힌 경로는 결과 검사로

- 비용 숫자만 바꿔서는 기다림 중복(R1)과 중간 갈아타기(R9)가 사라지지 않는다. board / hop / alight로 펼쳐야 한다.
- ngraph의 `[도착점]` 결과(R13)는 라이브러리 동작이라 결과를 검사하는 수밖에 없다.

### 2.5 일시적인 상태는 원본과 나눈다

고장·공사 제보는 만료 시각이 있는 `overrides.json`으로 둔다. 지도 원본 기록이 깨끗하게 남고, 수리가 끝나면 저절로 풀린다.

---

## 3. 사람이 정할 것

| 질문 | 제안 | 참고 |
|---|---|---|
| 엘리베이터 기다리는 시간 | 40초로 시작하고 한양대에서 몇 번 재서 고친다 | OTP 기본값 90초 |
| 계단 시간 계수 | 2.5 | OTP 3.0 |
| 복도 자동 분할 기본값 | 끔 | |
| 앞문 판단 규칙 | 복도 그린 방향의 앞쪽 끝 + `F`로 뒤집기 | |
| changeset 저장 위치 | Git `changesets/` | 나중에 Supabase |

---

## 출처

- iD: [ARCHITECTURE.md](https://cdn.jsdelivr.net/npm/@openstreetmap/id@2.40.0/ARCHITECTURE.md), [delete_node.ts](https://github.com/openstreetmap/iD/blob/develop/modules/actions/delete_node.ts), [connect.ts](https://github.com/openstreetmap/iD/blob/develop/modules/actions/connect.ts), [move_node.ts](https://github.com/openstreetmap/iD/blob/develop/modules/actions/move_node.ts), [drag_node.js](https://github.com/openstreetmap/iD/blob/develop/modules/modes/drag_node.js), [history.ts](https://github.com/openstreetmap/iD/blob/develop/modules/core/history.ts)
- ngraph: [a-star.js](https://github.com/anvaka/ngraph.path/blob/main/a-star/a-star.js), [ngraph.graph index.js](https://github.com/anvaka/ngraph.graph/blob/main/index.js), [README](https://www.Github.com/anvaka/ngraph.path)
- Terra Draw: [select.mode.ts](https://github.com/JamesLMilner/terra-draw/blob/main/packages/terra-draw/src/modes/select/select.mode.ts), [terra-draw.ts](https://github.com/JamesLMilner/terra-draw/blob/main/packages/terra-draw/src/terra-draw.ts), [워크숍: 이벤트](https://terradraw-workshop.pages.dev/workshops/foss4g2025/advanced/exercise-5)
- Turf: [nearest-point-on-line index.ts](https://github.com/Turfjs/turf/blob/master/packages/turf-nearest-point-on-line/index.ts)
- Immer: [Patches 문서](https://github.com/immerjs/immer/blob/main/website/docs/patches.mdx)
- OpenTripPlanner: [ElevatorBoardEdge.java](https://github.com/opentripplanner/OpenTripPlanner/blob/dev-2.x/street/src/main/java/org/opentripplanner/street/model/edge/ElevatorBoardEdge.java), [ElevatorHopEdge.java](https://github.com/opentripplanner/OpenTripPlanner/blob/dev-2.x/street/src/main/java/org/opentripplanner/street/model/edge/ElevatorHopEdge.java), [Route Request v2.7.0](https://docs.opentripplanner.org/en/v2.7.0/RouteRequest/), [개발 논의](https://groups.google.com/g/opentripplanner-dev/c/LGNk36yLFQU)
- Valhalla: [pedestriancost.cc](https://github.com/valhalla/valhalla/blob/master/src/sif/pedestriancost.cc)
- [JOSM IndoorHelper](https://josm.openstreetmap.de/wiki/Help/Plugin/IndoorHelper), [OSM 위키: Wheelchair accessible toilets](https://wiki.openstreetmap.org/wiki/Wheelchair_accessible_toilets)
- [OSMCha ❤️ MapRoulette](https://blog.maproulette.org/2020/12/01/osmcha-%EF%B8%8F-maproulette), [QGIS Shortest line 알고리즘](https://api.qgis.org/api/qgsalgorithmshortestline_8cpp_source.html), [IndoorGML 그래프 추출 (ISPRS 2019)](https://isprs-annals.copernicus.org/articles/IV-2-W5/271/2019/)
- [Claude Code 서브에이전트 문서](https://code.claude.com/docs/en/sub-agents)
