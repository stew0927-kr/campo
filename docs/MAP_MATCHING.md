# 보행자 GPS 맵 매칭과 실내외 전환

휴대폰의 GPS·나침반·기압 표본을 1초마다 받아 캠퍼스 보행망 위의 현재 위치를 정하고, 건물 출입(포탈)·층 이동·경로
이탈을 판정한다. 서버 없이 React Native(Hermes)에서 돌아가는 순수 TypeScript이고, 코드는
`packages/core/src/matching/`에 있다. 루트 `@campo/core`에서 모두 export한다.

## 1. 원칙

| 원칙 | 구현 |
|---|---|
| 길찾기는 층 번호를 비교하지 않는다 | 연결은 `CampusGraph`의 링크(걷는 구간 + 엘리베이터 hop)에서만 만든다. 층 번호는 후보 필터(`MatchScope`)와 층 표시·기압 층 판정에만 쓴다. `graph.ts`·`route.ts`는 고치지 않았다(테스트가 두 파일에 level이 없음을 계속 확인) |
| 그래프는 읽기 전용 | `buildMatchNetwork(g)`가 그래프를 한 번 읽어 typed array로 옮긴다. 이후 그래프를 건드리지 않는다 |
| 시각은 `fix.tMs`뿐 | step 함수에 `Date.now`·난수·DOM·파일 접근이 없다(테스트가 소스를 검사). 같은 기록을 다시 넣으면 결과가 똑같다(테스트) |
| 절대 기압 금지 | 호출자가 hPa 차이를 m로 바꾼 `baroDeltaM`(약 0.12 hPa/m)만 받고, 포탈을 지날 때 그 값을 기준(dH = 0)으로 삼는다. 기준값에 아무 상수를 더해도 결과가 같다(테스트) |
| 스키마 변경 없음 | `campo.schema.json`·`data/`는 그대로. 필요한 값은 기존 속성(`edge_type: "portal"`, `highway`, `conveying`, 건물 `levels`·`ground_levels`·`ext.floor_height_m`)에서 읽는다 |

## 2. 구성

| 파일 | 내용 |
|---|---|
| `geo.ts` | 기준점 하나의 로컬 ENU(m) 변환과 역변환(WGS84 곡률 반경), 방위각, 선분 투영, 점-다각형 판정. 캠퍼스 크기(수 km)에서 측지 거리와 0.1% 안으로 맞음(테스트) |
| `types.ts` | `SensorFix`, `MatchParams`·`DEFAULT_MATCH_PARAMS`, `MatchResult`, `MatchPoint`, `MatchScope`, `MatcherState`, `PortalRef`, `NavState`, `NavEvent`, `NavContext`, `NavParams`·`DEFAULT_NAV_PARAMS`, `RerouteReason`, `VerticalVia` |
| `network.ts` | `buildMatchNetwork`: 걷는 구간(edge id당 하나)을 폴리라인으로, 정점·길이·플래그를 typed array로, 40 m 격자 인덱스, 무방향 CSR 인접 리스트(엘리베이터는 평면 길이 0에 가까운 연결선으로만), 포탈 목록, 건물 외곽선·층 높이. `findCandidates`, 한계 거리를 둔 `searchFrom`/`routeDistance`(Dijkstra), `nearestPortal`, `isInsideBuilding` |
| `hmm.ts` | `createMatcherState`, `matchStep`(증분 Viterbi), `smoothedPath`(고정 지연 경로), `setMatchScope`, `resetMatcher` |
| `nav.ts` | `initialNavState`, `navStep`(순수 함수), `scopeForNav`, `buildNavRoute`, `navEventMessage`(한국어 안내 문구) |

### 2.1 사용 예

