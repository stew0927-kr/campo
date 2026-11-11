# 주제 C: 반자동 입력과 제보 파이프라인 조사

조사일 2026-11-11. 이미 확인된 사실(docs/v0.2/research-architecture.md 1장)은 다시 조사하지 않았다. 웹 페이지는 WebFetch/WebSearch로 읽었다(어사이드 MCP 도구는 이 세션에 없었다). Immer 동작은 설치된 immer 11.2.10으로 직접 실행해 확인했다(스크래치 폴더 스크립트, 저장소에는 남기지 않음).

## 1. 한 줄 결론

- rev 충돌 감지는 OSM의 "낙관적 잠금(버전이 다르면 거부) + 전부 아니면 전무 적용"과 같은 구조라서 방향이 맞다. 다만 SPEC 7장의 "Immer 패치 + base_revs"에는 구멍이 세 군데 있다(배열 인덱스 패치, 새 id 충돌, 참조 충돌). 직접 실행으로 확인했다.
- MapRoulette에서 가져올 것은 "상태 이름 목록"보다 "상태 전이 규칙"과 "대기열에 남는 상태 vs 끝난 상태의 구분"이다. 묶기(bundle)는 중복 합치기가 아니라 "한 번에 같이 풀기"라서 SPEC 7.3의 설명과 용도가 다르다.
- 문을 복도선에 자동으로 잇는 도구(수선의 발 + 선 나누기 + 기존 지점 재사용)는 **실내 지도 도구에서는 못 찾았다.** 가장 가까운 것은 GRASS `v.net connect -s`(GPL)와 JOSM 핵심 기능 "Join Node to Way"이고, 둘 다 범용 GIS/OSM 편집 기능이지 실내 전용이 아니다.

## 2. 확인한 사실

### 2.1 JOSM 충돌 해결과 OSM osmChange (질문 1)

