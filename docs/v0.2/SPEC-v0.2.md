# 캠포 편집기·길찾기 v0.2 명세 (변경분)

이 문서는 docs/SPEC.md(v0.1)에 덧붙이는 변경분이다. 작업 3(스키마)에서 승인되면 SPEC.md 본문에 합치고 이 파일은 지운다.
v0.2의 목표는 두 가지다. 한 층을 몇십 번의 클릭으로 입력할 수 있게 하는 것, 그리고 나중에 들어올 제보를 같은 편집 엔진으로 빠르게 반영할 수 있게 하는 것.

---

## 1. 완료 기준

| # | 기준 | 확인 방법 |
|---|---|---|
| D1 | 길찾기 점검표 R1~R16이 모두 테스트로 고정되고 통과 | `npm test` |
| D2 | 아무 편집을 몇 번 하든 불변식 I1~I6 위반 0 | fast-check 속성 테스트 1,000회 |
| D3 | 건물 층 작업 중 모드 전환 없이 바깥 길을 그리고 포탈을 이음 | Playwright 시나리오 |
| D4 | "여기서 가장 가까운 휠체어 화장실" 길찾기 | 단위 테스트 + 편집기 길찾기 탭 |
| D5 | 강의실 20개·문 30개짜리 층을 복도 그리기 포함 **클릭 60번 이하**, 키보드 입력은 시작 호실 번호 한 번으로 완성 | Playwright 시나리오가 클릭 수를 세어 보고 |
| D6 | 변경 묶음(changeset) 파일을 `npm run apply -- <파일> --dry-run`으로 미리 보고 적용 | CLI 테스트 |

---

## 2. 데이터 모델 변경

`campus.json`에 `"schema_version": "0.2"`를 넣는다. v0.1 데이터는 `npm run migrate`로 한 번에 바꾼다.

### 2.1 `step_free`를 세 가지 값으로

| 값 | 뜻 |
|---|---|
| `true` | 현장에서 확인한 무단차 |
| `false` | 계단·턱이 있음 |
| `null` | 모름 (새로 그린 구간의 기본값) |

- 기본값: `highway=steps`는 `false`, `highway=elevator`는 `true`, 나머지는 `null`.
- 이유: v0.1은 실내 구간 기본값이 `false`라서, 계단 없는 길찾기가 확인 안 된 실내 복도를 전부 막을 수 있다(점검표 R7). "모름"과 "계단 있음"을 구분해야 한다.
- 마이그레이션: `step_free: false`이면서 `highway`가 `steps`가 아니고 `source`가 `field-survey-`로 시작하지 않으면 `null`로 바꾼다.
- `needs_check`는 그대로 둔다. 사람이 "다시 봐야 함"이라고 표시한 깃발이다.

### 2.2 엘리베이터

- 같은 엘리베이터의 정차 지점(`node_type: elevator_stop`)에는 모두 같은 `elevator_id`를 단다. 예: `"A-EV1"`
- 데이터의 `highway=elevator` 구간은 "이 두 층 사이를 운행한다"는 뜻만 가진다. 비용은 길찾기 그래프를 만들 때 3장 방식으로 다시 계산한다.
- 엘리베이터 정차 지점을 하나 끌면 같은 `elevator_id`의 정차 지점이 모두 함께 움직인다. 같은 승강로이기 때문이다.

### 2.3 화장실 `node_type: restroom` (새로 추가)

| 속성 | 값 | OSM 대응 |
|---|---|---|
| `restroom_gender` | `male` / `female` / `unisex` / `family` | `male=yes`, `female=yes`, `unisex=yes` |
| `wheelchair` | `yes` / `limited` / `no` / `unknown` | `wheelchair=*` |
| `changing_table` | `true` / `false` / `null` | `changing_table=*` |
| `name`, `ref` | 문자열, 선택 | 같음 |

- 남자·여자 화장실이 붙어 있어도 지점은 각각 하나씩 찍는다.
- 화장실 지점은 구간으로 복도에 이어져 있어야 한다(검사 E10).
- `wheelchair: yes`는 현장에서 확인했을 때만 쓴다. OSM 위키도 `wheelchair=yes`가 실제 사용 가능성을 보장하지 않는다고 적고 있다. 그래서 확인하지 않았으면 `unknown`이다.

### 2.4 문과 강의실

- 문(`node_type: door`)에 두 속성을 추가한다.
  - `room_ref`: 호실 번호(문자열), 예: `"301"`
  - `door_role`: `front` / `back` / `other`
- 강의실 지점(v0.1의 `poi`)은 그대로 둔다. 필요하면 강의실 영역 `kind: room`(Polygon)을 추가할 수 있다. 영역이 있으면 문 자동 배치 매크로가 그 영역을 입력으로 쓴다.
- 앞문과 뒷문은 지도만 보고 자동으로 판단할 수 없다. 매크로는 정해진 규칙으로 먼저 정하고(6장), 사람이 `F` 키로 뒤집는다.

### 2.5 변경 이력용 속성

- 모든 Feature에 `rev`(정수)를 단다. 바뀔 때마다 1씩 늘린다. 제보로 만든 변경 묶음이 옛날 데이터를 기준으로 만들어졌는지 알아내는 데 쓴다.
- 일시적인 상태(엘리베이터 고장, 공사로 막힌 문)는 지도 데이터에 넣지 않는다. 대신 `data/campuses/{id}/overrides.json`에 `feature_id`, `status`, `until`(만료 시각), `report_id`로 넣는다. 길찾기가 실행될 때 합친다.
- 이렇게 나누는 이유는, 고장 제보가 들어올 때마다 지도 원본을 고치면 기록이 지저분해지고, 수리가 끝난 뒤 되돌리는 것을 잊기 쉽기 때문이다.

### 2.6 구름다리(연결통로)와 계단 방향 속성

- **계단 구간(`highway: steps`)에 선택 속성 `incline`**: `up` / `down`. 구간이 그려진 방향(`from` → `to`) 기준이다. 안내 문장(3.6)이 위/아래 방향어를 정할 때 쓴다. 층 번호 비교가 아니다.
- **실내 계단 구간(`highway: steps`, `edge_type: indoor`)에 선택 속성 `flight_sec`**(숫자, 0~30): 한 구간을 오르는 시간(초). `step_count`를 모를 때만 쓰이고(3.1 규칙 2), 없으면 기본값 18초다. 편집기는 이 값을 슬라이더로 바꾼다.
- **`bridge` 구간에 선택 속성 `covered`**(boolean): 지붕이 있는지. 이 속성은 v0.1 스키마의 `edge` 선택 속성에 이미 있다(SPEC.md 4.2). v0.2에서는 연결통로에도 쓴다는 점만 분명히 한다.
- **건물에 선택 속성 `building_type: "bridge"`**: 구름다리를 건물처럼 등록한 것. 층은 1개다.
- **구름다리 처리 방침**: 두 건물을 잇는 구름다리는 `edge_type: bridge` 구간 하나로 표현한다(`building_from`, `building_to`, `level_from`, `level_to` 필수). 다리 중간에 지점이 필요하면(안내 지점, 문, 계단 등) 다리를 `building_type: "bridge"` 건물(층 1개)로 등록하고, 양쪽 건물과는 `bridge` 구간으로 잇는다.
- 층 번호가 다른 두 건물(A동 3층 ↔ C동 5층)도 `level_from` / `level_to` 값만 다르게 두면 이어진다. 길찾기는 층 번호를 비교하지 않고 구간 연결만 따른다.
- 이 속성들을 `data/schema/campo.schema.json`, fixture, 테스트에 넣는 일은 스키마 작업(작업 3)에서 한다. 이 문서는 명세만 바꾼다.

### 2.7 에스컬레이터 (`conveying`)

OSM 방식을 따른다. 에스컬레이터는 **움직이는 계단**이다.

| 속성 | 값 | 뜻 |
|---|---|---|
| `highway` | `steps` | 계단과 같은 종류 |
| `conveying` | `forward` / `backward` / `reversible` | 움직이는 방향. 구간을 그린 방향(`from` → `to`) 기준. `reversible`은 시간에 따라 방향이 바뀜 |
| `step_free` | 항상 `false` | 휠체어는 못 탄다(검사 E12) |
| `bidirectional` | `forward` / `backward`는 `false`, `reversible`은 `true` | `conveying`이 방향을 정한다. 스키마가 이 짝을 강제한다 |

- 상행과 하행 에스컬레이터는 **구간 두 개**로 그린다. 같은 두 지점을 잇는 평행 구간이다(multigraph라 문제없음). 하행은 같은 방향으로 그리고 `conveying: backward`로 하거나, 반대 방향으로 그리고 `forward`로 한다.
- 바깥 에스컬레이터와 실내 에스컬레이터는 데이터가 같다. 범위(바깥 / 건물+층)만 다르다.
- 무빙워크(평지)는 `highway: footway` 또는 `corridor` + `conveying`으로 같은 규칙(방향)을 쓴다. 시간은 걷는 시간 그대로다.
- `conveying`은 `steps`, `footway`, `corridor`에만 쓸 수 있다(스키마).
- `conveying`이 없는 계단은 보통 계단이다. 기존 데이터는 바뀌지 않는다.
- 세 값이 아닌 `conveying`(검사 전 데이터)은 스키마 오류이고, 길찾기는 `conveying`이 없는 것으로 다룬다(`costs.ts`의 `conveyingOf`). 링크 방향과 시간 규칙이 같은 판단을 쓴다.
- `incline`은 안내 문장의 방향어(3.6)에만 쓴다. 에스컬레이터에는 내리막 시간 계수(3.1 규칙 4)를 쓰지 않는다. 벨트 속도가 일정하기 때문이다.

