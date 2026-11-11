# v0.1 길찾기 점검 결과 (작업 2)

대상: packages/core/src/graph.ts, route.ts, costs.ts, route-text.ts. 코드는 고치지 않았다.
테스트: packages/core/test/routing/audit.test.ts, fixture: packages/core/test/routing/fixtures/audit.ts.
정상은 `it`, 결함은 v0.2 기대값을 단언하는 `it.fails`. 결함 행 16개 = `it.fails` 16개.

## 번호
점검표 밖 결함은 R17부터 붙였다. R13~R16은 SPEC-v0.2 3.7에 이미 있다(R16은 커밋 ee21e82).

## ngraph 동작 다섯 가지 (SPEC-v0.2 3.3)
설치본(ngraph.path 1.6.1, ngraph.graph 20.1.2)으로 다시 돌린 결과는 SPEC 기록과 같다.

| 항목 | 지금 코드 | 판정 |
|---|---|---|
| oriented | route.ts:44 `oriented: true` | 정상 (R2) |
| multigraph | graph.ts:54 `createGraph({ multigraph: true })` | 정상 (R3) |
| 결과 뒤집기 | route.ts:62 `.find(...).reverse()` | 정상 (R5) |
| `[도착점]` 하나 | route.ts:64 `path[0].id !== fromId`이면 no-route | 정상 (R13) |
| 방향별 비용 | route.ts:46-47 인자를 무시하고 `link.data.cost`를 씀. 방향마다 링크를 따로 넣음(graph.ts:79-80, 92-93, 102-103) | 정상 (R14) |

## v0.1 "경로 없음" 테스트(route.test.ts:94)가 실제로 검사하는 것
GATE → n_B_1_hall (step_free). n_B_1_hall 자신의 구간은 step_free:true 복도 두 개다. 막힌 것은 그 한 칸 바깥이다. 포탈 e_portal_B_1_main(step_free:false) 너머의 n_B_1_main과, 계단 e_B_1_stair__B_2_stair 너머의 n_B_1_stair다.
ngraph aStar는 blocked 검사보다 먼저 이웃을 탐색 목록에 넣는다(a-star.js:110-119). 그래서 두 지점이 거리 Infinity로 들어가고, 펼쳐질 때 n_B_1_hall도 들어간다. 꺼낼 때 도착점이라 부모 없이 `['n_B_1_hall']`을 돌려준다.
원래 `find()` 결과가 길이 1 배열임을 R13 두 번째 테스트에서 단언했다. v0.1 테스트는 route.ts:64의 `path[0]` 검사 덕분에 진짜로 통과한다. 길이 0만 봤다면 실패했을 것이다.

## 점검표

