# 길찾기 조사 (주제 B)

조사일 2026-11-11. 설치된 버전: ngraph.path 1.6.1 (MIT), ngraph.graph 20.1.2 (MIT). 캠포 HEAD 1b26749.

## 1. 한 줄 결론

- 이전 조사(research-architecture.md 1.1)의 ngraph 동작 5가지는 설치본에서 모두 "확인됨". 다만 **그 동작은 `aStar` 기준이다. `nba`는 다르다.**
- `nba`는 막힌 도착점에서 `[]`를 돌려준다(R13의 함정이 없다). 하지만 출발점=도착점이면 `[]`를 돌려주고, `distance`/`blocked` 인자 순서가 `aStar`와 반대다. 그래서 바꿔 쓰면 R11, R14가 새로 깨진다. **SPEC대로 `aStar`를 쓰고 결과 검사를 유지하는 쪽을 권한다.**
- GraphHopper: 계단은 걷기에서 속도 3km/h(평지 5), 휠체어(8.0까지)에서는 아예 금지. 엘리베이터 처리는 확인 못 함.
- OpenTripPlanner: 안내 문장(WalkStep)은 "내리는 구간(alight)"에서 한 번만 만든다. 타는 구간과 층 이동 구간은 문장을 만들지 않으므로, 여러 층을 가도 문장이 하나다. 이 구조를 그대로 쓰면 SPEC 3.6의 "합치기"가 단순해진다.

## 2. 이전 조사 재확인 (설치된 node_modules)

| 항목 | 결과 | 근거 |
|---|---|---|
| `oriented` 기본값 없음 | 확인됨 | node_modules/ngraph.path/a-star/a-star.js:37 (`var oriented = options.oriented;`) |
| 비multigraph는 링크 데이터 덮어씀 | 확인됨 (코드 읽기) | node_modules/ngraph.graph/index.js:42(기본 false), :55, :378~ (`createSingleLink`가 `prevLink`를 찾음) |
| 결과 순서 도착→출발 | 확인됨. 실행 결과 `C,B,A` (아래 4장) | a-star/a-star.js:146-156 |
| 막힌 이웃도 openSet에 들어감 | 확인됨 | a-star/a-star.js:110-119. `openSet.push`(111-113)가 `blocked` 검사(116)보다 먼저다. 실행 결과 `[C]` |
| `distance`/`blocked` 인자 순서 (다음, 현재, 링크) | 확인됨. 단 **aStar만** | a-star.js:116, 121. 실행 결과 `B,A|A>B`, `C,B|B>C` |

OpenTripPlanner(board/hop/alight), Valhalla 벌점은 다시 조사하지 않았다. OTP는 이번에 읽은 커밋에서 `ElevatorHopEdge.java`가 `street/src/main/java/org/opentripplanner/street/model/edge/` 아래에 있는 것만 확인했다.

## 3. 확인한 사실 표

### 3.1 GraphHopper (Apache-2.0)

master 커밋 3b2a7eaaaffcd6a60625923a979c7c5d07face02, 8.0 브랜치 커밋 1e224ae6bb1807ebc5037fb8de07c4f7cfaee749. 소스 확인.

| 사실 | 근거 | 방법 |
|---|---|---|
| master에는 휠체어 파서가 없다. 9.0에서 "removed wheelchair parsers (#2900)"로 삭제됐다. 8.0까지는 있었다 | https://github.com/graphhopper/graphhopper/releases (9.0 노트), 8.0 트리의 `WheelchairAccessParser/AverageSpeedParser/PriorityParser.java` | 릴리스 노트, 저장소 트리 |
| foot: 허용 도로 목록에 `steps`가 들어 있다 | master `core/src/main/java/com/graphhopper/routing/util/parsers/FootAccessParser.java:56` | 소스 |
| foot: 허용 목록에 `elevator`는 없다(목록은 :54-74). 엘리베이터 처리는 확인 못 함 | 같은 파일 :54-74 | 소스 (없음을 확인한 것) |
| foot: 계단 속도 = 평균 5km/h보다 2 낮은 3km/h. `sac_scale`이 있으면 2 또는 5 | `FootAverageSpeedParser.java:14-15, 45-47` | 소스 |
| foot: 우선순위에서 `steps`는 "안전한 도로" 목록에 든다(벌점 없음) | `FootPriorityParser.java:34` | 소스 |
| foot: 경사 처리는 기본 프로필(`foot.json`)에 없고, 별도 `foot_elevation.json`에 있다. `average_slope >= 15`이면 속도 상한 1.5, `>= 7`이면 2.5, `>= 4`이면 x0.85, `<= -4`이면 x1.05 | `core/src/main/resources/com/graphhopper/custom_models/foot_elevation.json:3-6` | 소스 |
| wheelchair(8.0): `steps`를 허용 목록에서 뺀다 = 길 자체를 못 쓴다 | 8.0 `WheelchairAccessParser.java:36`, `WheelchairPriorityParser.java:31` | 소스 |
| wheelchair(8.0): `incline` 태그가 +-6%를 넘으면 접근 불가 | 8.0 `WheelchairAccessParser.java:17(maxInclinePercent=6), :79-88` | 소스 |
| wheelchair(8.0): 연석(kerb) `raised` 또는 높이 3cm 초과면 접근 불가 | 같은 파일 :96-109 | 소스 |
| wheelchair(8.0): 자갈/모래/포석 노면, 나쁜 smoothness도 접근 불가 | 같은 파일 :39-47, 57-73 | 소스 |
| wheelchair(8.0): 계산한 경사가 3~6%면 오르막 속도를 낮추고(SLOW), 6% 초과는 속도 0 | 8.0 `WheelchairAverageSpeedParser.java:39-83` | 소스 |
| wheelchair(8.0): `wheelchair=designated`는 우선순위 VERY_NICE, `limited`는 AVOID | 8.0 `WheelchairPriorityParser.java:53-56` | 소스 |