| 사실 | 근거 | 확인 방법 |
|---|---|---|
| OSM은 객체마다 버전 번호가 있고, 업로드할 때 내가 내려받은 버전을 같이 보낸다. 서버 버전이 더 높으면 업로드를 거부하고(409 Conflict), JOSM은 그때 충돌을 만든다 | https://josm.openstreetmap.de/wiki/Help/Concepts/Conflict, https://wiki.openstreetmap.org/wiki/API_v0.6 ("If the version supplied is not the same as the server's current version ... HTTP status code 409") | 문서 |
| 충돌의 정의: "두 버전의 차이 중 JOSM이 자동으로 풀 수 없는 것". 자동으로 풀리는 경우도 있다(이미 지워진 걸 또 지우기 등은 조용히 건너뜀) | 위 Concept/Conflict 페이지 | 문서 |
| JOSM 충돌 종류: 속성(좌표, 삭제 여부), 태그(키별), 지점 목록(way), 멤버 목록(relation). 해결은 "내 것/상대 것" 선택 또는 목록 병합 후 "Freeze" | https://josm.openstreetmap.de/wiki/Help/Dialog/Conflict | 문서 |
| JOSM 충돌 저장소는 "내 객체 하나당 충돌 하나"만 허용하고, 내 쪽(my)과 상대 쪽(their) 쌍으로 저장한다 | https://github.com/JOSM/josm/blob/master/src/org/openstreetmap/josm/data/conflict/ConflictCollection.java (GPL, 구조만 서술) | 소스 |
| 서버가 "아직 way가 쓰고 있는 node를 지우려 함"을 412로 거부하면, JOSM은 "충돌 해결 준비" 버튼으로 그 way들을 내려받아 병합하고, 대부분 way에서 node를 자동으로 빼 준다. 못 하면 사람이 푼다 | https://josm.openstreetmap.de/wiki/Help/Action/Upload | 문서 |
| iD의 `actionMergeRemoteChanges`: 공통 조상(base) / 내 것(local) / 원격(remote) 3자 비교. 태그는 키별로 한쪽만 바뀌면 자동 병합, 양쪽이 다르게 바꾸면 충돌. way 지점 목록은 diff3로 병합, 같은 구간을 양쪽이 다르게 바꾸면 충돌. 좌표와 relation 멤버는 `safe` 모드에서 자동 병합하지 않는다. 옵션은 `safe`(기본, 충돌이 하나라도 있으면 아무것도 적용 안 함) / `force_local` / `force_remote` | https://github.com/openstreetmap/iD/blob/develop/modules/actions/merge_remote_changes.ts (조사 시점 develop, 커밋 해시는 확인 못 함). 라이선스 ISC (GitHub API spdx_id=ISC) | 소스 |
| osmChange는 `create` / `modify` / `delete` 세 덩어리. 동작은 객체 전체 단위라서 태그 하나만 바꾸는 표현이 없고 modify는 기존 태그를 모두 다시 적어야 한다 | https://wiki.openstreetmap.org/wiki/OsmChange | 문서 |
| 모든 요소에 changeset id와 version이 필요하다(새로 만드는 것 제외). delete는 id/changeset/version만 있으면 된다 | 같은 페이지 | 문서 |
| 새로 만드는 객체는 음수 id를 임시 번호로 쓰고, 서버가 진짜 id를 배정해 뒤 항목에서 참조를 치환한다. 아직 안 만든 임시 id를 앞에서 참조하는 것은 거부된다 | OsmChange 위키, https://wiki.openstreetmap.org/wiki/API_v0.6 | 문서 |
| 업로드는 트랜잭션: "전부 적용되거나 하나도 적용 안 된다". 처리는 첫 오류에서 멈추므로 첫 문제만 보고된다 | https://wiki.openstreetmap.org/wiki/API_v0.6 (diff upload 절) | 문서 |
| delete 덩어리의 `if-unused`: 다른 객체가 쓰고 있으면 삭제를 건너뛴다. 없으면 쓰는 객체가 있을 때 업로드 전체가 실패한다. 이미 지워진 객체를 또 지워도 오류가 아니다 | OsmChange 위키, API_v0.6 위키 | 문서 |
| 라이선스: JOSM은 GPL(GitHub API는 NOASSERTION, 소스 헤더에 GPL 표시), iD는 ISC. OSM 위키 텍스트는 CC BY-SA. 캠포는 JOSM 구조만 참고하고 코드는 가져오지 않는다 | GitHub API, 소스 헤더 | 소스 |

### 2.2 Immer 패치로 changeset을 만들 때의 실제 동작 (직접 실행, immer 11.2.10)

스크립트: `C:\Users\PC\AppData\Local\Temp\claude\5c22faf5da925b74\a2cf9eed-ad83-473a-8fff-f7af7fb5dae2\scratchpad\t.mjs`. 기준 상태에서 만든 패치를, 그 사이 다른 변경이 들어간 상태에 적용해 봤다.

| 확인한 동작 | 결과 | 의미 |
|---|---|---|
| 패치는 `{"op":"replace","path":["edges","e1","vertices",1],"value":[9,9]}`처럼 **배열 인덱스 경로**를 쓴다 | 다른 변경이 `vertices.shift()`로 앞을 하나 지운 상태에 적용하니 오류 없이 **엉뚱한 꼭짓점(원래 3번째)이 덮어써졌다** | `rev` 검사가 없으면 조용히 틀린 결과가 나온다. 구간 `vertices`는 `rev`가 구간에 있으니 base_revs로 막히긴 하지만, base_revs 목록이 빠지면 뚫린다 |
| `add` 패치로 이미 있는 id(`nodes.n`)를 추가 | 오류 없이 **덮어씀** | 새 Feature id가 겹쳐도 apply 단계에서는 안 걸린다 |
| `rev`를 `replace`로 절대값(예 2)으로 기록 | 현재 값과 무관하게 그대로 설정 | rev 충돌 감지는 패치가 아니라 CLI의 base_revs 비교 한 곳에만 의존한다 |
| 없는 키 `remove` | 오류 없이 통과 | 이미 지워진 것을 또 지워도 조용히 통과(OSM `if-unused`와 비슷한 효과, 의도적인지 정해야 함) |
| 부모가 없는 경로 `replace` | 오류 던짐("path doesn't resolve") | 부모를 지운 뒤 자식을 고치는 패치는 거부됨 |