| 번호 | 지금 동작 | 판정 | 근거 파일:줄 | 테스트 이름 |
|---|---|---|---|---|
| R1 | 탈 때 board 비용 한 번, 층마다 ride 비용. (1→7) − (1→2) = 5 × ELEVATOR_FLOOR_COST, 시간도 5 × ELEVATOR_FLOOR_S(±6초) | 정상 | graph.ts:75-83, 92 | R1: elevator wait is paid once per ride (1→7 minus 1→2 is five floors of riding) |
| R2 | 일방 구간은 반대로 못 감 | 정상 | route.ts:44, graph.ts:103 | R2: a one-way edge is not walked backwards |
| R3 | 계단+경사로 링크 둘 다 있음. shortest는 계단, step_free는 경사로 | 정상 | graph.ts:54, route.ts:122-130 | R3: parallel steps + ramp between the same two points both survive |
| R4 | 무작위 그래프 200개 × 5쌍 × 2프로필에서 A* 비용 = 다익스트라 비용. 단 clamp(R20) 덕분이다 | 정상 | graph.ts:68-73, route.ts:48 | R4: A* cost equals Dijkstra cost on 200 seeded random graphs |
| R5 | 출발점 → 도착점 순서 | 정상 | route.ts:62 | R5: route nodes run from start to end |
| R6 | 비용이 미터 환산이고 `timeSec`이 없다. 1→7층은 비용 60, 54초(v0.2: 67초) | 결함 | costs.ts:2, 9-30, route.ts:15-20 | R6: one unit, seconds: elevator 1→7 has timeSec 67 (40 + 6×4 + 3) and cost in the same unit |
| R6 | 비용과 시간을 나누지 않아 벌점을 시간에서 뺄 수 없다(이 테스트는 R7도 고쳐야 통과) | 결함 | route.ts:85, 113-115 | R6: timeSec does not include the step_free penalty (cost − timeSec = 60 s for one unknown corridor) |
| R7 | step_free:null 복도가 계단 없는 길을 막는다 | 결함 | costs.ts:45, 58 | R7: step_free: null indoor corridor does not block the step_free route |
| R7 | step_free가 빠진 복도도 막는다 | 결함 | costs.ts:45 | R7: indoor corridor without a step_free value does not block the step_free route |
| R8 | overrides가 없어 고장 엘리베이터를 그대로 쓴다 | 결함 | (없음) graph.ts:53, route.ts:55 | R8: an elevator marked broken in overrides is blocked in both profiles |
| R9 | 1→7층 엘리베이터 구간 6개가 이어져 나온다. 정차마다 board 링크 하나라 다시 타면 또 기다림 | 정상 | graph.ts:75-83 | R9: a multi-floor ride stays in the car (no alight and re-board on the way) |
| R10 | tower7, bridgeOffset(두 가지)에서 층 값을 지워도 경로가 같다 | 정상 | route.test.ts:150 (유지) | R10: tower7 and bridgeOffset give the same routes after every level value is deleted |
| R11 | 같은 지점이면 `[from]`, 비용·거리 0. 없는 id와 `car:` id는 unknown-node | 정상 | route.ts:56-65 | R11: same start and end gives a zero route; unknown ids give unknown-node |
| R12 | `findNearest`가 없다 | 결함 | (없음) index.ts | R12: findNearest picks the restroom with the lowest travel cost, not the straight-line nearest |
| R13 | ngraph의 `[도착점]`을 no-route로 바꾼다 | 정상 | route.ts:64 | R13: a target reached only through blocked links is "no route", not the [target] array ngraph returns |
| R13 | v0.1 테스트 대상에서 원래 결과가 길이 1임을 확인 | 정상 | route.ts:64, route.test.ts:94 | R13: the v0.1 "no route" test really hits the [target] case (campus-basic GATE → n_B_1_hall) |
| R14 | 방향마다 따로 둔 링크 비용을 그 링크에서 읽는다. board 30 / alight 0 | 정상 | route.ts:46, graph.ts:79-80 | R14: direction-dependent costs are read per link (from → to), not swapped |
| R15 | `fewest_steps` 프로필이 없다(지금 넣으면 NaN 비용, R21) | 결함 | costs.ts:5 | R15: fewest_steps profile finds the route and counts the unavoidable steps (600 s penalty in cost only) |
| R15 | step_free가 실패해도 대체 경로와 "계단 N곳" 문장이 없다 | 결함 | route.ts:64-66 | R15: step_free with no route falls back to fewest_steps and says how many steps cannot be avoided |
| R16 | A동 3층 ↔ C동 5층 연결통로를 두 프로필 모두 쓴다 | 정상 | graph.ts:85-104 | R16: routing uses a bridge between floors with different numbers (A동 3층 ↔ C동 5층) |
| R16 | 끝에 계단이 있는 다리는 step_free에서 막히고 shortest는 쓴다 | 정상 | costs.ts:38-39 | R16: a bridge that ends in steps is blocked for step_free and still used by shortest |
| R16 | 문장이 "A동 3층 → 연결통로 → C동 5층" | 결함 | route-text.ts:47 | R16: bridge sentence reads "A동 3층 연결통로를 건너 C동 5층으로" (문장) |
| R17 | 엘리베이터 비용이 level_from/level_to 차이로 정해진다. 1→7 한 구간짜리는 80, 층 값을 지우면 55 | 결함 | costs.ts:81-86, graph.ts:90, route.ts:94 | R17: express elevator cost unchanged when levels are stripped |
| R17 | 소스 검사(route.test.ts:175)가 graph.ts·route.ts만 본다. costs.ts에 level이 있다. route-text.ts는 표시용이라 예외 | 결함 | costs.ts:3, 81-86 | R17: no level reads in routing source (graph.ts, route.ts, costs.ts, src/routing/**; route-text.ts exempt) |
| R18 | 사이 지점이 갈라져도 계단을 합친다("T동 1층 → 계단 → 4층" 한 문장) | 결함 | route-text.ts:37-45 | R18: stairs are not merged across a landing where a corridor branches off (갈림) |
| R18 | incline을 읽지 않고 방향어가 없다 | 결함 | route-text.ts:42-44 | R18: merged stairs use the direction word from incline, read against travel direction (방향어) |
| R19 | 경사로는 step_free:false여도 무조건 통과. v0.1 SPEC §6 표와는 맞지만 v0.2 2.1(false = 계단·턱 있음)과 다르다. 엘리베이터도 같다. **결정: v0.2 2.1을 따라 경사로·엘리베이터도 false면 step_free에서 막는다. v0.1 데이터의 기본값 false는 작업 3 마이그레이션이 정리한다(docs/decisions.md)** | 결함 | costs.ts:40-42 | R19: a ramp marked step_free: false (has a step or sill) is blocked for step_free |
| R20 | 비용을 직선거리 아래로 못 내려가게 clamp해서 데이터 오류를 조용히 덮는다. 끝점이 99m 어긋난 구간이 비용 99.9, distanceM 1, durationMin 0으로 쓰인다. 데이터 오류는 검사(I2)가 잡을 일이다 | 결함 | graph.ts:68-73 | R20: an edge whose line does not reach its nodes is reported or left out, not silently priced by the clamp |
| R21 | 알 수 없는 프로필 이름이면 `found: true`에 cost NaN이다(`blocked`가 `=== Infinity`만 본다) | 결함 | route.ts:46-47 | R21: an unknown profile name is rejected instead of returning a route with NaN cost |

## 결정 사항
- R19: v0.2 2.1 뜻을 따른다(위 표, decisions.md).
- R4/R20: v0.2에서 clamp를 없애고 구간 길이는 지점 좌표에서 계산한다(SPEC-v0.2 3.1). R4는 지금 clamp 덕분에 통과하므로, clamp를 없앨 때 이 테스트로 다시 확인한다.
- R21: 모르는 프로필은 `unknown-profile` 오류로 처리한다. 작업 4에서 고친다.

## 참고 (결함으로 세지 않음)
- graph.ts:87: from/to가 없는 구간은 건너뛴다. 편집 중 미리보기를 위한 의도된 동작이고 주석에 적혀 있다. 검사 E3이 잡는다.
- route-text.ts:42-44: 같은 층 계단은 "C동 5층 → 계단 → 5층"처럼 나온다. 층 값을 지우면 "X동 → 엘리베이터 → X동"이 된다. 표시 문제이며 R18 재작성 때 함께 본다.