```ts
import { buildGraph, buildMatchNetwork, buildNavRoute, createMatcherState, initialNavState, matchStep, navEventMessage, navStep, scopeForNav, setMatchScope, type SensorFix } from '@campo/core';

const net = buildMatchNetwork(buildGraph(campus)); // 지도를 불러올 때 한 번
const matcher = createMatcherState();                // 추적 세션마다 하나
let nav = initialNavState(firstFix.tMs);
const route = buildNavRoute(net, plannedRoute.nodeIds); // 경로가 없으면 null

function onFix(fix: SensorFix) {
  setMatchScope(matcher, scopeForNav(nav));          // 실내에서는 그 층의 구간만 후보
  const r = matchStep(net, matcher, fix);            // matcher를 제자리 갱신
  const step = navStep(nav, r, fix, { net, route }); // 새 상태 + 이벤트
  nav = step.nav;
  for (const e of step.events) { const text = navEventMessage(e); if (text) speak(text); if (e.type === 'REROUTE') replan(); }
  draw(r.lat, r.lng, nav.level);
}
```

## 3. 매칭 네트워크

- 후보는 걷는 구간(footway·steps·corridor·ramp, 포탈·연결통로 포함)이다. 엘리베이터 구간은 걸을 선이 없어 후보가 아니고,
  인접 리스트에만 정차 지점 사이 연결선으로 들어간다(층을 바꿔도 HMM이 끊기지 않게).
- 구간 선의 양 끝은 from/to 지점 좌표로 바꾸고, 중간 꺾임점은 그린 선에서 가져온다(거꾸로 그렸으면 뒤집음).
- `MatchScope`
  - `ground`(기본): 바깥 구간, 포탈, 그리고 양 끝이 모두 그 건물 `ground_levels`인 실내 구간.
  - `floor`(실내, 층을 알 때): 한 건물 한 층에 닿는 구간(그 층 복도, 그 층에 닿는 포탈·계단·연결통로).
  - `all`: 모든 걷는 구간.
- 거리 계산(`d_route`)은 범위와 상관없이 전체 망을 따른다.

## 4. HMM(증분 Viterbi)

fix마다 망 후보 K ≤ 8개와 망 밖 자유(free) 의사 상태 하나를 둔다. 이전 fix의 점수에서 다음 점수를 한 번에 구하는
running max-product이고, 슬라이딩 윈도 재실행은 하지 않는다. 역추적 포인터는 W = 20 fix의 링버퍼에 둔다.

**상태를 제자리 갱신한다.** `matchStep`은 받은 `MatcherState`의 typed array를 고쳐 쓰고(fix당 할당은 결과 객체뿐) 새
`MatchResult`를 돌려준다. 세션마다 하나를 만들고 공유하지 않는다. `MatchNetwork.scratch`(Dijkstra 작업 공간)도 호출
사이에 덮어쓰므로 한 스레드에서만 쓴다.