### 2.3 MapRoulette 작업 상태와 묶기 (질문 2)

| 사실 | 근거 | 확인 방법 |
|---|---|---|
| 상태 상수: 0 Created, 1 Fixed, 2 False_Positive(표시 이름 Not_An_Issue), 3 Skipped, 4 Deleted, 5 Already_Fixed, 6 Too_Hard, 7 Answered, 8 Validated, 9 Disabled | https://raw.githubusercontent.com/maproulette/maproulette2/main/app/org/maproulette/framework/model/Task.scala (저장소는 maproulette-backend로 이전됨, 라이선스 Apache-2.0: https://api.github.com/repos/maproulette/maproulette-backend/license) | 소스 |
| 상태 전이 규칙(`isValidStatusProgression`): 같은 상태 또는 Deleted/Disabled로는 항상 가능. Created는 어디로든 가능. Fixed와 Already_Fixed는 `allowChange` 없이는 못 바꿈. False_Positive는 기본으로 Fixed로만. Skipped/Too_Hard는 Fixed, False_Positive, Already_Fixed, Skipped, Too_Hard, Answered로. Deleted/Disabled는 Created로만 | 위 Task.scala | 소스 |
| 검수(review) 상태는 작업 상태와 **별개 축**이다: Requested, Approved, Rejected, Approved With Fixes, Disputed, Unnecessary 등. 필드: reviewRequestedBy, reviewedBy, reviewedAt, metaReview* | 위 Task.scala | 소스 |
| 사용자 화면에서 각 선택의 효과: "I fixed it!" = 다른 사람에게 안 보냄. Already Fixed / Not an Issue = 다른 사람에게 안 보냄(검수자가 확인). Skip = 풀에 남음. Too hard / Can't see = **다른 사람에게 계속 보냄** | https://blog.maproulette.org/2020/12/01/what-if-i-cant-fix-a-maproulette-task/ (2020년 글, 버튼 이름은 바뀌었을 수 있음) | 문서 |
| 묶기(bundle): 지도에서 서로 가까운 작업 여러 개를 골라 "Complete Together"로 하나의 작업처럼 푼다. 풀기 전에 취소하거나 Unbundle로 되돌릴 수 있다 | https://learn.maproulette.org/en-US/documentation/solving-multiple-tasks-together/ | 문서 |
| 묶기 데이터 모델: 작업 테이블에 `bundle_id`, `is_bundle_primary` 열 두 개만 있다. Task.scala에는 묶기 로직이 없다 | 위 Task.scala | 소스 |
| 묶음 안 작업의 상태를 개별로 바꾸려면 묶음을 풀고 개별로 지정해야 하고, 아니면 상태 변경이 묶음 전체에 적용된다 | https://lists.openstreetmap.org/pipermail/talk-ph/2020-October/006633.html 검색 요약(메일링 리스트 글, **2차 출처**, 원문 직접 확인 못 함) | 추정에 가까움 |
| 묶음 크기 제한, primary의 역할은 공식 문서 페이지에 없음 | 위 learn.maproulette.org 페이지 | 문서(없음 확인) |
| MapRoulette는 작업에 만료 시각이 없다 | 상수·전이 규칙에 만료 개념 없음(Task.scala) | 소스에서 못 찾음. 부재는 확인했으나 다른 파일에 있을 가능성은 배제 못 함 |

### 2.4 문→복도선 자동 연결 도구 탐색 (질문 3)

**결론: 실내 지도 전용 도구 중에 "문을 가장 가까운 복도선의 수선의 발에 잇고, 필요하면 복도를 나누고, 기존 지점을 재사용"하는 것은 못 찾았다. "없음"으로 본다.** 아래는 찾아본 곳과 가장 가까운 것들이다.