---

## 3. 길찾기 v0.2

### 3.1 비용 단위는 초(秒) 하나로 통일

v0.1은 "길이×1.5+15"(미터처럼 보임)와 "30+5/층"(초처럼 보임)이 섞여 있었다. 단위가 섞이면 비교 결과를 믿을 수 없고, A* 휴리스틱이 허용 가능(admissible)한지도 따질 수 없다.

`packages/core/src/costs.ts` (상수는 이 파일 하나에만 둔다. `validate.ts`가 같은 파일의 `isStepFreePassable`을 쓰므로 `routing/` 아래가 아니라 `src/` 바로 아래에 둔다)

| 상수 | 값 | 비고 |
|---|---|---|
| `WALK_SPEED_MPS` | 1.2 | |
| `RAMP_FACTOR` | 1.2 | 시간 = 길이 / 속도 × 계수 |
| `STEP_SEC` | 0.55 | 계단 한 칸 오르는 시간. 바깥 계단이 아니고 `step_count`가 있을 때(규칙 1) |
| `FLOOR_FLIGHT_SEC` | 18 | 칸 수를 모르는 실내 계단 구간 하나를 오르는 기본 시간(규칙 2). 구간마다 `flight_sec`으로 바꿀 수 있다 |
| `FLIGHT_SEC_MIN` / `FLIGHT_SEC_MAX` | 0 / 30 | `flight_sec`의 범위. 편집기 슬라이더와 스키마가 같은 범위를 쓴다 |
| `OUTDOOR_STAIRS_SEC_PER_M` | 2 | 바깥 계단을 오르는 시간, 평면 길이 1m당 초(규칙 3). 지금은 평면 길이만 보며, 이 관계식은 나중에 바뀔 수 있다 |
| `OUTDOOR_STAIRS_MIN_SEC` | 10 | 바깥 계단의 최소 시간(규칙 3) |
| `DOWNHILL_STAIRS_FACTOR` | 2/3 | 계단을 내려갈 때 시간 계수(규칙 4) |
| `ESCALATOR_SPEED_MPS` | 0.5 | 에스컬레이터 벨트 속도(경사 방향). 분당 30m. 걸어 오르지 않고 서서 타는 것으로 가정한 처음 예측값 |
| `ESCALATOR_BOARD_SEC` | 3 | 타고 내리는 시간 |
| `ESCALATOR_MIN_SEC` | 8 | 평면 길이를 너무 짧게 그렸을 때의 하한 |
| `ESCALATOR_SLOPE_DEG` | 30 | 국내 에스컬레이터 경사 대부분 30°. 경사 길이 = 평면 길이 ÷ cos(30°) |
| `ELEVATOR_BOARD_SEC` | 40 | 기다리고 타는 시간. 한 번 탈 때 **한 번만** 더한다 |
| `ELEVATOR_HOP_SEC` | 4 | 한 층 운행할 때마다 |
| `ELEVATOR_ALIGHT_SEC` | 3 | |
| `PORTAL_SEC` | 2 | |
| `UNKNOWN_STEP_FREE_PENALTY_SEC` | 60 | step_free 프로필에서만 적용하는 선호 비용 |
| `FEWEST_STEPS_STAIRS_PENALTY_SEC` | 600 | fewest_steps 프로필에서 계단 구간마다 더하는 선호 비용(3.4) |
| `FEWEST_STEPS_ESCALATOR_PENALTY_SEC` | 60 | fewest_steps 프로필에서 에스컬레이터 구간마다 더하는 선호 비용(계단의 1/10, 3.4) |
| `CALIBRATION_K` | 3 | 측정값과 섞을 때 예측값의 무게(3.9) |
| `OUTLIER_RATIO` | 3 | 예측값의 1/3보다 작거나 3배보다 큰 측정값은 버린다(3.9) |

**계단 구간(`highway: steps`)의 시간**은 구간 길이가 지점 좌표에서 나온다는 점 때문에 별도 규칙이 필요하다. 실내 계단의 두 지점은 거의 같은 자리에 있어서 길이만으로는 한 층이 2초 남짓이 된다. 아래 순서로 올라갈 때의 시간을 정하고(규칙 0은 에스컬레이터), 계산은 `costs.ts`의 함수 하나(`stairsTimeSec`)에 모은다. 걷는 시간(평면 길이 ÷ 속도)은 따로 더하지 않는다. 계단 시간이 그 구간의 전체 시간이다.

0. `conveying`이 있으면(에스컬레이터, 3.8) 다른 규칙보다 먼저 `max(평면 길이 ÷ cos(ESCALATOR_SLOPE_DEG) ÷ ESCALATOR_SPEED_MPS + ESCALATOR_BOARD_SEC, ESCALATOR_MIN_SEC)`. 방향과 상관없이 같고, 내리막 계수(규칙 4)는 곱하지 않는다
1. 바깥 계단(`edge_type: outdoor`)이면 `step_count`와 상관없이 `평면 길이(m) × OUTDOOR_STAIRS_SEC_PER_M`, 단 `OUTDOOR_STAIRS_MIN_SEC` 이상. 바깥 계단은 지금은 평면 길이만 본다.
2. 실내 계단(양 끝이 `stair_landing`, `edge_type: indoor`)이면 `step_count`가 있을 때 `step_count × STEP_SEC`, 없으면 구간의 `flight_sec`(0~30초), 그것도 없으면 `FLOOR_FLIGHT_SEC`(18초)
3. 그 밖의 계단(바깥도 아니고 실내 계단 구간도 아닌 경우)은 `step_count × STEP_SEC`, `step_count`가 없으면 규칙 1의 평면 길이 식
4. 내려갈 때는 위 시간에 `DOWNHILL_STAIRS_FACTOR`(2/3)를 곱한다. 오르는지 내리는지는 구간의 `incline`(2.6)과 지나가는 방향으로만 정한다(`incline`이 `up`인 구간을 `to`에서 `from`으로 가면 내리막). `incline`이 없으면 오르막으로 본다. 층 번호는 보지 않는다.

상수는 모두 `costs.ts` 한 곳에 둔다. 평면 길이와 시간의 관계식(규칙 1)은 나중에 바뀔 수 있으므로 계산을 `stairsTimeSec` 한 곳에 모아 둔다. 나중에 고도 데이터로 칸 수를 추정하는 단계를 끼울 수 있다(9장 후속 과제). `flight_sec`은 실내 계단 구간에만 쓸 수 있고(2.6), `step_count`가 있으면 무시한다.

- 결과에는 **실제 예상 시간**(`timeSec`)과 **탐색 비용**(`cost`)을 따로 낸다. 선호 때문에 붙인 벌점이 예상 시간에 섞이면 안 된다.
- 휴리스틱은 측지 직선거리 ÷ 휴리스틱 속도다. 휴리스틱 속도는 `WALK_SPEED_MPS`와 "모든 구간의 평면 길이 ÷ 시간" 중 가장 큰 값 가운데 큰 쪽이다(`buildGraph`가 계산한다). 계단 구간은 걷는 시간보다 짧을 수 있어서 `WALK_SPEED_MPS`만 쓰면 과대 추정이 되기 때문이다. 이렇게 하면 허용 가능하다. 구간 길이는 항상 좌표에서 계산하고, 사람이 손으로 넣은 길이 값은 쓰지 않는다.

### 3.2 엘리베이터 펼치기 (OpenTripPlanner의 board / hop / alight 방식)

`buildGraph`가 엘리베이터 정차 지점 `s`마다 가상 지점 `~car:s`를 만든다.

```
s ──board(40s)──▶ ~car:s ──alight(3s)──▶ s
~car:a ◀──hop(4s)──▶ ~car:b   (데이터에 a–b highway=elevator 구간이 있을 때만)
```

- 기다리는 비용은 탈 때 한 번만 든다. 1층에서 7층까지는 40 + 6×4 + 3 = 67초다.
- v0.1처럼 구간마다 "30+5"를 더하면 6개 층을 갈 때 기다리는 비용이 6번 붙어 210초가 되고, 엘리베이터가 실제보다 훨씬 나빠 보인다. 또 층마다 엘리베이터에서 내렸다가 계단으로 갈아타는 이상한 경로가 나올 수 있다(점검표 R1).
- 층 순서는 데이터에 그려진 엘리베이터 구간으로만 정한다. **층 번호는 비교하지 않는다.**
- 가상 지점은 정차 지점과 같은 좌표에 둔다. 휴리스틱 계산이 필요하기 때문이다.
- OpenTripPlanner 현재 코드(`ElevatorBoardEdge`, `ElevatorHopEdge`, `ElevatorAlightEdge`)도 같은 구조다.
  - 탈 때: 탑승 비용 + 탑승 시간
  - 층마다: 운행 시간. 휠체어 요청이면 접근성 정보가 없는 엘리베이터에 `unknownCost`를 더한다
  - 내릴 때: 거의 0