| 항목 | 식 |
|---|---|
| sigma | `clamp(accuracyM × 1.0, 5, 30)` m. 직전 fix 대비 변위가 `vMax·dt`를 넘으면 그 fix만 ×3 |
| 후보 반경 | `R = clamp(3σ, 20, 80)` m, 가까운 순 K개 |
| emission | `log p = −0.5 (d/σ)²` (d: fix와 후보 사이 수직 거리). 자유 상태는 상수 −4.5 nats |
| transition | `−|d_route − d_gc| / β`, `β = max(3, (σ_prev + σ)/2)`. `d_route`는 무방향 최단거리(같은 구간이면 `|Δt|·len`), `d_gc`는 두 fix 사이 거리 |
| 불가능 전이 | `d_route > vMax·dt + 3σ̄`(vMax = 3.5 m/s). Dijkstra는 이 거리(최대 400 m)까지만 탐색 |
| 자유 상태 | 망↔자유 전환 −3 nats. 자유 상태 위치는 fix 자체. 자유→자유, 자유↔망도 직선거리로 같은 가능성 검사 |
| heading 항 | `κ (|cos Δθ| − 1)`, Δθ는 heading과 **후보 구간 선의 방향** 사이 각. 구간은 양방향으로 걷는 길이라 두 방향 중 가까운 쪽(U턴 허용). GPS course κ = 2.0(속도 ≥ 1.0 m/s), 나침반 κ = 0.8, 둘 다 없으면 직전 3초 표시 경로의 이동 벡터 κ = 1.0(2 m 이상 움직였을 때), 정지 중에는 끔 |
| outlier | `accuracyM > 50` 또는 좌표 NaN, 시각이 거꾸로 가면 관측 없음: 상태를 바꾸지 않고 직전 결과를 `skipped: true`로 돌려줌(후보 재생성 없음) |
| HMM break | 가능한 전이가 하나도 없거나 fix 간격이 30초를 넘으면 emission만으로 다시 시작(`restarted: true`) |
| 정지 모드 | 속도 < 0.5 m/s가 연속 2 fix면 진입, > 0.8 m/s면 해제. 정지 중 `d_gc = 0`, emission 가중 0.3, heading 끔, 출력 위치(구간·t·좌표) 고정. 속도는 GPS 속도 → 걸음 수(보폭 0.7 m) → 변위/dt 순으로 씀 |
| 고정 지연 | 현재 위치는 즉시 argmax(표시 히스테리시스 적용). `MatchResult.lagged`와 `smoothedPath(state, 4000)`는 현재 최고 상태에서 역추적한 4초 전 값 |
| 확신도 | 현재 fix 상태들의 점수 softmax에서 최고 상태의 확률 |

### 4.1 표시 히스테리시스

표시 후보는 **구간 단위**로 기억한다. 다음 fix에서 그 구간(자유 상태면 자유 상태)의 후보가 있으면, 최고 후보가 그
후보보다 1.5 nats 이상 높을 때만 표시를 바꾼다(`switched: true`). 단, 표시 중인 점이 표시 구간 끝 지점에서 3 m 안이고
최고 후보가 그 지점을 공유하는 구간이면 바로 넘어간다(교차로를 지나가는 정상 보행은 바꿈이 아님). 표시 구간이 후보에서
빠지면 최고 후보로 바꾼다.

## 5. 실내외 상태 머신(`navStep`)

다섯 상태 OUTDOOR / APPROACHING / PORTAL / INDOOR / OFF_NETWORK_SUSPECT. REROUTE는 상태가 아니라 이벤트다.
`navStep`은 이전 상태를 고치지 않고 새 상태와 이벤트(`MODE_CHANGED`, `REROUTE`, `FLOOR_CHANGED`)를 돌려준다.

증거

| 이름 | 정의 |
|---|---|
| gpsBad | accuracy > 20 m, 좌표 없음, 또는 직전 정상 fix와 간격 > 3 s |
| gpsGood | accuracy ≤ 12 m이고 간격 ≤ 3 s |
| nearPortal | 표시 위치에서 가장 가까운 포탈 구간까지 25 m 이내 |
| onPortalEdge | **지연 위치(lagged)** 가 포탈 구간 위. t는 바깥 끝에서 잰 비율 |
| freeDominant | 자유 상태가 최고이고 확신도 ≥ 0.6 |
| offNetwork | freeDominant 또는 망까지 거리 > max(25, 3σ) |
| offRoute | 계획 경로(`buildNavRoute`)까지 거리 > 20 m |

전이