찾아본 곳과 결과:

| 찾아본 곳 | 결과 | 근거 |
|---|---|---|
| JOSM 플러그인 IndoorHelper | 없음. 태그 달기, 검사, 보기. "방/복도에 안 이어진 문·출입구"를 오류로 **알려 줄 뿐** 고치지 않음 | https://wiki.openstreetmap.org/wiki/JOSM/Plugins/indoorhelper (검색 요약, 플러그인 코드는 안 읽음) |
| JOSM 핵심 기능 "Join Node to Way" | 있음(범용). 선택한 node를 가장 가까운 way 구간에 끼워 넣는다. 거리가 아주 가까울 때만 동작(기본 10픽셀). 구간을 둘로 나누는지, 여러 node 처리는 문서에 없음 | https://josm.openstreetmap.de/wiki/Help/Action/JoinNodeWay |
| OSM 실내 지도 위키 / Simple Indoor Tagging | 도구가 아니라 규칙. 문은 방과 벽 way가 같은 node를 공유한다. 복도는 문 node로 이어진다 | https://wiki.openstreetmap.org/wiki/Indoor_Mapping |
| Woosmap Indoor 콘솔 | 없음. "콘솔에서는 라우팅 그래프를 만들거나 고칠 수 없고 JOSM에서 관리해야 한다". 통로가 각 POI에 닿아야 한다는 요구만 있음 | https://developers.woosmap.com/products/indoor-api/guides/digitalisation (검색 요약) |
| Esri ArcGIS Indoors `Generate Indoor Network Features` | 자동 생성은 있으나 **방식이 다르다**. 벽·기둥 같은 장애물을 피하는 격자(lattice, 기본 간격 0.6m) 또는 UCN 방식으로 통로를 방 중심점까지 만든다. 문 전용 매개변수는 없고, 문 통과는 장애물 완충 거리와 격자 간격이 출입구 폭보다 좁아야 한다는 조건에 의존한다. 상용(ArcGIS Indoors 라이선스) | https://pro.arcgis.com/en/pro-app/3.6/tool-reference/indoors/generate-indoor-network-features.htm, https://pro.arcgis.com/en/pro-app/3.4/tool-reference/indoors/an-overview-of-the-indoors-network-toolset.htm |
| Mapbox Indoor | 공개 문서에서 해당 기능을 찾지 못함(검색 결과 0건). 확인 안 됨 | WebSearch |
| IndoorGML 도구: InEditor(웹, MIT), Ineditor Desktop v2.0(Unity, MIT), JInedit, ifc2indoorgml, IFC2BCM | Ineditor Desktop은 "노드(State)와 간선(Transition)을 자동 또는 수동 생성"한다고 적었지만 README에 규칙 설명이 없다. 나머지는 IFC/BIM에서 변환. 문과 복도를 잇는 규칙은 문서에 없음. 소스는 읽지 않았다 | https://github.com/STEMLab/Ineditor-Desktop-v2.0 (MIT, GitHub API 확인), https://github.com/STEMLab/InEditor |
| 오픈소스 실내 라우팅: indrz(GPL v3, Django + pgRouting), kosmindoormap(KDE), Navigine 라이브러리, OpenIndoor | 데이터 준비 단계에서 문을 그래프에 잇는 방법을 설명한 문서를 못 찾음. 코드는 읽지 않았다 | https://github.com/indrz (검색 요약), https://planet.kde.org/volker-krause-2025-06-28-indoor-building-mapping-in-osm (404, 접근 못 함) |
| QGIS | 지난 조사: `Shortest line between features`. 선을 나누지 않음 | research-architecture.md 1.8 |
| GRASS GIS `v.net operation=connect` | **가장 가까운 기능.** 점을 가장 가까운 선(임계 거리 `threshold` 필수)에 잇는 선을 넣는다. `-s`를 주면 새 노드를 가장 가까운 선 위 가장 가까운 지점에 놓는다. 선 분할의 세부 동작은 문서에 없음. 라이선스는 GPL(GRASS 전체, 이 페이지에는 라이선스 표시 없음, COPYING 파일 확인). 구조만 참고 | https://grass.osgeo.org/grass-stable/manuals/v.net.html |
| 학술(지난 조사) | IndoorGML 점군 자동 추출 | research-architecture.md 1.8 |