- Valhalla는 엘리베이터 비용을 층 번호 차이로 계산한다(층당 5초). 캠포는 층 번호를 비교하지 않으므로 이 방식은 쓰지 않는다.

### 3.3 그래프 옵션 (ngraph)

아래는 ngraph.path 1.6.1 / ngraph.graph 20.1.2 소스를 읽고, 작은 스크립트로 직접 실행해서 확인한 동작이다.

| 확인한 동작 | 결과 | 대응 |
|---|---|---|
| `oriented`를 안 주면 | 기본값이 없어서(undefined) 방향을 무시한다. A→B만 있어도 B→A 경로가 나온다 | `oriented: true` (R2) |
| multigraph가 아닌 그래프에 같은 두 지점 링크를 또 넣으면 | 링크 1개, 데이터만 덮어씀 | `createGraph({ multigraph: true })` (R3) |
| `find()` 결과 순서 | 도착점 → 출발점 (`["C","B","A"]`) | 뒤집어서 출발점부터 낸다 (R5) |
| **도착점이 막힌 구간으로만 이어질 때** | 빈 배열이 아니라 **도착점 하나만 든 배열** `["C"]`. `blocked()`로 막아도, 비용을 `Infinity`로 줘도 같다 | 결과의 마지막 지점이 출발점인지 확인하고, 아니면 "경로 없음"으로 처리 (R13) |
| `distance(a, b, link)`, `blocked(a, b, link)`의 인자 순서 (**aStar 기준**) | `a`가 다음 지점, `b`가 현재 지점이다 (A→B 탐색 때 `a=B, b=A`) | 방향에 따라 비용이 다른 구간(board/alight, 오르막 계단)은 인자 순서가 아니라 `link.fromId` / `link.toId`로 판단 (R14) |

- **탐색기는 aStar를 쓴다.** nba(양방향)는 쓰지 않는다. 설치본(ngraph.path 1.6.1)으로 직접 실행해 확인한 차이는 다음과 같다.
  - nba는 막힌 도착점에서 `[]`를 돌려준다(aStar는 `[도착점]`). 그래서 nba에는 R13 함정이 없다.
  - nba는 출발점 = 도착점이면 `[]`를 돌려준다(aStar는 `[출발점]`). R11을 직접 처리해야 한다.
  - nba는 `distance`/`blocked` 인자가 (탐색 중인 지점, 이웃)이라 위 순서와 다르고, 역방향 탐색이 먼저 돈다.
  - aStar를 쓰더라도 R13 결과 검사(결과의 마지막 지점이 출발점인지)는 유지한다.
- 양방향 구간은 링크를 두 개 넣는다.
- 지나갈 수 없는 구간은 `blocked()`로 막는다. 비용을 `Infinity`로 주는 방식은 쓰지 않는다. 결과가 같더라도 의도가 드러나지 않는다.
- v0.1의 "계단만 있는 곳 → 경로 없음" 테스트가 통과했다면, `find()` 결과를 길이 0으로 검사했는지, 아니면 우연히 다른 이유로 통과했는지 확인한다. 길이 0만 검사했다면 그 테스트는 실제로는 `["C"]`를 받고 실패했어야 한다.

### 3.4 프로필

| 프로필 | 계단 | 에스컬레이터 | `step_free: null` | 고장(overrides) |
|---|---|---|---|---|
| `shortest` | 시간 비용 | 시간 비용 | 그대로 | 막음 |
| `step_free` | 막음 | 막음 | +60초 벌점, 결과에 `uncertainSegments`로 표시 | 막음 |
| `fewest_steps` (대체) | +600초 벌점 | +60초 벌점(계단의 1/10) | 그대로 | 막음 |

- `step_free`로 경로가 없으면 `fewest_steps`로 한 번 더 찾는다. 결과에 "계단 N곳을 피할 수 없습니다"를 붙여서 낸다. 600초는 Valhalla 보행 비용의 휠체어 계단 벌점 기본값이다.
- Valhalla도 계단·엘리베이터 벌점을 비용에만 더하고 시간에는 더하지 않는다(`{penalty, 0}`). 3.1의 `cost` / `timeSec` 분리와 같은 방식이다.

### 3.5 가장 가까운 시설 찾기

`findNearest(graph, fromId, predicate, profile)`

- 조건에 맞는 모든 지점에서 가상 도착점 `~sink`로 가는 비용 0 구간을 붙인다. 휴리스틱을 0으로 두고 한 번 탐색하면(다익스트라와 같음) 가장 가까운 시설이 나온다.
- 예: `n => n.node_type === 'restroom' && n.wheelchair === 'yes'`

### 3.6 안내 문장

- 이어진 엘리베이터 구간은 한 문장으로 합친다. "1층→2층, 2층→3층…" 대신 "엘리베이터를 타고 4층으로 가세요".
  - OpenTripPlanner처럼 문장은 내리는 구간(alight)에서 한 번만 만든다. 타는 구간(board)과 층 이동(hop)은 문장을 만들지 않는다.
- **이어진 계단 구간도 한 문장으로 합친다.** 합치는 규칙은 캠포가 정한 것이다(OpenTripPlanner는 계단을 구간마다 문장 하나로 만들고 합치지 않는다). "이어졌다"는 계단 구간이 지점을 사이에 두고 연속하고, 사이 지점에 다른 구간이 갈라지지 않는 경우다. 예: "계단으로 3층 올라가세요".
- **방향어(올라가세요 / 내려가세요)는 다음 순서로 정한다.**
  1. 계단 구간의 `incline`(`up` / `down`, 구간 방향 기준, 2.6)이 있으면 그것을 쓴다. 이어진 구간은 구간 방향으로 뒤집어 읽는다.
  2. 없으면 표시용으로만 두 끝 지점의 `level` 이름을 비교한다. 이것은 길찾기가 아니라 안내 문장 표시이므로 AGENTS.md의 층 비교 금지 규칙은 길찾기 비용·연결 판단에만 해당한다.
  3. 그것도 안 되면 방향어를 빼고 "계단으로 3층 이동하세요"로 쓴다.
- 층 이름은 표시용으로만 데이터의 `level`을 읽는다.
- **연결통로(`bridge`) 구간**은 "A동 3층 연결통로를 건너 C동 5층으로"처럼 두 건물 이름과 층 이름을 넣어 한 문장으로 만든다. 건물 이름은 건물 `name`, 층 이름은 `level_from` / `level_to`에서 표시용으로만 읽는다.

### 3.7 길찾기 점검표 (작업 2에서 테스트로 먼저 고정)

| # | 확인할 것 |
|---|---|
| R1 | 엘리베이터 기다리는 비용이 탈 때 한 번만 든다. 1→7층이 67초 |
| R2 | 방향 있는 구간을 반대로 지나가지 않는다 |
| R3 | 같은 두 지점 사이의 평행 구간(계단+경사로)이 모두 살아 있다 |
| R4 | 휴리스틱이 허용 가능하다. 무작위 그래프 200개에서 A* 결과 비용 = 다익스트라 결과 비용 |
| R5 | 결과 지점 순서가 출발점에서 도착점으로 간다 |
| R6 | 단위가 초 하나다. `timeSec`에 벌점이 섞이지 않는다 |
| R7 | `step_free: null`인 실내 복도가 계단 없는 길찾기를 막지 않는다 |
| R8 | 고장 난 엘리베이터는 두 프로필 모두에서 막힌다 |
| R9 | 층 이동 중간에 엘리베이터에서 내렸다가 다시 타는 경로가 나오지 않는다 |
| R10 | 층 값을 모두 지워도 경로가 같다 (v0.1 테스트 유지) |
| R11 | 출발점과 도착점이 같으면 거리 0인 경로, 없는 id면 분명한 오류 |
| R12 | 가장 가까운 화장실 찾기가 거리상 더 가까운 다른 층 화장실이 아니라 실제 이동 비용이 가장 작은 화장실을 고른다 |
| R13 | 도착점이 막힌 구간으로만 이어질 때 "경로 없음"을 낸다. ngraph가 돌려주는 `[도착점]` 한 개짜리 결과를 경로로 착각하지 않는다 |
| R14 | 방향에 따라 비용이 다른 구간에서 비용이 `link.fromId` 기준으로 계산된다. A→B 비용과 B→A 비용이 바뀌어 들어가지 않는다 |
| R15 | `step_free` 실패 시 `fewest_steps` 대체 경로와 피할 수 없는 계단 수가 나온다 |
| R16 | 층 번호가 다른 두 건물을 잇는 연결통로를 길찾기가 쓴다. 끝에 계단이 있는 다리는 `step_free`에서 막힌다. 안내 문장이 "A동 3층 연결통로를 건너 C동 5층으로"처럼 나온다 |

### 3.8 에스컬레이터 길찾기

**방향.** `conveying`이 방향을 정한다(`bidirectional`은 보지 않는다).