요약: GraphHopper의 휠체어는 "막기(접근 불가)"와 "속도 낮추기"를 섞어 쓰고, 정보가 없는 경우(`step_free` 모름)를 따로 다루는 개념은 읽은 범위에서 못 찾았다(추정: 없음).

### 3.2 OpenTripPlanner (LGPL-3.0, 구조만 참고. 코드는 붙이지 않는다)

커밋 31bf512f7c07090f3060e244b950f9deec8ae16a (dev-2.x). 라이선스는 저장소 LICENSE 첫 줄이 GNU LGPL v3를 말한다(GitHub API는 NOASSERTION).

| 사실 | 근거 (application/src/main/java/org/opentripplanner/ 아래) | 방법 |
|---|---|---|
| 안내 문장 `WalkStep`의 방향 종류에 `ELEVATOR`가 있다 | `model/plan/walkstep/RelativeDirection.java:19` | 소스 |
| 엘리베이터 문장은 **내리는 구간(ElevatorAlightEdge)에서만** 만든다. 소스 주석: 엘리베이터 안내는 모두 내릴 때 만들고, 앞뒤에 뭐가 있었는지 몰라도 된다 | `routing/algorithm/mapping/StatesToWalkStepsMapper.java:201-204, 573-585` | 소스 |
| 따라서 board와 hop 구간은 문장을 만들지 않는다 (추정: 이 두 구간이 위 분기에 안 걸리고 일반 구간 처리로 가지만, 이번에 그 경로는 끝까지 읽지 않았다. 확실한 것은 "엘리베이터 문장은 내릴 때 한 번"이다) | 같은 파일 | 소스 |
| `ElevatorUse(from층, to층, 방향)`을 만들 때, 내리는 상태에서 이전 상태를 거슬러 올라가 가장 가까운 `ElevatorBoardEdge`를 찾는다. 그 탑승 층과 하차 층이 시작/끝이다 | `model/plan/walkstep/verticaltransportation/VerticalTransportationUseFactory.java:26-55, 127-137` | 소스 |
| 위/아래 방향은 **층 숫자를 비교해서** 정한다 (`board.level() > alight.level()`이면 DOWN) | 같은 파일 :43-48 | 소스 |
| 층 정보가 없으면 `ElevatorUse(null, null, UNKNOWN)`로 낸다 | 같은 파일 :50-55 | 소스 |
| 계단은 **구간마다** 문장 하나(`createAndSaveStairsWalkStep` -> `addStep`)를 만든다. 이어진 계단 구간을 이 단계에서 합치는 코드는 보지 못했다 | `StatesToWalkStepsMapper.java:209-211, 595-` | 소스 (합치기 여부는 확인 못 함) |

### 3.3 ngraph.path nba (MIT) 직접 실행

3.3 및 4장 참조. 소스 근거: node_modules/ngraph.path/a-star/nba/index.js.