해석(추정): 실내 도구가 이 기능을 안 갖는 이유는, 대부분 (a) OSM 방식에서는 사람이 문 node를 복도·방 way와 공유하도록 직접 그리거나 (b) 방 중심점을 격자 통로로 잇는 방식이라서 "문 하나를 복도에 붙이는" 단일 연산이 필요 없기 때문으로 보인다. 확인한 것은 아니다.

## 3. SPEC과 다른 점, SPEC이 틀렸거나 빠뜨린 점

| # | 위치 | 내용 | 수준 |
|---|---|---|---|
| S1 | SPEC 7.1 / 4장 | **패치가 배열 인덱스 경로를 쓴다.** 구간 `vertices` 같은 배열은 다른 변경이 앞을 지우면 같은 인덱스가 다른 꼭짓점을 가리킨다. 실행 확인(2.2)에서 오류 없이 엉뚱한 곳이 바뀌었다. SPEC은 base_revs로 막힌다고 보지만, base_revs에 그 Feature가 빠지면 뚫린다 | 구멍 |
| S2 | SPEC 7.2 1단계 | `add` 패치는 이미 있는 id도 조용히 덮어쓴다(실행 확인). 두 changeset이 같은 새 id를 만들면(I3) base_revs에 없는 id라서 충돌로 안 잡힌다. 편집기가 만든 id가 어떻게 유일해지는지 SPEC에 없다. OSM은 음수 임시 id를 서버가 진짜 id로 바꾼다 | 구멍 |
| S3 | SPEC 7.2 4단계 | "여러 파일을 한 번에 줄 수 있다"에서 두 번째 파일의 base_revs를 **원본 상태**와 비교하는지 **첫 파일 적용 후 상태**와 비교하는지 정해져 있지 않다. 같은 Feature를 두 파일이 건드리면 후자 기준이면 항상 충돌, 전자 기준이면 `rev` 절대값 덮어쓰기로 뒤 파일이 이긴다 | 모호 |
| S4 | SPEC 2.5 / 7.2 | base_revs에는 **패치가 건드리는 모든 Feature**가 들어가야 하는데, `moveNode`는 같은 `elevator_id`의 다른 정차 지점과 이어진 구간까지 바꾸고, `mergeNodes`는 구간 from/to를 바꾼다. 사람이 base_revs를 적는 구조면 빠진다. 패치에서 건드린 Feature를 추출해 자동으로 채워야 한다 | 빠짐 |
| S5 | SPEC 7.2 | **삭제와 참조 충돌**: 다른 제보가 A 지점에 구간을 새로 붙인 뒤, 내 changeset이 A 지점을 지우면 A의 rev는 안 바뀌어서 base_revs 비교가 통과한다. 적용 후 `validateCampus`의 I1(고아 구간)로만 잡히며, 그때 메시지가 "충돌"이 아니라 "검사 오류"로 나온다. OSM은 이 경우를 별도로 412("아직 쓰이고 있음")로 구분하고 `if-unused` 옵션을 준다 | 빠짐 |
| S6 | SPEC 7.2 1단계 | OSM은 **첫 오류에서 멈춰** 첫 문제만 알린다(위키 명시). SPEC은 "어떤 Feature가 다른지 보여 준다"로 목록을 암시하는데, 모든 불일치를 한 번에 보여 주는 쪽이 낫다. 틀린 점은 아니고 구현 때 정해야 할 것 | 제안 |
| S7 | SPEC 7.1 `source` | `report:<report_id>` 하나만 적을 수 있다. 묶음(여러 제보가 하나의 수정)이면 제보 여러 개가 changeset 하나에 대응한다. 배열 필드가 필요하다 | 빠짐 |
| S8 | SPEC 7.3 "MapRoulette의 작업 대기열 방식"으로 "중복을 합침" | MapRoulette의 bundle은 **중복 제거가 아니다.** 가까운 서로 다른 작업을 한 번에 풀기 위한 사용자 기능이다(2.3). "대기열"이라는 비유는 맞지만 중복 합치기는 캠포가 따로 설계해야 한다 | 설명이 부정확 |
| S9 | SPEC 7.3 상태 | `new → triaged → applied / rejected / duplicate`에는 MapRoulette의 `Already_Fixed`(이미 데이터가 맞음)와 `Too_Hard`(책상에서 판단 불가, 계속 대기열에 둠)에 해당하는 상태가 없다. 일시적 제보가 `overrides.json`의 `until` 만료로 끝나는 경우의 상태도 없다 | 빠짐 |
| S10 | research-architecture.md 1.8 | "JOSM IndoorHelper ... 현재 작업 층을 새 물체에 자동으로 붙인다"는 이번에 다시 확인하지 않았다(이번 조사 범위 밖). 내가 읽은 검색 요약에는 태그 달기·검사·보기만 나온다. 위키 원문 확인 필요 | 미확인 |