- `forward`: 그린 방향으로만 링크 하나.
- `backward`: 반대 방향으로만 링크 하나.
- `reversible`: 양쪽 링크를 넣고, 안내 문장에 "운행 방향이 바뀔 수 있습니다"를 붙인다. 시간표(아침 상행 등)는 나중에 overrides로 다룬다.

**시간 예측값**(측정값이 없을 때)은 `stairsTimeSec` 안의 규칙 0(3.1)이다. 실내 한 층(높이 약 4m)이면 평면 길이 약 6.9m → 약 19초. 테스트 fixture(campus-basic A동 1↔2층)는 평면 약 6.67m라 약 18.4초다(테스트는 6.6~6.9m, 18~19.5초 범위로 확인).

**프로필**은 3.4 표와 같다. 고장은 엘리베이터처럼 overrides로 막는다. 멈춘 에스컬레이터를 "계단으로 쓸 수 있음"으로 바꾸는 처리는 나중에 한다.

**결과.** 에스컬레이터는 `stairsCount`에 세지 않고 `escalatorCount`(`Route`, `RouteFallback`)로 따로 센다. 무빙워크는 어느 쪽에도 세지 않는다. `step_free`가 실패해 `fewest_steps`로 대체할 때의 안내 문장:

| 경로에 있는 것 | 문장 |
|---|---|
| 에스컬레이터만 | "계단 없는 경로가 없어 에스컬레이터를 타는 경로를 안내합니다. 에스컬레이터 N곳을 피할 수 없습니다." |
| 계단과 에스컬레이터 | "계단 없는 경로가 없어 계단이 가장 적은 경로를 안내합니다. 계단 N곳, 에스컬레이터 M곳을 피할 수 없습니다." |
| 계단만 / 턱만 | 3.4와 같다(바뀌지 않음) |

턱이 있는 구간도 지나면 지금처럼 " 턱이 있는 구간 K곳도 지나야 합니다."를 덧붙인다.

**안내 문장.** "에스컬레이터를 타고 3층으로 올라가세요"(단계 종류 `escalator`). 방향어는 계단 규칙(3.6)과 같고, 층 이름이 없으면 "에스컬레이터를 타고 올라가세요", 방향어도 정할 수 없으면 "에스컬레이터를 타고 이동하세요"다. 이어진 에스컬레이터 구간은 계단과 같은 규칙으로 한 문장으로 합친다. 단 사이 지점에 닿는 **다른 에스컬레이터(반대 방향 평행 구간 등)는 갈래로 세지 않는다**. 복도 같은 다른 구간이 갈라지면 문장을 나눈다. `reversible` 구간(무빙워크 포함)이 들어 있는 단계는 문장 끝에 " (운행 방향이 바뀔 수 있습니다)"를 붙인다.

### 3.9 측정 기반 시간 보정

모든 시간 상수는 **처음 예측값(prior)** 일 뿐이다. 실제로 재어 본 값이 쌓이면 그쪽으로 옮겨 간다.

**무엇을 보정하나.**

| 대상 | `target` 형식 | 바뀌는 시간 |
|---|---|---|
| 구간 하나를 지나는 시간 | `edge:<edge id>` | 에스컬레이터, 긴 바깥 계단, 언덕길. 그린 방향 기준 |
| 구간을 반대로 지나는 시간 | `edge:<edge id>#backward` | 보정값 키에서만 쓴다. 측정 기록에서는 `direction: backward` |
| 엘리베이터 대기 시간 | `elevator:<elevator_id>` | 정차 지점의 타는 링크(`ELEVATOR_BOARD_SEC` 자리). 방향은 무시 |

**측정 기록** `data/campuses/{id}/observations/*.jsonl` (한 줄에 하나):

```json
{"target":"edge:e-ENG1-esc-up","duration_sec":21.4,"direction":"forward","source":"field","measured_at":"2026-11-12T09:10:00+09:00","note":"서서 탐"}
```

- `direction`(선택): `forward`(기본, 그린 방향) / `backward`. 구간 대상에만 뜻이 있다.
- `source`: `field`(팀원이 현장에서 잼) / `app`(나중에 앱 사용자 제보)
- 개인을 알아볼 수 있는 값(사용자 id, 기기 id, 위치 기록)은 저장하지 않는다. 스키마가 모르는 필드를 막는다. 앱에서 받을 때는 동의를 받고 시간과 대상만 남긴다.
- v0.2에서는 Git에 둔다. 앱이 생기면 Supabase 테이블로 옮기고, 같은 형식으로 내보낸다.

**보정값 계산** `npm run calibrate` → `data/campuses/{id}/calibration.json` (커밋한다). 측정이 없는 캠퍼스는 파일을 만들지 않는다.

1. **이상한 값 버리기**: 예측값의 1/`OUTLIER_RATIO`보다 작거나 `OUTLIER_RATIO`배보다 크면 버린다. 도중에 멈췄거나 잘못 누른 값이다.
2. **대표값**: 남은 값의 중앙값. `field`는 2번, `app`은 1번 센다(현장 측정을 더 믿는다). 센 개수가 짝수이면 가운데 두 값의 평균이다.
3. **예측값과 섞기**: `추정 = (K × 예측값 + n × 중앙값) ÷ (K + n)`, `K = CALIBRATION_K = 3`. n은 남은 측정 개수다(가중치 없이). 추정은 소수 한 자리로 반올림한다.
   - 측정이 1~2개면 예측값 쪽에 가깝다.
   - 10개쯤 쌓이면 거의 측정값이다.
   - 측정 하나가 튀어도 길찾기가 갑자기 바뀌지 않는다.
4. 남은 측정이 0개인 대상은 결과에 넣지 않는다. 존재하지 않는 대상의 측정은 건너뛰고(검사 W13) CLI가 알린다.
5. 결과:

```json
{"edge:e-ENG1-esc-up":{"prior_sec":19.0,"median_sec":22.0,"n":5,"estimate_sec":20.9,"updated_at":"2026-11-12"}}
```

- 길찾기는 `buildGraph(campus, { calibration })`로 받는다(기본은 `calibration.json`). `estimate_sec`가 있는 대상은 예측값 대신 그 값을 **시간**으로 쓴다. 벌점(선호 비용)은 그대로다. 그러니 `timeSec`만 바뀌고 프로필별 `cost − timeSec`는 그대로다.
- `calibration.json`이 없거나 대상이 없으면 예측값을 쓴다. 모양이 틀린 항목(`estimate_sec`가 양수인 숫자가 아님)도 무시하고 예측값을 쓴다.
- 엘리베이터는 `elevator:<elevator_id>`로 타는 링크(대기)만 보정한다. 층 이동(hop)과 내리기(alight)는 보정하지 않고, 엘리베이터 구간의 `edge:<id>`는 보정 대상이 아니다.
- 예측값은 `predictedTimeSec(graph, target, direction?)`(`graph.ts`)로 읽는다. `buildGraph(campus, { calibration: {} })`로 보정 없이 만든 그래프를 넘긴다. 반대 방향은 `target`에 `#backward`를 붙이지 않고 `direction: 'backward'`로 준다. 해당 링크가 없으면(한쪽으로만 도는 구간, 엘리베이터 구간, 없는 대상) `undefined`다.
- 계산은 `packages/core/src/calibration/`의 순수 함수, `npm run calibrate`는 `packages/tools`에 있다.

**나중에 (v0.2 범위 밖)**

- **측정 기록에 구간 rev 남기기**: 측정 줄에 그 당시 구간의 `rev`를 적고, `npm run calibrate`가 현재 rev와 다른 측정은 건너뛴다. 구간을 나누거나 모양이 바뀌면 옛 측정이 자동으로 빠진다. (편집 엔진은 지금 나누기 때 경고만 한다.)
- **시간대별 보정**: 쉬는 시간(수업 끝나고 10분) 엘리베이터 대기. `measured_at`이 이미 기록되니 데이터는 지금부터 쌓인다.
- **앱 자동 측정**: 경로 안내 중 사용자가 "다음" 버튼을 누른 시각 차이로 측정. 위치정보 동의 범위를 따른다.
- **예측 정확도 지표**: 예측값과 측정값의 차이를 검사 탭에 보여 준다.

---

## 4. 편집 엔진 `packages/core/src/edit/` (새로 추가)

iD 편집기의 구조를 따른다.

- **상태 `EditState`**: `{ nodes: Record<id, Node>, edges: Record<id, Edge>, buildings: Record<code, Building>, rooms: Record<id, Room> }`. 바꾸지 않는다(immutable). 강의실 영역(`kind: room`)은 `rooms`에 둔다. room에는 `building_id`와 `level`이 있고 범위 규칙은 지점과 같다. 문의 `room_ref`가 room의 `room_ref`와 같으면 서로 연결된 것으로 보며, room을 지워도 문은 남는다.
  - 지점은 `{ id, coord, props }`, 구간은 `{ id, vertices, props }`다. 구간의 `from`/`to`는 `props` 안에 둔다(파일의 속성 키 순서를 그대로 지켜 바이트 단위로 왕복하기 위해서다).
  - JavaScript `Map` 대신 일반 객체를 쓴다. Immer 패치(되돌리기)와 JSON 직렬화를 단순하게 하기 위해서다. Map을 쓰면 `enableMapSet()`이 필요하고, 직렬화도 따로 처리해야 한다.