| 사실 | 근거 | 방법 |
|---|---|---|
| nba는 막힌 구간을 이웃 처리 맨 앞에서 걸러 낸다(`blocked`가 true면 상태를 만든 뒤 바로 return). 만나는 지점(`minNode`)은 막히지 않은 경로에서만 갱신된다 | nba/index.js:180-200 (visitN1), 210-230 (visitN2) | 소스 + 실행 |
| 도착점이 막힌 구간으로만 이어지면 `[]` | 4장 출력 `blockedBC`, `infBC`, `blockedAll` | 실행 |
| 출발점 = 도착점이면 `[]` (aStar는 `[A]`) | 4장 출력 `same` | 실행 |
| `distance`/`blocked`는 `(탐색 중인 지점, 이웃, 링크)` 순서다. 거꾸로 탐색(도착점 쪽)이면 "탐색 중인 지점"이 링크의 `toId`가 된다. 즉 aStar와 순서가 반대다 | nba/index.js:182, 184, 212, 214. 실행 `distArgs` | 소스 + 실행 |
| `oriented: true`에서 정방향 탐색은 `link.fromId === 현재`만, 역방향은 `link.toId === 현재`만 따라간다 | nba/index.js:233-240 | 소스 |
| 결과 순서는 aStar와 같이 도착점 -> 출발점 | 4장 출력 `normal` | 실행 |

## 4. 실행 결과 (ngraph.path 1.6.1 / ngraph.graph 20.1.2)

스크립트: C:\Users\PC\AppData\Local\Temp\claude\5c22faf5da925b74\a2cf9eed-ad83-473a-8fff-f7af7fb5dae2\scratchpad\t.mjs (프로젝트 밖. 저장소에 남기지 않음). 그래프는 multigraph, 링크 A>B, B>C. 모든 탐색기에 `oriented: true`.

- `blockedBC`: B>C를 `blocked`로 막고 find(A, C)
- `infBC`: B에서 나가는 링크 비용을 `Infinity`로
- `blockedAll`: 모든 링크를 막음
- `reverseOriented`: find(C, A) (링크 방향과 반대)
- `normal`: find(A, C)
- `same`: find(A, A)
- `distArgs`: find(A, C) 때 `distance`가 받은 (a.id, b.id | link.fromId>link.toId)

```
aStar {
  blockedBC:  [ C ],            // 막혔는데 [도착점] 한 개 (R13 함정)
  infBC:      [ C ],
  blockedAll: [ C ],
  reverseOriented: [],
  normal: [ C, B, A ],
  same:   [ A ],
  distArgs: [ 'B,A|A>B', 'C,B|B>C' ]   // (다음, 현재)
}
nba {
  blockedBC:  [],               // 올바르게 "없음"
  infBC:      [],
  blockedAll: [],
  reverseOriented: [],
  normal: [ C, B, A ],
  same:   [],                   // 출발=도착인데 빈 배열
  distArgs: [ 'C,B|B>C', 'B,A|A>B' ]   // (탐색 중인 지점, 이웃). 역방향 탐색이 먼저 돌았다
}
```

(노드 객체의 나머지 필드 `links`, `data`는 줄여서 id만 적었다. 마지막 줄의 package.json 버전 출력은 `exports` 제한 때문에 오류가 났고, 버전은 파일을 직접 읽어 확인했다: ngraph.path 1.6.1, ngraph.graph 20.1.2.)

nba의 `distArgs` 첫 줄이 `C,B|B>C`인 것은, 시작 때 열린 집합 크기가 같아 역방향 탐색이 먼저 돌기 때문이다(nba/index.js:126-130). 즉 어느 방향 탐색이 먼저 돌지는 구현 세부이고, `a`/`b` 인자로 방향을 추정하면 안 된다.

## 5. SPEC-v0.2와 다른 점, SPEC이 틀린 점

1. **3.3 표의 `distance(a, b, link)` 인자 순서 설명은 aStar에만 맞는다.** nba를 쓰면 (탐색 중, 이웃)이고 역방향에서는 `a=link.toId`가 된다. 대응(`link.fromId`/`link.toId` 사용)은 어느 쪽에서도 맞다. SPEC에 "aStar 기준"이라고 적어 두는 것이 좋다.
2. **3.3 R13 설명은 aStar 전용이다.** nba는 `[]`를 준다. 반대로 R11(출발=도착이면 거리 0 경로)은 nba에서 `[]`라서 직접 처리해야 한다. SPEC이 aStar를 쓴다고 명시하지 않았으므로 한 줄 추가를 권한다. 현재 SPEC 문장에 "nba"는 없고, 틀린 문장은 아니다(누락).
3. **3.6 "계단도 같은 방식으로 합친다"의 근거가 약하다.** OTP는 엘리베이터는 구조상(alight 한 번) 한 문장이 되지만, 계단은 구간마다 문장을 만든다(합치는 코드를 못 찾음). 캠포가 계단을 합치려면 캠포가 직접 만들어야 한다. SPEC의 "OpenTripPlanner처럼"이라는 암시가 있다면 계단은 해당하지 않는다.
4. **3.6 "층 이름은 표시용으로만 `level`을 읽는다"와 OTP 방식의 차이.** OTP는 위/아래를 층 숫자 비교로 정한다. 캠포는 비교하지 않는 규칙이므로 이 부분은 가져오면 안 된다(아래 6장).
5. 그 밖: 3.2 말미 "OpenTripPlanner 현재 코드가 같은 구조"는 이전 조사로 믿고 재조사하지 않았다. 이번에 읽은 범위와 모순 없음.