SPEC이 맞는 점: 7.2 4단계 "하나라도 실패하면 아무것도 쓰지 않는다"는 OSM diff upload의 트랜잭션(전부 적용 또는 전무)과 같다. 7.2 1단계의 "rev가 다르면 멈춤"은 OSM·JOSM의 버전 비교와 같은 방식이다.

## 4. 캠포에 가져올 것 / 가져오지 말 것

가져올 것:

1. 버전 비교로 거부하는 방식(OSM 409). 단 base_revs는 패치에서 자동 추출한다(S4).
2. iD `actionMergeRemoteChanges`의 3자 비교와 `safe` 기본값 개념. 캠포는 자동 병합을 v0.2에서 하지 않고 "충돌이면 멈추고 보고"가 기본이지만, 속성 단위(키별)로 한쪽만 바뀐 경우는 충돌이 아니라고 보는 규칙은 나중에 가져올 만하다(추정: v0.2 범위 밖).
3. 충돌 종류를 나누어 표시하기: 속성 충돌 / 삭제됨 / 참조됨(아직 쓰이고 있음) / 좌표. JOSM·iD 모두 이 분류를 쓴다.
4. OSM의 임시 음수 id 방식(또는 changeset id를 접두사로 넣은 id). 새 Feature id 충돌 방지(S2).
5. `if-unused` 같은 삭제 옵션. 캠포는 이미 `deleteNodes({heal})`, `deleteEdges`가 있으므로 "참조가 남아 있으면 건너뜀/실패" 선택을 changeset 수준에서 명시하는 정도.
6. MapRoulette의 상태 전이 표(`isValidStatusProgression`). 끝난 상태(applied, rejected, already_fixed)는 명시적 "다시 열기" 없이는 바꾸지 않는다. 이 구조는 소스에서 확인했다.
7. MapRoulette의 "다시 풀 수 있는 상태"와 "끝난 상태" 구분: Skipped, Too_Hard는 대기열에 남고 Fixed, Already_Fixed, Not an Issue는 남지 않는다.
8. 작업 상태와 검수 상태를 **다른 축**으로 두는 구조. 캠포에서는 PR 리뷰가 검수 역할이므로 제보 상태에는 PR 링크만 둔다.
9. 묶기의 데이터 모델: 제보에 `bundle_id`와 `is_primary`(대표) 두 필드만 둔다. 묶음을 풀면(unbundle) 개별 상태로 돌아간다.
10. GRASS `v.net connect -s` / JOSM Join Node to Way의 "임계 거리 안의 가장 가까운 선에 점을 붙인다"는 개념. 캠포 `attachDoor`(maxDist 8m, 수선의 발 1.0m 안 재사용, 아니면 split)는 이 연산에 "기존 지점 재사용"과 "한 동작으로 이력 한 항목"을 더한 것이다. 캠포가 새로 만드는 부분이므로 외부 구현 참조는 불필요하다.