- **구간은 좌표를 복사하지 않고 지점을 참조한다 (iD 방식).**
  - 편집 상태의 구간은 `from`, `to`, 중간 꺾임점 `vertices`만 가진다. 양 끝 좌표는 지점에서 가져온다.
  - iD에서는 길이 지점 id 목록만 가지기 때문에, 지점을 옮기면 길이 저절로 따라온다.
  - 파일로 저장할 때만 완전한 LineString(끝 좌표 포함)으로 펼친다. 불러올 때 끝 좌표가 지점과 다르면 검사 오류(I2)로 알린다.
  - 그러면 "지점은 옮겼는데 구간 끝이 안 따라옴" 같은 결함이 구조적으로 생기지 않는다.
- **동작 `Action`**: `(state) => state` 순수 함수.
  - 각 동작에 `annotation`(한국어 설명, 예: "지점 3개 삭제")과 `disabled(state)`(못 하는 이유 또는 `false`)를 둔다.
- **이력 `History`**: iD의 `coreHistory`와 같은 방식이다.
  - `perform`: 새 항목 추가
  - `replace`: 현재 항목 바꿔치기
  - `overwrite`: 직전 항목을 지우고 새로 넣기
  - `undo` / `redo`: `annotation`이 있는 항목까지 건너뛴다
- **끌기 이력 처리 (iD drag_node 방식)**: 끌기 시작에 `perform(noop)`(설명 없음), 움직이는 동안 `replace(moveNode)`, 놓을 때 설명이 있는 `replace`. 그래서 끌기 한 번이 되돌리기 한 번이다.
- 매크로가 지점 50개를 만들어도 이력 항목은 하나이고, 되돌리기 한 번으로 취소된다.
- **패치**: Immer의 `produceWithPatches`로 동작마다 정방향 패치와 역방향 패치를 얻는다. 앱 시작 때 `enablePatches()`를 한 번 불러야 한다(Immer 6부터). **편집기 안의 되돌리기는 이 Immer 패치를 쓴다.** 파일로 남기는 변경 묶음(7장)은 패치가 아니라 Feature 단위(create / modify / delete)로 만든다. Immer 패치의 배열 인덱스 경로는 앞 원소가 지워진 상태에 적용하면 오류 없이 엉뚱한 꼭짓점을 덮어쓰기 때문이다(immer 11.2.10으로 확인).
- **편집기, 매크로, 제보 적용 CLI가 모두 이 동작만 쓴다.** 편집기 안에서 데이터를 직접 고치는 코드는 없앤다.

### 4.1 동작 목록

| 동작 | 하는 일 |
|---|---|
| `addNode`, `addEdge` | 추가 |
| `deleteNodes(ids, {heal})` | 지점을 지우고 이어진 구간도 지운다. `heal: true`이고 지점에 같은 종류 구간이 정확히 2개 이어져 있으면 두 구간을 하나로 합친다 |
| `deleteEdges(ids)` | 구간을 지운다. 그 결과 아무것과도 이어지지 않은 `corridor`·`outdoor` 지점은 함께 지운다. 문, 화장실, 강의실은 남긴다 |
| `deleteBuilding(code)` | 건물과 그 안의 모든 지점, 구간, 포탈, 연결통로를 지운다. 실행 전에 지울 개수를 보여 준다 |
| `moveNode(id, coord)` | 지점을 옮기고 이어진 구간의 끝 좌표도 함께 옮긴다. 엘리베이터 정차 지점이면 같은 `elevator_id` 정차 지점을 모두 옮긴다 |
| `mergeNodes(ids)` | iD `actionConnect` 방식. 남길 지점을 고른다: 중요한 종류(출입구, 문, 엘리베이터 정차, 화장실, 강의실)를 먼저, 그다음 오래된 id. 나머지 지점의 구간 연결과 속성을 남길 지점으로 옮기고, 길이 0이 된 구간(자기 자신으로 가는 구간)을 지운다. 범위가 다르거나 중요한 종류가 둘 이상이면 `disabled`로 거부한다 |
| `splitEdgeAt(edgeId, coord, {nodeId?})` | 구간 위의 한 점에서 구간을 둘로 나눈다. `nodeId`를 주면 그 기존 지점(끌던 지점)을 나눈 자리에 끼우고(iD `actionAddMidpoint`), 안 주면 새 지점을 만든다. 1.0m 안에 기존 꼭짓점이 있으면 그 점을 쓴다. 나누기 규칙은 4.1.1 |
| `setProps(ids, patch)` | 속성 바꾸기 |
| `addBuilding({polygon, code, name, levels, ground_levels?, building_type?})` | 건물 외곽선을 등록한다. id는 `bldg_{code}`, `rev` 1. 코드(영문자·숫자)가 겹치거나, 층이 비었거나 0이 있거나, `ground_levels`가 `levels` 밖이거나, 구름다리 건물의 층이 둘 이상이면 `disabled`. `ground_levels`를 안 주면 1층이 있으면 `[1]`, 없으면 가장 낮은 층 |
| `reverseEdge(ids)` | 구간 방향을 뒤집는다. `from`/`to`와 `vertices` 순서, `conveying`(forward↔backward, reversible은 그대로), `incline`(up↔down), `level_from`↔`level_to`, `building_from`↔`building_to`를 함께 뒤집고 `rev`+1. 나머지 속성(`bidirectional`, `step_free`, `elevator_id` 등)은 그대로 |
| `compose(steps, annotation)` | 여러 동작(또는 앞 동작이 남긴 상태로 동작을 만드는 함수)을 동작 하나로 묶는다. 이력 한 줄이고 되돌리기 한 번으로 취소된다. 어느 한 단계가 못 하면 그 이유로 `disabled`. 경고와 `overrideCopies`는 모든 단계 것을 모은다. 편집기의 작업(plan)과 매크로가 쓴다. 끌기만 이력 규칙(perform(noop) → replace → 설명 있는 replace)이 따로 있다 |

**공통 규칙 (이번에 정함)**

- 동작으로 `addRoom`, `deleteRooms`를 더한다. `deleteBuilding`은 그 건물의 room도 지우고, 지울 개수 미리보기(`previewDeleteBuilding`)에 지점·구간·room 수를 보여 준다.
- **rev**: 기준 상태(불러온 상태 또는 마지막 저장)에 대해 한 번만 +1이다. 끌기 한 번도, 저장 전에 두 번 고친 것도 +1이고, 고쳤다가 되돌리면 그대로다. 새 Feature는 저장 전까지 몇 번을 고쳐도 1이다. History가 이 규칙으로 맞춘다.
- **구간 방향 뒤집기**(동작은 아직 없음, 만들 때 따를 규칙): `from`/`to`와 `vertices` 순서를 뒤집고, `conveying`은 forward↔backward(reversible은 그대로), `incline`은 up↔down으로 함께 뒤집는다.
- **`deleteNodes` heal 조건**: 지점에 구간이 정확히 둘이고 a–n–b로 이어지며, `from`/`to`/`rev`/`step_count`를 뺀 속성이 같을 때만 합친다. 한쪽으로만 가는 구간은 n을 지나는 방향이 같아야 한다. `elevator`, `portal`, `bridge`는 합치지 않는다. 긴 쪽 id가 남고 n은 꺾임점이 되며 `step_count`는 더한다. 조건이 안 맞으면 그냥 지운다.
- **`mergeNodes` 남길 지점**: 중요한 종류가 먼저이고, 그다음은 `ids`의 마지막 지점(끌어다 놓은 대상, iD connect 방식)이다. 층이 다른 지점은 거부한다.
- **`splitEdgeAt` 추가 거부**: `conveying`이 있는 구간(에스컬레이터·무빙워크)과, 양 끝 범위가 다른 구간(층을 잇는 계단·경사로)은 `disabled` 이유를 돌려준다.
- **경고**(동작은 실행하고 문장을 돌려준다):
  - 측정이 가리키는 구간을 나누거나(`splitEdgeAt`) 합치면(`deleteNodes`의 heal) "이 구간의 측정은 바뀌기 전 길이 기준이라 다시 재야 합니다". 구간을 지우는 것은 막지 않고 검사 W13이 잡는다.
  - **override 따라가기**: 동작은 `overrideCopies(state)`로 `[{ fromId, toId, move? }]`를 돌려준다(매크로 결과와 History의 `overrideCopies()`에도 모인다). 구간 나누기(`splitEdgeAt`, 매크로 포함)는 override가 걸린 구간의 새 조각에 같은 내용(`status`, `until`, `report_id`)을 복사하라고 알리고, heal은 사라지는 구간의 override를 남는 구간으로 옮기라고(`move`) 알린다. 편집기는 저장할 때 `applyOverrideCopies`로 `overrides.json`에 반영한다(되돌린 편집과 이미 저장한 편집은 빠진다). 경고 문장도 함께 나온다.
  - **한계**: `compose` 안에서 같은 구간을 두 번 나누면 override 복사가 이어지지 않는다(매크로는 처리함).
  - overrides가 가리키는 Feature를 지우면 "overrides.json에서 이 항목을 지우세요". `mergeNodes`로 사라지는 지점이면 남는 지점 id도 보여 준다. 지우기는 막지 않고 검사 W14가 잡는다.