| 전이 | 조건 |
|---|---|
| OUTDOOR → APPROACHING | nearPortal이고, 경로상 다음 지점이 그 포탈의 끝이거나 진행 방향이 포탈 쪽 ±60° |
| APPROACHING → PORTAL | 지연 위치가 포탈 구간에서 t > 0.5(또는 이미 실내 끝을 지남), 또는 gpsBad 3 s & nearPortal |
| APPROACHING → OUTDOOR | 포탈에서 35 m 넘게 멀어짐(25 m 진입에 대한 히스테리시스) |
| PORTAL(들어가는 중) → INDOOR | 지연 위치가 실내 쪽 지점을 지난 채(그 건물 실내 구간 위) 2 s 유지, 또는 PORTAL 들어온 뒤 gpsBad 6 s |
| PORTAL → OUTDOOR | PORTAL 들어온 뒤 gpsGood 5 s이고 fix가 건물 외곽선 밖(들어가는 중이면 오경보 복귀, 나오는 중이면 정상 퇴장) |
| PORTAL(나오는 중) → INDOOR | PORTAL 들어온 뒤 gpsBad 6 s(도로 들어감) |
| INDOOR → PORTAL(나오는 중) | 표시 위치가 그 건물·현재 층 포탈 15 m 이내이고 INDOOR 들어온 뒤 gpsGood 3 s |
| OUTDOOR → SUSPECT | offNetwork가 이동 중 누적 5 s |
| SUSPECT → OUTDOOR | 망 위로 돌아온 시간 3 s |
| REROUTE(off_network) | SUSPECT에서 offNetwork 누적 10 s |
| REROUTE(off_route) | OUTDOOR·APPROACHING·SUSPECT에서 offRoute 누적 8 s(실내에서는 GPS로 판정하지 않음) |

- 이탈 타이머(offNetwork·offRoute·복귀)는 정지 중과 skipped fix에서 멈춘다.
- REROUTE 뒤 15 s 쿨다운. 쿨다운 중에는 이벤트를 내지 않고 타이머만 유지한다.
- 시간 조건은 그 상태에 들어온 뒤부터 잰다(바깥에서 계속 좋던 GPS가 PORTAL에 들자마자 오경보 복귀를 일으키지 않게).
- `scopeForNav(nav)`: INDOOR이고 층을 알면 `floor`, 아니면 `ground`.

## 6. 층 판정(기압)

- INDOOR로 들어갈 때 그 fix의 `baroDeltaM`을 기준(dH = 0)으로, 포탈 실내 쪽 지점의 층을 기준 층으로 둔다.
- 층 높이는 `buildingStack.floorHeights`와 같은 규칙(건물 `ext.floor_height_m`, 없으면 3.9 m)으로 1층 바닥 기준 높이를
  구하고, 기준 층과의 차이를 층 후보 높이로 쓴다.
- 층 가능도는 `exp(−0.5 ((dH − h_L)/σ_h)²)`, σ_h = 1.0 m. 최고 층이 현재 층과 다르고 |d(dH)/dt| < 0.15 m/s가 2 s
  지속되면 `FLOOR_CHANGED`를 낸다(오르는 중에는 내지 않음).
- 수단: 그동안 최대 수직 속도 ≥ 0.8 m/s면 엘리베이터, 아니면 매칭된 수직 구간 종류(`steps` + `conveying` → 에스컬레이터,
  `steps` → 계단), 둘 다 없으면 unknown.

## 7. 파라미터

"문헌 근거"는 식의 형태나 값의 크기를 공개 문헌·표준에서 가져온 것, "초기 설계값"은 이 프로젝트가 정한 출발값으로
현장 기록으로 조정해야 하는 것이다.