가져오지 말 것:

1. JOSM·GRASS·indrz(GPL) 코드. 구조 설명만 했고 코드는 붙이지 않았다.
2. osmChange XML 형식 자체. 캠포는 이미 Immer 패치 JSON을 쓰고, osmChange는 태그 하나만 못 바꾸는 요소 단위 형식이라 캠포의 속성 단위 수정에 맞지 않는다.
3. MapRoulette의 전체 상태 10개(Answered, Validated, Disabled, Deleted 등). 캠포에 대응이 없다.
4. 서버 쪽 충돌 해결 UI(JOSM Conflict Dialog 식 병합 표). v0.2는 Git/PR로 충분하다(SPEC 9장).
5. Esri 격자 방식. 한양대 데이터는 사람이 복도선을 그리고 문을 매크로로 잇는 구조라서 격자로 통로를 자동 생성할 이유가 없다. 상용 라이선스이기도 하다.

## 5. 캠포에 적용할 점

### 5.1 changeset과 rev 충돌 (SPEC 7.1, 7.2 보완안)

1. **base_revs를 패치에서 자동 계산**한다. 패치 경로(`nodes/<id>`, `edges/<id>`, `buildings/<code>`)에서 건드린 Feature를 모아 기준 상태의 rev를 넣는다. 사람이 적은 base_revs와 자동 계산값이 다르면 오류로 한다. (S4)
2. **새로 만드는 Feature는 `add` 패치 대상 id가 현재 상태에 이미 있으면 충돌**로 처리한다. 코드에서 추가로 검사해야 한다(Immer가 안 막는다, 2.2). id 생성 규칙(예: 생성 시각 + 난수, 또는 changeset id 접두사)도 SPEC에 정한다. (S2)
3. **삭제 대상 Feature를 참조하는 다른 Feature가 있는지** 적용 전에 따로 검사하고, 실패하면 "충돌: 아직 이어진 구간 N개가 있음"으로 구분해 보고한다. OSM 412와 같은 분류다. (S5)
4. **배열 인덱스 패치**는 피하거나, 배열이 들어 있는 Feature(구간 `vertices`)는 그 Feature 전체를 `replace`하는 패치로 만든다(추정: Immer 패치 생성 시 `produceWithPatches` 안에서 배열 전체를 새로 대입하면 상위 경로 하나로 나올 것이다. 직접 확인하지는 않았다). (S1)
5. 불일치는 **전부 모아서** 한 번에 보여 준다(OSM은 첫 오류에서 멈춘다. 캠포는 사람이 읽는 CLI이므로 목록이 낫다). (S6)
6. 여러 파일 적용은 "파일 순서대로, 앞 파일 적용 후 상태 기준 비교, 하나라도 실패하면 전체 중단"으로 정하고 SPEC에 쓴다. 같은 Feature를 두 파일이 건드리는 것은 두 번째에서 충돌로 나오게 한다. 해당 의도라면 사람이 changeset을 합치게 한다. (S3)
7. 충돌 보고에 종류를 붙인다: `stale`(rev 다름), `missing`(대상 없음), `id_exists`(새 id 중복), `still_referenced`(지울 수 없음), `invalid`(적용 후 검사 실패).
8. `source`를 `report:<id>` 문자열 하나가 아니라 `report_ids: string[]`(또는 `source: "report"` + `report_ids`)로 바꾼다. (S7)

### 5.2 제보 상태 설계 (SPEC 7.3 보완안)

MapRoulette 구조를 캠포 용어로 옮긴 제안이다(제안이지 확인된 사실이 아니다).