#### 4.1.1 구간 나누기 규칙

- **나누기를 거부하는 구간**: `elevator`, `bridge`, `portal` 구간(`disabled`로 이유를 돌려준다). 다리 중간에 지점이 필요하면 다리를 `building_type: "bridge"` 건물(층 1개)로 등록한다(2.6).
- **계단 구간(`steps`)**: 매크로는 계단 구간을 나누지 않는다. 손으로 나눌 때는 `step_count`가 2 이상일 때만 허용하고, 길이 비율로 나눠 양쪽 모두 최소 1이 되게 한다. `step_count`가 1이면 거부한다.
- **어느 쪽이 원래 id를 갖는가**: 더 긴 쪽이 원래 id를 갖고 `rev`가 1 늘어난다. 새 쪽은 새 id에 `rev` 1이다. 길이가 같으면 `from` 쪽이 원래 id를 갖는다(이 동률 규칙은 이 문서에서 정한 것이다).
- 나눈 구간의 속성은 그대로 복사한다. 단 `step_count`는 위 규칙으로 나눈다.
- **평행 구간은 함께 나누지 않는다.** 같은 두 지점 사이의 다른 구간(계단 + 경사로 등)은 지정한 구간만 나눈다.

#### 4.1.2 새 id 만들기

- 새 지점·구간 id는 v0.1 ID 규칙(SPEC.md 4.4)의 읽기 쉬운 접두어 + 짧은 무작위 꼬리(6자 이상)로 만든다. 예: `n_ENG1_3_door_k7x2qa`.
- 전역 카운터는 쓰지 않는다(iD의 `osmIdManager`는 changeset 재생과 맞지 않는다).
- id 생성기는 주입할 수 있게 만들고, 테스트에서는 시드를 고정한다.
- 새 id가 이미 있으면 충돌이다(7.2의 `id_exists`).

### 4.2 불변식 (속성 테스트로 확인)

| # | 불변식 |
|---|---|
| I1 | 모든 구간의 `from` / `to` 지점이 존재한다 (고아 구간 0) |
| I2 | 저장한 파일에서 구간의 첫·끝 좌표가 `from` / `to` 지점 좌표와 같다 (편집 상태에서는 구조상 항상 참) |
| I3 | id가 겹치지 않는다 |
| I4 | 평지 구간(`footway` / `corridor`)은 서로 다른 범위(바깥, 건물+층)를 잇지 않는다. 포탈과 연결통로만 범위를 넘는다 |
| I5 | 같은 `elevator_id`의 정차 지점은 같은 좌표에 있다 |
| I6 | 되돌리기를 끝까지 하면 처음 상태와 같다 |

### 4.3 불러오기와 저장

- `fromCampus`: 스키마를 통과한 Feature만 상태에 넣고 나머지는 문제 목록으로 돌려준다. 구간의 첫·끝 좌표가 지점과 다르면 I2로 알리고, 저장할 때 지점 좌표로 맞춘다.
- `serialize`: SPEC.md 4.3 배치를 따른다. 지점·room은 바깥이면 `outdoor.geojson`, 건물 안이면 `L{level}`, 양 끝이 한 건물(또는 둘 다 바깥)에 있지 않은 구간은 `connections.geojson`, 실내 구간은 아래층 파일이다. 파일 고르기에만 층을 비교한다. 각 파일은 `formatFeatureCollection`(LF)으로 쓰고, 불러온 직후 저장하면 바이트 단위로 같다. `overrides.json`, `observations/*.jsonl`, `calibration.json`은 다시 쓰지 않는다. 더는 쓰지 않는 옛 파일을 지우는 일은 부르는 쪽이 한다.

I4는 검사에서 층 값을 비교한다. 길찾기가 아니라 검사이므로 AGENTS.md 규칙에 어긋나지 않는다.

---

## 5. 편집기 상호작용

### 5.1 구조

- **원본 데이터는 편집 엔진 하나다.** 지도는 엔진 상태에서 만든 MapLibre GeoJSON 소스로 그린다.
- **Terra Draw는 새 선과 영역을 그리는 동안에만 쓴다.** 그리기가 끝나면(`finish` 이벤트) 결과를 동작으로 바꿔 엔진에 넣고, Terra Draw 저장소에서 지운다.
  - 이유: Terra Draw는 Feature를 서로 독립적으로 저장한다. 그래서 지점을 끌어도 이어진 구간이 따라오지 않는다.
  - Terra Draw에는 자체 되돌리기 기능(`undoRedo` 옵션, `history` 이벤트)이 있다. `undoRedo`는 선택 객체(`modeLevel`, `sessionLevel`, `keyboardShortcuts`)이고 넘기지 않으면 꺼져 있다. 이력이 두 개가 되지 않도록 넘기지 않는다(terra-draw 1.39.0 타입과 압축 소스를 읽은 결과이고, 실행해 확인하지는 않았다).
  - 그리는 중 붙이기는 `coordinates.snappable`의 `toCustom(event, context)`로 만든다. 같은 범위 지점만 돌려주는 함수를 넣는다.
- **선택, 끌기, 삭제, 붙이기는 MapLibre 이벤트로 직접 만든다.** iD drag_node의 동작을 따른다.
  - 끄는 동안에는 작은 임시 소스(끄는 지점과 이어진 구간만)를 `requestAnimationFrame`마다 갱신한다. 이력은 4장의 perform → replace 방식이다.
  - 같은 범위 지점 위에 놓으면 합친다(`mergeNodes`).
  - 같은 범위 구간 위에 놓으면 그 구간을 나누고 그 자리에 잇는다. iD `actionAddMidpoint`와 같다.
  - 다른 범위 위에 놓거나 합칠 수 없으면 원래 자리로 되돌린다. iD의 "nope" 처리와 같다.
  - `Alt`를 누른 채 끌면 붙이지 않는다.
  - 구간 가운데의 작은 손잡이를 끌면 그 자리에 새 지점이 생긴다(`splitEdgeAt` + 끌기).
  - 끌기 시작에 `Shift`를 누르고 있으면 끌기 대신 상자 선택이다.
- **모드는 iD처럼 한 번에 하나만 켠다**: 보기, 선택, 길 그리기, 지점 추가, 포탈, 연결통로, 문 연속 찍기, 강의실 줄, 화장실.
- **작업(operation)**: 삭제, 합치기, 나누기, 뒤집기. 각 작업에 키와 "못 하는 이유" 툴팁이 있다.

### 5.2 범위(scope) 자동 판단 (요구사항 3)

- 범위는 `outdoor` 또는 `{building, level}`이다.
- **새 지점의 범위는 찍은 위치로 정한다.** 건물 모드에서 그 건물 외곽선 안을 찍으면 현재 층, 밖을 찍으면 `outdoor`. 모드를 바꿀 필요가 없다.
- `O` 키를 누르고 있으면 건물 안이어도 바깥 범위로 찍는다(지붕 위 길, 필로티 아래 같은 경우).
- **붙이기(snap)는 같은 범위의 지점에만 한다.** 예외는 출입구 지점(`entrance`)이다. 출입구는 바깥과 그 층 양쪽에서 붙는다.
  - 이유: 다른 층의 같은 자리에 있는 지점에 실수로 붙으면 층이 몰래 이어진다. v0.1의 5px 붙이기에는 이 위험이 있다.
- **포탈 자동 생성**: 바깥 길을 그리다 출입구 지점에 붙이면 그 구간을 자동으로 `edge_type: portal`로 만든다.
- 다른 층 지점은 흐리게 보이고 클릭되지 않는다. 바깥 길은 건물 모드에서도 진하게 보인다.

### 5.2.1 연결통로 도구

- 시작 지점을 누르면 **다른 건물과 층을 고르는 창**이 뜬다. 창의 문구는 한국어 존댓말이다.
- 건물과 층을 고르면 **그 층의 지점만 진하게** 보이고(나머지는 흐리게, 클릭 안 됨), 끝 지점을 누르면 `edge_type: bridge` 구간이 만들어진다. `building_from`, `building_to`, `level_from`, `level_to`는 두 지점에서 자동으로 채운다.
- 선택한 두 지점이 같은 건물이면 만들지 않고 이유를 보여 준다(검사 W10과 같은 조건).
- 다리 중간에 지점이 필요하면 `building_type: "bridge"` 건물로 등록해 쓴다(2.6). 연결통로 구간 자체는 나누지 않는다(4.1.1).

### 5.3 키

| 키 | 동작 |
|---|---|
| `Delete` / `Backspace` | 삭제 |
| `Shift+Delete` | 이어 붙이며 삭제 (`heal`) |
| `M` | 합치기 |
| `X` | 나누기 |
| `F` | 뒤집기: 고른 구간은 방향(`reverseEdge`), 고른 문은 앞문·뒷문(`door_role` front↔back) |
| `O` (누르고 있기) | 바깥 범위로 찍기 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 되돌리기 / 다시 하기 |
| `Esc` | 모드 끝내기 |
| `[` / `]` | 층 내리기 / 올리기 |