## 6. 캠포에 적용할 점

### 안내 문장 (SPEC 3.6)

OTP 구조를 따른다. 구조만 가져오고 코드는 쓰지 않는다(LGPL).

1. 경로를 구간(edge) 목록으로 펼친 뒤 문장을 만든다. 가상 구간(`s -> ~car:s` board, `~car:a -> ~car:b` hop, `~car:s -> s` alight)을 다룬다.
2. **board와 hop은 문장을 만들지 않는다. alight를 만났을 때 한 번만 "엘리베이터를 타고 N층으로 가세요"를 만든다.** 이러면 1->7층이 한 문장이 된다. 별도의 합치기 단계가 필요 없다.
3. N층 이름은 alight가 내려놓는 정차 지점의 `level` 표시 이름에서 읽는다(표시 전용). 시작 층(탑승 정차 지점)이 필요하면 OTP처럼 경로를 거슬러 올라가 직전 board를 찾는다.
4. **"올라가세요/내려가세요"는 층 숫자 비교로 정하지 않는다.** 필요하면 데이터의 구간 방향이나 `level` 표시 이름만 보여 주고, 방향 단어는 빼는 것을 권한다. (추정: 사람 눈에는 "N층으로"만으로 충분하다.) 층 정보가 없으면 OTP처럼 "엘리베이터를 타세요"로 줄인다.
5. 계단은 OTP가 합치지 않으므로 캠포가 직접 정한다. 같은 종류(계단)의 연속 구간을 하나로 묶는 단순한 규칙이 필요하다. 묶음 기준은 "연속한 `highway=steps` 구간"이고, 층 번호는 보지 않는다. 계단 수는 `fewest_steps` 대체 경로의 "계단 N곳"(SPEC 3.4)과 같은 센 방식으로 맞춘다(같은 묶음 단위인지 정할 것).

### ngraph

- SPEC대로 `aStar` + `oriented: true` + multigraph를 쓴다. `nba`로 바꾸지 않는다. 바꾸면 R11(출발=도착), R13 처리, R14 인자 순서가 다시 달라진다. 이점은 큰 그래프에서의 속도뿐인데 캠퍼스 규모에서는 필요 없다(추정).
- 어느 탐색기든 `distance`/`blocked`는 `link.fromId`/`link.toId`로 판단한다.
- 결과 검사는 "마지막 지점이 출발점인가"(aStar 반환 기준 `path[path.length-1]`)로 한다. 출발=도착은 탐색 전에 따로 처리한다.
- 테스트로 R13을 고정할 때, 위 4장 그래프(A>B, B>C, B>C 막음)를 그대로 쓰면 된다. 지금 aStar는 `[C]`를 돌려주므로 "경로 없음" 변환이 없으면 실패한다.

### 프로필 (GraphHopper 참고)

- 가져올 것: 휠체어에서 계단을 "막기"로 처리하는 방식(캠포 `step_free`가 이미 같음), 걷기에서 계단 속도를 평지의 약 3/5로 낮추는 값(3km/h 대 5km/h. 캠포의 `STAIRS` 계수 정할 때 참고. 출처 소스는 `FootAverageSpeedParser.java:45`).
- 가져오지 말 것: 경사(incline)를 %로 계산해 막는 방식(6%, 연석 3cm). 캠포 데이터에는 경사 수치가 없고(추정), 층 번호 비교와 무관한 규칙이라는 점은 같지만 입력이 없다. 나중에 경사로 속성을 데이터에 넣게 되면 그때 참고한다. 또한 GraphHopper는 `wheelchair` 모듈을 9.0에서 지웠으므로(유지보수 부담) 따라 하지 말고 캠포 `step_free` 3상태(true/false/null)를 유지한다.
- 엘리베이터: GraphHopper에서는 확인하지 못했으므로 근거로 쓰지 않는다.

### 라이선스 요약

| 대상 | 라이선스 | 취급 |
|---|---|---|
| ngraph.path, ngraph.graph | MIT | 의존성으로 사용 |
| GraphHopper | Apache-2.0 | 수치와 구조 참고. 코드는 붙이지 않았다 |
| OpenTripPlanner | LGPL-3.0 | 구조만 설명. 코드 없음 |