| 파라미터 | 값 | 구분 | 근거·메모 |
|---|---|---|---|
| emission 가우시안 `−0.5(d/σ)²` | — | 문헌 근거 | Newson & Krumm 2009(HMM map matching)의 측정 확률 형태 |
| transition `−|d_route − d_gc|/β` | — | 문헌 근거 | Newson & Krumm 2009의 지수 분포 전이 형태 |
| σ = accuracy × 1.0, clamp 5–30 m | 1.0, 5, 30 | 초기 설계값 | 휴대폰 accuracy는 68% 반경(Android `Location.getAccuracy`) |
| R = clamp(3σ, 20, 80) m | 3, 20, 80 | 초기 설계값 | |
| K, W, L | 8, 20, 4 s | 초기 설계값 | 고정 지연 Viterbi(온라인 매칭 문헌의 일반 기법), 값은 Hermes 예산에 맞춤 |
| β 하한 | 3 m | 초기 설계값 | |
| vMax | 3.5 m/s | 문헌 근거 + 설계 | 보통 보행 1.2–1.5 m/s(보행 속도 연구), 뛰기까지 여유 |
| 불가능 전이 3σ̄ | 3 | 초기 설계값 | |
| free emission / 전환 | −4.5 / 3 nats | 초기 설계값 | −4.5 ≈ 3σ 거리의 emission: 그보다 멀면 자유 상태가 이김 |
| outlier accuracy | 50 m | 초기 설계값 | |
| 점프 σ 배수 | 3 | 초기 설계값 | |
| heading κ | 2.0 / 0.8 / 1.0 | 초기 설계값 | `κ(cos Δθ − 1)`은 von Mises 분포의 로그(상수 제외) |
| GPS course 최소 속도 | 1.0 m/s | 초기 설계값 | 저속 GPS course는 신뢰할 수 없음 |
| 정지 진입/해제 | 0.5 / 0.8 m/s, 2 fix | 초기 설계값 | |
| 정지 emission 가중 | 0.3 | 초기 설계값 | |
| 보폭 | 0.7 m | 문헌 근거 | 성인 평균 보폭 대략값 |
| 표시 히스테리시스 | 1.5 nats | 초기 설계값 | |
| 교차로 통과 거리 | 3 m | 초기 설계값 | 이번 구현에서 추가 |
| HMM 재시작 간격 | 30 s | 초기 설계값 | 이번 구현에서 추가 |
| Dijkstra 상한 | 400 m | 초기 설계값 | 이번 구현에서 추가 |
| gpsBad / gpsGood | 20 / 12 m, 공백 3 s | 초기 설계값 | |
| nearPortal / 이탈 히스테리시스 | 25 / 35 m | 초기 설계값 | 35 m는 이번 구현에서 추가 |
| 포탈 진입 t | 0.5 | 초기 설계값 | |
| 실내 확정 / GPS 잃음 | 2 s / 6 s | 초기 설계값 | 6 s는 이번 구현에서 추가 |
| 오경보 복귀 | gpsGood 5 s | 초기 설계값 | |
| 실내→포탈 | 15 m, gpsGood 3 s | 초기 설계값 | |
| SUSPECT 진입·복귀 | 5 s, 3 s, max(25, 3σ) | 초기 설계값 | |
| REROUTE | 10 s(망 이탈) / 8 s(경로 이탈), 쿨다운 15 s | 초기 설계값 | |
| 경로 이탈 거리 | 20 m | 초기 설계값 | 이번 구현에서 추가 |
| 기압 환산 | 약 0.12 hPa/m | 문헌 근거 | 지표 근처 정역학 근사(dp/dh = −ρg) |
| σ_h | 1.0 m | 초기 설계값 | |
| 층 확정 수직 속도·시간 | 0.15 m/s, 2 s | 초기 설계값 | |
| 엘리베이터 판별 수직 속도 | 0.8 m/s | 문헌 근거 + 설계 | 건물 엘리베이터 정격 속도는 대개 1 m/s 이상, 계단 수직 속도는 대개 0.5 m/s 미만, 에스컬레이터는 약 0.25 m/s(0.5 m/s × sin 30°) |
| 층고 기본값 | 3.9 m | 기존 결정 | `DEFAULT_FLOOR_HEIGHT_M`(buildingStack) |

## 8. 성능 예산