---

## 6. 복도·문 매크로 (요구사항 5)

모두 `packages/core/src/edit/macros/`에 순수 함수로 만든다. 편집기는 미리보기와 클릭만 담당한다. Turf의 `nearestPointOnLine`, `along`, `lineSliceAlong`, `length`를 쓴다.

Turf 주의 (7.4.0 소스에서 확인):

- **거리 단위 기본값은 킬로미터다.** 모든 호출에 `{ units: 'meters' }`를 넘긴다. 빠뜨리면 1.0m 허용치가 1km가 된다.
- `nearestPointOnLine` 반환 속성은 7.4부터 새 이름을 쓴다: `segmentIndex`(옛 `index`), `totalDistance`(옛 `location`), `lineDistance`, `segmentDistance`, `pointDistance`(옛 `dist`). 옛 이름에는 `@deprecated` 표시가 있다(제거 시점은 7.4.0 타입에서 확인되지 않는다). 새 이름을 쓴다.

매크로(6.1~6.4)는 **계단 구간을 나누지 않는다.** 복도 구간(`corridor`)만 나눈다.

### 6.1 `attachDoor(state, doorCoordOrId, opts)`: 핵심

1. 문과 같은 건물, 같은 층의 복도 구간 중 가장 가까운 것을 찾는다(최대 `maxDist`, 기본 8m). 같은 범위(건물+층)의 복도 구간을 모두 확인한다. 한 층 수백 개 수준이라 충분하다. 느려지면 그때 색인을 추가한다.
2. `nearestPointOnLine`으로 수선의 발을 구한다.
3. 발 1.0m 안에 기존 지점이 있으면 그 지점을 쓰고, 없으면 `splitEdgeAt`으로 복도를 나눠 새 지점을 만든다.
4. 문 지점이 없으면 만든다(`node_type: door`, `room_ref`, `door_role`).
5. 문과 발을 `highway: corridor`, `edge_type: indoor`, `step_free: null` 구간으로 잇는다.
6. 복도를 찾지 못하면 아무것도 바꾸지 않고 이유를 돌려준다.

### 6.2 `densifyCorridor(state, edgeIds, {interval | count})`

- 복도 구간들을 이어 하나의 선으로 보고, `interval`(m) 간격이나 `count`개로 지점을 넣는다.
- 길찾기에는 꼭 필요하지 않다. 문 연결은 6.1이 필요한 곳에만 지점을 만든다. 그래서 기본값은 끈다. 사진 안내 지점이나 긴 복도의 중간 안내가 필요할 때만 쓴다.
- 쓸데없는 지점이 많으면 데이터가 커지고 끌기 편집이 무거워진다.

### 6.3 `placeRoomDoors(state, roomIdOrPolygon, {doors: 'front' | 'back' | 'both'})`

1. 강의실 영역의 변 중 가장 가까운 복도를 바라보는 변을 고른다. 변의 중점과 복도 사이 거리가 가장 짧은 변이다.
2. 그 변의 20% 지점과 80% 지점에서 0.3m 안쪽에 문 후보를 놓는다.
3. 앞문은 복도 방향(구간이 그려진 방향) 기준으로 앞쪽 끝이다. 틀리면 `F`로 뒤집는다.
4. 각 문에 6.1을 적용한다.

### 6.4 `roomStrip(state, {corridorEdgeIds, side, startRef, refStep, count, doorsPerRoom, firstDoor, lastDoor})`

- 첫 문과 마지막 문 위치(클릭 두 번)를 받아 그 사이에 `count`개 강의실의 문을 고르게 놓는다.
- 호실 번호는 `startRef`부터 `refStep`씩 늘린다. 한쪽에 홀수만 있으면 2.
- `doorsPerRoom: 2`이면 한 강의실 폭 안에 앞문과 뒷문을 놓는다.

### 6.5 편집기 도구 (최소 클릭)

**문 연속 찍기 (`D`)**

- 마우스를 움직이면 가장 가까운 복도에 수선의 발과 연결선이 미리 보인다.
- 클릭할 때마다 문 + 연결 + 복도 나누기가 한 번에 된다(동작 하나).
- 호실 번호는 자동으로 늘어난다. 처음에 한 번만 입력한다.
- `Shift+클릭`은 직전 강의실의 뒷문이다(같은 `room_ref`, `door_role: back`).
- 숫자 키 `2`를 누르면 번호 간격이 2가 된다.

**강의실 줄 (`R`)**

- 복도 선택 → 첫 문 클릭 → 마지막 문 클릭 → 개수와 시작 번호 입력 → 미리보기 → `Enter`.
- 규칙적인 층에서는 한 줄에 클릭 3번이면 된다.

**작업 순서와 상관없이 잇기**

- 문·화장실·엘리베이터 정차 지점을 찍을 때 같은 층에 복도가 없거나 8m 안에 없으면, 지점만 만들고 성공으로 처리한다. 경고 문구는 "아직 복도와 연결되지 않았어요. 복도를 그리면 자동으로 이어집니다". 연결 안 된 지점은 지도에서 눈에 띄게 표시한다.
- 복도 그리기가 끝나면 같은 건물·층에서 8m 안의 연결 안 된 지점을 `attachDoorAction`으로 잇는다. 복도 추가와 연결은 `compose` 한 줄이다.
- 도구 막대의 "연결 안 된 지점 잇기"는 현재 층의 연결 안 된 지점을 한 번에 잇고, 못 이은 것은 이유와 함께 보여 준다.
- 엘리베이터는 전용 도구(`V`)로만 만든다. 층마다 정차 지점을 만들고(같은 좌표, 같은 `elevator_id`), 이웃 정차 지점끼리 `highway=elevator` 구간으로 잇는다. 보통 구간 그리기에서는 `highway=elevator`를 고를 수 없다.

**클릭 수 예시**: 복도 1개 그리기(클릭 4번) + 한쪽 강의실 10개(문 연속 찍기, 앞·뒷문 20번) + 맞은편 10개(강의실 줄, 3번) + 계단·엘리베이터(도구, 6번) ≈ 35번.

---

## 7. 변경 묶음(changeset)과 제보 파이프라인

### 7.1 형식 `changesets/{yyyymmdd}-{slug}.json`

파일로 남기는 changeset은 OSM의 osmChange처럼 **Feature 단위**다. 편집기 안의 되돌리기는 지금처럼 Immer 패치를 쓰고(4장), 파일에는 패치를 저장하지 않는다.

```json
{
  "id": "cs-20261111-ev1-fix",
  "campus": "hanyang-seoul",
  "source": "editor | macro | report",
  "report_ids": ["rp-20261110-0007"],
  "changes": [
    { "op": "create", "feature": { /* Feature 전체 */ } },
    { "op": "modify", "base_rev": 3, "feature": { /* 바뀐 Feature 전체 */ } },
    { "op": "delete", "base_rev": 2, "id": "n_ENG1_3_door_k7x2qa" }
  ],
  "summary": "A동 EV1 정차 층 수정"
}
```

- `create`: Feature 전체. `rev`는 1이다.
- `modify`: 바뀐 Feature 전체(저장 형식, 구간은 끝 좌표까지 펼친 LineString). `rev`는 `base_rev + 1`이다. 지점을 옮기면 이어진 구간의 끝 좌표도 바뀌므로 그 구간들도 각각 `modify`로 들어간다.
- `delete`: id와 `base_rev`만 적는다.
- **`base_rev`는 사람이 적지 않는다.** changeset을 만들 때 편집 엔진이 기준 상태에서 건드린 모든 Feature의 `rev`로 자동으로 채운다(`moveNode`, `mergeNodes`가 건드리는 이웃 구간 포함).
- `report_ids`: 이 changeset이 처리하는 제보 id 배열. `source`가 `report`이면 하나 이상, 아니면 빈 배열이다. 제보 여러 건을 changeset 하나로 처리할 수 있다.

### 7.2 CLI `npm run apply -- <파일...> [--dry-run]`

1. 여러 파일을 한 번에 줄 수 있다. **파일 이름(날짜) 순서**로 적용하고, 각 파일은 앞 파일을 적용한 뒤의 상태와 비교한다. 날짜가 같으면 이름 순이다. 같은 Feature를 두 파일이 건드리면 두 번째 파일에서 충돌로 나온다.
2. 각 changeset의 충돌을 검사한다. 충돌 종류는 세 가지다.
   - `rev_mismatch`: `modify` / `delete` 대상의 현재 `rev`가 `base_rev`와 다르다. 대상 Feature가 없는 경우도 이 종류로 보고하고 "없음"이라고 적는다.
   - `id_exists`: `create`하려는 id가 이미 있다.
   - `still_referenced`: `delete`하려는 지점·건물을, 같은 changeset에서 지우지 않는 다른 Feature가 아직 참조한다(예: 다른 제보가 붙여 놓은 구간).