| 캠포 상태 | MapRoulette 대응 | 뜻 | 대기열에 남는가 |
|---|---|---|---|
| `new` | Created | 방금 들어옴 | 예 |
| `triaged` | (없음, 검수 대기에 가까움) | 종류와 위치 분류 완료, 처리 대기 | 예 |
| `skipped` | Skipped | 지금은 안 봄 | 예 |
| `needs_survey` | Too_Hard | 책상에서 판단 불가, 현장 확인 필요 | 예 |
| `applied` | Fixed | 지도 원본(changeset) 또는 overrides에 반영 | 아니오 |
| `already_fixed` | Already_Fixed | 이미 데이터가 맞음 | 아니오 |
| `rejected` | False_Positive / Not an Issue | 제보가 틀렸거나 근거 부족 | 아니오 |
| `duplicate` | (bundle의 일반 구성원과 비슷) | 대표 제보에 합침 | 아니오 |
| `expired` | (없음, 캠포 고유) | 일시 제보의 `until`이 지나 overrides에서 풀림 | 아니오 |

전이 규칙(MapRoulette `isValidStatusProgression`을 본뜸):

- `new`에서는 어디로든 갈 수 있다.
- 끝난 상태(`applied`, `already_fixed`, `rejected`, `duplicate`, `expired`)는 기본적으로 바꾸지 않는다. 바꾸려면 명시적 "다시 열기"(`allowChange` 같은 플래그)로 `new`로 돌린다. MapRoulette는 Fixed/Already_Fixed에 `allowChange`를 요구하고 Deleted/Disabled는 Created로만 돌아간다.
- `skipped`, `needs_survey`는 `applied`, `already_fixed`, `rejected`, `skipped`, `needs_survey`로 갈 수 있다.
- 상태 변경은 이력(누가, 언제)을 남긴다. 검수는 별도 필드를 두지 않고 `applied`일 때 PR 링크를 남긴다. 작업 상태와 검수 상태를 분리한 MapRoulette 구조를 단순화한 것이다.

묶기 설계:

- 제보에 `bundle_id`(문자열)와 `is_primary`(불리언)를 둔다. 기준: 종류가 같고, 같은 Feature(또는 같은 범위에서 N m 안)를 가리킨다(N은 사람이 정할 값, 추정으로 8m 정도).
- 대표 제보 하나가 changeset의 `report_ids` 첫 항목이고, 나머지는 `duplicate`로 두면서 같은 `bundle_id`를 가진다.
- 묶음에서 개별 제보를 빼면(unbundle) `new`로 돌아간다.
- MapRoulette에서 묶음 상태 변경이 전체에 적용된다는 말은 2차 출처뿐이므로, 캠포는 "대표의 상태가 바뀌면 구성원은 `duplicate` 유지, 구성원은 개별 변경 불가"처럼 단순하게 정하고 사람이 확인한다.
- 일시 제보(`elevator_out`, `door_locked`, `construction`)는 묶기보다 "같은 `feature_id`의 활성 override가 있으면 `duplicate`"로 처리하는 편이 간단하다(추정, 설계 제안).

### 5.3 문 자동 연결(SPEC 6.1 `attachDoor`)

- 실내 전용 선행 도구를 못 찾았으므로(2.4) 캠포 구현이 새 연산이다. SPEC 6장의 설계는 GRASS `v.net connect -s`와 JOSM Join Node to Way의 "임계 거리 안에서 가장 가까운 선에 붙인다" 개념과 같은 계열이라서 방향이 틀리지 않는다.
- 임계 거리(`maxDist` 8m)를 필수 인자로 둔 것은 GRASS의 `threshold` 필수 규칙과 같다. 좋은 선택이다.
- 이 점은 "SPEC이 틀림"이 아니라 "참고할 선행 구현이 없으므로 테스트를 스스로 두껍게 만들어야 한다"는 뜻이다. 속성 테스트(D2)에 attachDoor 후 I1~I5와 되돌리기(I6)를 포함시킨다.
- 다음에 더 찾아볼 곳(이번에 못 본 것): indrz 소스(`indrz-be`), kosmindoormap 소스, Ineditor Desktop v2.0 소스, JOSM IndoorHelper 소스, pgRouting 문서의 점-선 연결 예제.