- 목표: Hermes에서 fix 하나(matchStep + navStep)가 10 ms 이내. 할당은 결과 객체와 nav 상태 사본뿐이다.
- 테스트(`perf.test.ts`): 2,025지점·3,960구간(10 m 격자, 실제 캠퍼스보다 훨씬 촘촘함), accuracy 25 m(σ 25, R 75 m),
  1,400 fix에서 평균 < 2 ms를 확인한다. 회귀(망 전체를 도는 step)를 잡는 넉넉한 경계라 흔들리지 않는다.
- 작성 시 측정(Node 22, V8): 평균 0.43 ms, p99 0.81 ms(accuracy 25 m) / 0.59 ms, p99 1.17 ms(50 m) / 0.03 ms(5 m).
  `buildGraph` 58 ms, `buildMatchNetwork` 27 ms(지도를 불러올 때 한 번).
- Hermes는 JIT가 없어 V8보다 몇 배에서 열 배 넘게 느릴 수 있다. 위 수치로는 실제 캠퍼스(구간 간격 수십 m)에서 여유가
  있지만, **실기기 측정은 아직 하지 않았다**. 현장 조사 앱에 붙일 때 기기에서 다시 잰다.
- 비용의 대부분은 이전 후보마다 한 번씩 도는 한계 Dijkstra(K ≤ 8회, 반경 vMax·dt + 3σ̄)다.

## 9. 한계

- 1 Hz 보행에서는 두 fix 사이 변위 `d_gc`가 GPS 잡음에 크게 흔들린다. 진행 방향 위치 오차는 거의 GPS 잡음만큼 남고,
  HMM은 주로 **어느 길인지**를 바로잡는다(격자 시험: 올바른 길 비율 0.94, 최근접 투영 0.66, 위치 오차 평균 6.0 m 대 8.1 m).
- heading 항은 구간 방향만 비교하므로 같은 구간 위의 앞뒤(진행 방향)는 heading으로 가리지 않는다.
- 실내에서는 GPS가 거의 쓸모없어 실내 위치는 마지막 매칭과 범위 필터에 기대고, 층은 기압으로만 바꾼다. 실내 보행자
  추측 항법(PDR)은 없다.
- 기압은 날씨로 천천히 흐른다(시간당 1 m 안팎). 포탈마다 기준을 다시 잡지만 한 건물에 오래 머물면 층 판정이 틀릴 수 있다.
- 층고가 건물마다 하나(`ext.floor_height_m` 또는 3.9 m)라 층마다 높이가 크게 다른 건물은 판정이 어긋날 수 있다.
- "건물 밖"은 건물 외곽선(첫 고리)으로만 판단한다. 층별 외곽선(`floor_outlines`)은 쓰지 않는다.
- 엘리베이터 구간은 후보가 아니므로 엘리베이터 안의 위치는 정차 지점 근처 복도로 나타난다.

## 10. 테스트(`packages/core/test/matching/`)

| 파일 | 확인하는 것 |
|---|---|
| `hmm.test.ts` | 합성 격자에서 최근접 투영보다 올바른 길 비율이 높음, 고정 지연 경로, 정지 떨림 억제와 해제, 평행 보도 점프 억제, U턴 추종, accuracy 100 m·NaN outlier 무시, HMM 재시작, 점프 σ×3, 재현성 |
| `nav.test.ts` | 실외→접근→포탈→실내(GPS 잃음 경로와 지연 위치 경로 둘 다), 오경보 복귀, 실내→포탈→실외, REROUTE 1회 + 15 s 쿨다운, 정지 중 이탈 타이머 멈춤, 망 이탈 의심·REROUTE·복귀, 기압 층 확정(계단·엘리베이터·기준 상수 무관·반 층 미만 무시), navStep 순수성 |
| `network.test.ts` | ENU 변환 정확도, 방위각, 후보 순서, 무방향 거리, campus-basic 포탈 목록·범위 필터·실제 edgeId 스모크, 루트 export, step 코드에 시계·난수·I/O 없음, graph.ts·route.ts에 level 없음 |
| `perf.test.ts` | 성능 예산(8장) |