3. 충돌은 첫 번째에서 멈추지 않고 **모두 모아서** 한 번에 보여 준다. 충돌이 하나라도 있으면 적용하지 않는다.
4. 충돌이 없으면 적용하고 `validateCampus`를 돌린다. 오류가 있으면 적용하지 않는다.
5. 사람이 읽는 요약(추가·삭제·변경 개수, 건물별)을 출력한다.
6. 하나라도 실패하면 아무것도 쓰지 않는다(OSM diff upload의 전부 적용 또는 전무와 같다).

### 7.3 제보에서 반영까지 (앱이 생긴 뒤의 흐름, v0.2는 가짜 제보 JSON으로 만든다)

```
앱 제보(위치, 층, 종류, 사진, 설명)
  → reports 저장소 (나중에 Supabase. v0.2는 data/reports/*.json)
  → 편집기 '제보' 탭: 작업 대기열(MapRoulette 방식). 같은 종류이고 같은 Feature(또는 가까운 위치)를 가리키는 제보는 묶는다
  → 종류별 처리
      일시적(고장, 공사)      → overrides.json에 만료 시각과 함께 추가 (지도 원본은 그대로)
      영구적(문 위치, 새 화장실) → 미리 채운 동작으로 편집 → 바뀐 점 미리보기 → 저장 → changeset 파일
  → npm run apply --dry-run → PR (커밋 메시지에 report id)
```

**제보 묶기(bundle)**: MapRoulette의 bundle은 중복 제거가 아니라, 가까운 서로 다른 작업을 한 번에 푸는 기능이다. 캠포는 이 구조를 쓰되 중복 처리는 따로 정한다.

- 제보에 `bundle_id`(문자열)와 `is_primary`(불리언)를 둔다.
- 대표 제보(`is_primary: true`)가 changeset의 `report_ids` 첫 항목이다. 나머지 구성원은 같은 `bundle_id`를 가지고 대표의 처리를 따른다.
- 묶음에서 제보를 빼면 `new`로 돌아간다.
- 일시 제보는 묶지 않고, 같은 `feature_id`에 활성 override가 이미 있으면 `duplicate`로 처리한다.
- 묶는 거리 기준은 같은 범위에서 8m 안이다. 이 값은 상수 파일 한 곳에만 둔다(`packages/core/src/reports/` 아래, 예: `BUNDLE_DISTANCE_M`).

**제보 상태** (MapRoulette 상태를 캠포 용어로 옮긴 것):

| 상태 | 뜻 | 대기열에 남는가 |
|---|---|---|
| `new` | 방금 들어옴 | 예 |
| `triaged` | 종류와 위치 분류 완료, 처리 대기 | 예 |
| `skipped` | 지금은 안 봄 | 예 |
| `needs_survey` | 책상에서 판단 불가, 현장 확인 필요 | 예 |
| `applied` | 지도 원본(changeset) 또는 overrides에 반영됨 | 아니오 |
| `already_fixed` | 이미 데이터가 맞음 | 아니오 |
| `rejected` | 제보가 틀렸거나 근거 부족 | 아니오 |
| `duplicate` | 대표 제보에 합침 | 아니오 |
| `expired` | 일시 제보의 `until`이 지나 overrides에서 풀림 | 아니오 |

- `new`에서는 어느 상태로든 갈 수 있다.
- `skipped`, `needs_survey`는 `applied`, `already_fixed`, `rejected`, `skipped`, `needs_survey`로 갈 수 있다.
- 끝난 상태(`applied`, `already_fixed`, `rejected`, `duplicate`, `expired`)는 명시적 "다시 열기"로 `new`로 돌린 뒤에만 바꿀 수 있다.
- 상태를 바꿀 때마다 누가, 언제 바꿨는지 남긴다. `applied`이면 PR 링크를 남긴다.

제보 종류와 처리 방식 (`packages/core/src/reports/kinds.ts`):

| 종류 | 처리 |
|---|---|
| `elevator_out` | 일시 |
| `door_locked` | 일시 |
| `construction` | 일시 |
| `stairs_unmarked` | 영구 |
| `wrong_room_location` | 영구 |
| `new_restroom` | 영구 |
| `step_free_confirmed` | 영구, `step_free: true` + `source: report-…` |

---

## 8. 검사 추가

| 코드 | 수준 | 내용 |
|---|---|---|
| E9 | 오류 | 불변식 I1~I5 위반 |
| E10 | 오류 | 화장실 지점이 어떤 구간에도 이어지지 않음 |
| E11 | 오류 | `elevator_stop`에 `elevator_id`가 없음, 또는 같은 id의 정차 지점이 엘리베이터 구간으로 하나로 이어지지 않음 |
| W5 | 경고 | 문이 복도와 이어지지 않음 |
| W6 | 경고 | 같은 `room_ref`에 `front` 문이 두 개 |
| W7 | 경고 | `overrides.json`에 만료된 항목이 남아 있음 |
| W8 | 경고 | 엘리베이터 정차 지점이 복도 쪽으로 이어진 구간이 없음 (타기만 하고 내릴 곳이 없음) |
| W9 | 경고 | 같은 `elevator_id`의 정차 지점이 모두 같은 층 |
| W10 | 경고 | 연결통로(`bridge`) 구간의 양 끝 지점이 같은 건물에 있음 |
| E12 | 오류 | `conveying`이 있는 `highway=steps`(에스컬레이터)의 `step_free`가 `false`가 아님 |
| E13 | 오류 | `highway=elevator` 구간의 양 끝이 `elevator_stop`이 아님 ("엘리베이터 도구로 다시 만드세요"). 길찾기 그래프는 이런 구간을 건너뛰고 `graph.warnings`에 남긴다 |
| W12 | 경고 | 실내 에스컬레이터의 양 끝이 같은 건물·같은 층(층이 안 바뀜) |
| W13 | 경고 | `observations`의 `target`이 존재하지 않는 구간·엘리베이터를 가리킴 |

| W14 | 경고 | `overrides.json`의 `feature_id`가 존재하지 않는 Feature를 가리킴 ("overrides.json에서 이 항목을 지우세요") |

- **W11 삭제됨**(decisions 2026-11-11): 바깥 계단은 평면 길이로만 계산한다. 시간이 맞지 않는 긴 바깥 계단은 측정 보정(3.9)으로 맞춘다.
- E11의 "하나로 이어지지 않음"은 스키마 오류가 난 엘리베이터 구간도 `from` / `to`만 읽어 연결에 넣고 계산한다. 그래서 엘리베이터 구간 하나가 스키마를 어기면 스키마 오류 하나만 나오고, 정말로 끊긴 경우에만 E11이 난다.
- W12는 양 끝이 건물 안(건물+층)일 때만 검사한다. 바깥 에스컬레이터는 범위가 하나라 층 변화로 검사할 수 없어 제외한다. 언덕 높이 검사는 고도 데이터를 합친 뒤에 다시 검토한다.
- `conveying`의 값과 `bidirectional`의 짝, `conveying`을 쓸 수 있는 `highway`는 스키마가 검사한다. 관측 줄(`observations/*.jsonl`)과 `calibration.json`의 모양도 스키마(`$defs/observation`, `$defs/calibration`)가 검사한다.

W8과 W9는 OpenTripPlanner가 지도 데이터를 그래프로 만들 때 내는 경고(`OnlyOneConnectionToElevatorNode`, `AllWaysOfElevatorNodeOnSameLevel`)를 참고했다. 검사에서 층 값을 비교하는 것은 길찾기 규칙에 어긋나지 않는다.

### 8.1 실시간 검사

편집할 때마다 검사 탭을 갱신한다. iD의 `validator`(`modules/core/validator.js`)와 같은 방식이다.

- **전체를 다시 돌리지 않는다.** 직전 검사 상태와 현재 상태를 비교해 **바뀐 Feature와 그 이웃**(이어진 구간과 지점)만 다시 검사한다.
- **끌기 중에는 돌리지 않는다.** 놓을 때, 되돌리기·다시 하기, 모드 끝낼 때만 돈다.
- 무거우면 한 번에 100개씩 묶어 브라우저 유휴 시간(`requestIdleCallback`)에 처리한다. iD가 이렇게 한다.
- 검사 결과의 id는 `규칙코드:정렬한 Feature id들`로 정해서, 같은 문제가 다시 나와도 같은 id가 되게 한다.
- 화면은 오류와 경고 두 목록이다. 항목에 마우스를 올리면 관련 Feature가 강조되고, 클릭하면 그 자리로 이동한다.
- **바뀐 Feature는 동작의 Immer 패치 경로에서 뽑는다.** 패치 경로의 `path[0]`이 `nodes` / `edges` / `buildings`이고 `path[1]`이 id다. 같은 id는 한 번만 센다. 이웃(이어진 구간과 지점)은 이 id들에서 상태를 따라가며 모은다.

---

## 9. v0.2에서 하지 않는 것

- 실제 Supabase 연결, 앱 화면
- 실내 영역(방 외곽선) 전체 그리기. 매크로 입력으로만 선택해서 쓴다
- 경사도 계산, 고도 데이터 합치기
- 후속 과제: 경사로의 오르막·내리막 시간 차이(계단은 3.1 규칙 4로 처리한다), 고도 데이터로 계단 칸 수를 추정해 `stairsTimeSec`에 넣기(3.1)
- 여러 사람이 실시간으로 함께 편집하기. Git과 PR로 충분하다
