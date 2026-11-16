# 고도 보정 통합 (1차: core·솔버)

기압 Δh 측정, 국토지리정보원 DEM, 캠퍼스 지도 데이터를 합쳐 구간의 높이 차와 경사를 구하고, 길찾기가 그 경사를
시간과 프로필 벌점에 반영한다. 이번 1차 작업은 `packages/core`(스키마·길찾기·지연 재계산)와 `tools/elevation`
(Python 솔버)까지다. 편집기·현장 조사 앱 화면 연결은 12장의 2차 작업이다.

센서·버퍼·DEM 전처리의 세부 사실(Expo 센서 동작, σ 모델, NGII 자료)은 `docs/ELEVATION_IMPLEMENTATION.md`에 있다.
이 문서와 다르면 이 문서가 우선한다.

## 1. 원칙

| 원칙 | 구현 |
|---|---|
| 원본 DEM은 덮어쓰지 않는다 | 솔버는 `--dem` 격자를 읽기만 하고 결과는 `corrected_dem`, `residual_field`라는 새 파일로 쓴다(테스트가 DEM 파일 바이트를 비교) |
| 영속 데이터에 절대 기압이 없다 | `ElevationStore`의 관측은 `DhEdge`(Δh `dhM`, σ `sigmaM`, Δt `dtS`)뿐이다. 절대 기압은 `Ephemeral` 타입(메모리 버퍼)에만 있고, `serializeElevationStore`는 알려진 영속 필드만 골라 쓰는 화이트리스트라 휘발 관측이 섞여도 파일에 나가지 않는다 |
| 길찾기는 층 번호를 비교하지 않는다 | 경사는 구간 자신의 속성(`flat_exact`, `elev_diff_m`, `elev_sigma_m`, `grade_pct`)으로만 정한다. `costs.ts`·`graph.ts`·`route.ts`에 level이라는 낱말이 없음을 테스트가 확인 |
| 고도 데이터가 없는 지도는 예전과 똑같다 | 경사 속성이 없으면 링크의 시간·비용·막힘이 바이트 단위로 같다(테스트: fixture에서 `flat_exact`·`is_breakline`을 지운 그래프와 모든 링크 비교) |
| 데이터는 편집 동작으로만 바꾼다 | 계산 결과는 편집 동작 `setEdgeElevation` 하나로 쓴다(이력 한 줄, 되돌리기 가능) |
| 편집 중에는 다시 계산하지 않는다 | 편집·측정은 dirty만 표시하고, 사람이 재계산을 누를 때 그 성분과 타일만 다시 푼다(8장) |

## 2. 데이터 흐름

```
 현장 조사 앱                         packages/core/src/elevation                 tools/elevation (Python)
 ───────────                         ────────────────────────────                 ────────────────────────
 기압 10초 창 ─▶ PressureSessionBuffer ─▶ DhEdge(Δh, σ, Δt) ─▶ ElevationStore ──┐
 (절대 기압은 메모리만, TTL 30분)            addMeasurement / serializeElevationStore   │  --store
                                                                                 ├──▶ campo_height_solver.py
 편집기·앱 편집 동작 ─▶ Immer 패치 ─▶ markEditPatches ─┐                          │      1단계 WLS(측정 + 캠퍼스 제약)
 기압 측정 결과 ───────────────────▶ markMeasurements ─┤─▶ ElevationDirty           │      2단계 잔차장(Break-line)
                                                     └─▶ recomputeRequest ─(JSON)─┤  --dirty
 data/campuses/<id>/*.geojson ────────────────────────────────────────────────────┤  --campus
 NGII DEM ─▶ dem_prep.py ─▶ campo-grid(읽기 전용 Prior) ──────────────────────────┘  --dem
                                                                                        │
          setEdgeElevation(이력 한 줄) ◀─ applyDerivedElevation ◀─ readDerivedElevation ◀─┘ derived/elevation.json
                │                                                                        (+ corrected_dem, residual_field,
                ▼                                                                          store.solved.json)
   구간 elev_diff_m / elev_sigma_m / grade_pct ─▶ buildGraph: edgeGradePct → 시간(Tobler) + 프로필 경사 벌점
```

## 3. 스키마 변경 (campo.schema.json, types.ts `EdgeProperties`)

모두 선택 속성이다. `schema_version`은 "0.2" 그대로이고 `npm run migrate`는 이 값들을 건드리지 않는다(테스트).

| 속성 | 누가 쓰나 | 뜻 | 스키마 규칙 |
|---|---|---|---|
| `flat_exact` | 사람(현장 확인) | 평지로 확인한 구간. 솔버는 Δh = 0 강한 제약, 길찾기는 경사 0 | footway, corridor만 |
| `is_breakline` | 사람 | 지형 불연속(연석, 옹벽, 바깥 계단). 잔차 보간이 이 선을 넘어 퍼지지 않음. 없으면 바깥 계단(`edge_type: outdoor` + `steps`)이 불연속선, `false`로 끔 | footway, steps, ramp만. `flat_exact: true`와 함께 `true` 불가 |
| `elev_diff_m` | 재계산 | `to` 높이 − `from` 높이(m) | −200 ~ 200 |
| `elev_sigma_m` | 재계산 | `elev_diff_m`의 σ(m) | 0 초과, `elev_diff_m`과 함께 |
| `grade_pct` | 재계산 | `elev_diff_m` ÷ 평면 길이 × 100, from → to | −1000 ~ 1000, `elev_diff_m`과 함께 |

계산 값 셋은 `DERIVED_ELEVATION_PROPS`로 한 곳에 정의한다. 편집 동작과의 관계:

- `setEdgeElevation(values)`: 계산 값만 쓰는 동작. 다른 키, 숫자가 아닌 값, 0 이하 σ, 없는 구간은 거부하고 값이 안 바뀌는 구간은 rev를 올리지 않는다. 바뀔 것이 없으면 "바뀔 고도 값이 없습니다."
- `reverseEdge`: `elev_diff_m`, `grade_pct`의 부호를 뒤집는다(σ는 그대로).
- `splitEdgeAt`: 두 조각 모두에서 계산 값을 지운다(구간 전체의 값이었으므로). `flat_exact`, `is_breakline`은 사실이므로 둘 다 유지.
- `deleteNodes` heal: 계산 값이 달라도 합치기를 막지 않고, 남는 구간에서 지운다.
- 지운 값은 다음 재계산이 다시 쓴다(편집이 dirty를 남기므로).

## 4. 경사 길찾기 (costs.ts, graph.ts, route.ts)

### 4.1 경사 구하기 `edgeGradePct(edge, planLengthM, traversal)`

1. steps·elevator → 없음(계단은 `stairsTimeSec`, 엘리베이터는 board/hop/alight 규칙 그대로)
2. `flat_exact: true` → 0
3. `elev_sigma_m / 평면 길이 × 100`이 `GRADE_MAX_SIGMA_PCT`(3%p)를 넘으면 → 없음(믿을 수 없는 경사)
4. `elev_diff_m / 평면 길이 × 100`(평면 길이 > 0), 없으면 `grade_pct`
5. 그린 방향의 반대로 지나가면 부호를 뒤집는다

평면 길이는 링크 길이와 같은 지점 좌표 사이 측지 거리다.

### 4.2 시간

경사가 있으면 `걷는 시간 × slopeTimeFactor(경사)`, 없으면 예전 그대로(경사로는 `RAMP_FACTOR` 1.2).
`slopeTimeFactor`는 Tobler 보행 함수를 평지 기준으로 나눈 값 `exp(3.5 · (|S + 0.05| − 0.05))`(S = 경사 비율)다.
평지 1, +5% 1.19, +8% 1.32, −5% 0.84, −10% 1.0. 내리막이 평지보다 빠를 수 있으므로 A* 휴리스틱 속도는 기존
`heuristicSpeedMps` 규칙(가장 빠른 링크)이 자동으로 맞춘다. 측정 시간 보정(calibration)이 있으면 그 시간이 우선하고
경사 벌점만 더한다(측정에 이미 경사가 들어 있음).

### 4.3 프로필 벌점 (비용에만, 시간에는 안 넣음)

경사 등급 `gradeClass`: |g| ≤ 5% 완만(gentle), ≤ 8% 주의(caution), 초과 급경사(steep).
벌점 = 평면 길이(m) × 아래 표 × (내리막이면 `DOWNHILL_GRADE_PENALTY_FACTOR` 0.5). 미터당으로 둔 이유는 구간을
나눠도 합이 같게 하려는 것이다. 급경사도 막지 않는다(경사는 오차가 있는 추정값이므로).

| 프로필 | 주의(초/m) | 급경사(초/m) | 예: 오르막 20 m 급경사 |
|---|---|---|---|
| shortest | 0 | 0 | 0초 |
| step_free | 0 | 2 | 40초 |
| fewest_steps | 0 | 2 | 40초 |
| elevator_first | 1 | 4 | 80초 |
| wheelchair | 3 | 15 | 300초 |

경사를 아는 경사로(ramp)는 `RAMP_PENALTY_SEC`(30초) 대신 위 경사 벌점을 낸다. 경사를 모르는 경사로는 예전처럼 30초.
상수는 모두 `costs.ts`에 있다(`GRADE_GENTLE_MAX_PCT`, `GRADE_CAUTION_MAX_PCT`, `GRADE_MAX_SIGMA_PCT`, `TOBLER_K`,
`TOBLER_OFFSET`, `GRADE_PENALTY_SEC_PER_M`, `DOWNHILL_GRADE_PENALTY_FACTOR`).

### 4.4 결과

`WalkLinkData.gradePct`(링크 방향 %, 없으면 null)와 `Route.slopeSegments`(경로 위 주의·급경사 구간: edgeId, from, to,
gradePct, gradeClass)가 추가됐다. 안내 문장(route-text)은 걷기·경사로 단계에 급경사(8% 초과) 구간이 있으면 문장 끝에 "(경사가 급한 길입니다)"를 붙이고 `RouteStep.steep: true`를 둔다(2차, 12장).

## 5. 솔버 규칙 (campo_height_solver.py)

### 5.1 변수

| key | 무엇 | DEM prior |
|---|---|---|
| `op:<uuid>` | 기압으로 잰 바깥 지점(ElevationStore) | 있음 |
| `cn:<캠퍼스 지점 id>` | 캠퍼스 바깥 지점(`--campus`) | 있음(불연속선 구간 끝은 σ × 2) |
| `fp:<건물 Feature id>:<층 id>` | 층 평면. 캠퍼스 건물 안 지점은 모두 자기 층 평면에 묶인다. 층 id는 `floorIdOfLevel`(1 → `1F`, −1 → `B1`), TS와 Python이 같은 규칙 | 없음 |

### 5.2 관측과 제약

| kind | 식 | σ | 비고 |
|---|---|---|---|
| measured | 기압 Δh 엣지 | 엣지의 `sigmaM` | Baarda snooping, Huber IRLS, χ² 검정 대상은 이것뿐 |
| floor_prior | H(다음 층) − H(층) = 층고 × 층 수 | 1.0 m × √층 수 | 층고 = `ext.floor_height_m`, 없으면 **3.9 m**. 건물 `levels`의 이웃한 층끼리(0층은 없으므로 B1→1F는 한 층). 측정이 없는 층도 발산하지 않는다 |
| step_count | 계단 Δh = ±칸 수 × 0.16 m | max(0.05, 0.015 × 칸 수) m | 방향은 `incline`, 없으면 양 끝 층 번호. 방향을 모르면 쓰지 않고 로그를 남긴다. 에스컬레이터 제외 |
| flat_exact | Δh = 0 | 0.01 m | 강한 제약 |
| soft_flat | Δh = 0 | 1% × 평면 길이 | 표시 없는 footway(포탈 포함, 불연속선 아님). 아래 5.3 |

기압 Δh(σ 0.3~0.45 m)와 계단 칸 수(24칸이면 σ 0.36 m)가 층고 prior(σ 1 m)보다 4~10배 무거워 실측이 우선한다(테스트:
4.6 m로 잰 층은 4.6 m, 28칸 계단은 4.48 m, 아무것도 안 잰 층만 3.9 m).

### 5.3 평지 보정(soft_flat)

표시 없는 footway는 처음에 모두 평지 제약을 켜고, 각 행을 **뺐을 때의 경사**(leave-one-out: Δh₋ⱼ = vⱼ / rⱼ, r은
redundancy)가 1%를 넘으면 실제 경사로 보고 끈다. 가장 큰 것 하나를 끄고 다시 풀기를 반복한다. 한 번에 여럿을 끄면
datum 없는 부분이 생길 수 있어서다(1층·4층 포탈 두 개로만 땅에 닿은 언덕 건물에서 실제로 생김, 테스트). redundancy가
거의 0인 행(다른 근거가 전혀 없음, 예: 포탈 하나로만 이어진 건물)은 검정하지 않고 평지로 둔다. 기압 측정이 있으면
측정이 경사를 정한다(DEM이 평평해도 4%로 잰 길은 4%).

### 5.4 Break-line

캠퍼스 불연속선 구간(`isBreakline`)은 구간 가운데에 수직인 길이 6 m(반폭 3 m) 선으로 바꾸고, `ElevationStore.breaklines`
(사람이 그린 WGS84 꺾은선)도 함께 쓴다. 잔차장에서 센터 → 격자점 선분이 불연속선을 가로지르면 커널에
`--breakline-attenuation`(기본 0, 완전 분리)을 곱한다. fusion은 반대편에 정확히 0, rbf는 센터 쌍 Φᵢⱼ에도 같은 감쇠를
곱한다(λΣ 대각 덕분에 풀리지만 양정치 보장은 감쇠가 없을 때만). 지지 반경은 그대로라 타일 국소 갱신은 여전히 전체
재계산과 정확히 같다(테스트).

### 5.5 출력

- `corrected_dem.*`, `residual_field.*`: 새 campo-grid 파일
- `store.solved.json`: 엣지 qc, `estimates`(op:/fp:만), `lastSolve`
- `derived/elevation.json`(`--derived-out`, `--campus` 필요):
  ```json
  { "format": "campo-derived-elevation/1", "runId": "…", "solvedAt": 0,
    "nodes": { "<지점 id>": { "z_m": 30.98, "sigma_m": 0.3, "floating": false } },
    "edges": { "<구간 id>": { "elev_diff_m": 0.71, "elev_sigma_m": 0.3 } } }
  ```
  지점 σ는 상대 σ(공통 datum 오차 제외), 구간 σ는 같은 성분의 공분산을 반영한 √(Qaa + Qbb − 2Qab)다. 양 끝이 같은
  층 평면인 구간과 엘리베이터 구간은 쓰지 않는다. SPEC.md 5장의 `derived/elevation.json` 자리이고 `derived/`는 git에서
  제외된다.

## 6. 지연 재계산 (recompute.ts)

| 단계 | 함수 | 하는 일 |
|---|---|---|
| 편집 | `markEditPatches(dirty, patches, state)` | 동작의 Immer 패치 경로(path[0] 컬렉션, path[1] 키)에서 솔버 입력이 바뀐 것만 표시. 지점: 좌표, node_type, building_id, level. 구간: 추가·삭제, 꺾은점, from, to, highway, edge_type, flat_exact, is_breakline, step_count, incline. 건물: levels, ground_levels, ext. 그 밖(이름, hours 등)과 재계산 결과 쓰기(`setEdgeElevation`)는 표시하지 않는다 |
| 측정 | `markMeasurements(dirty, result, store)` | 새 엣지와 대체된 엣지의 양 끝 높이 변수 |
| 요청 | `recomputeRequest(dirty, state)` | 지점 → 이어진 구간 → 그 양 끝으로 넓힌 정렬된 JSON(`campo-elevation-dirty/1`) |
| 풀기 | `campo_height_solver.py --dirty req.json --previous-residual … --previous-derived …` | 요청에 닿는 성분만 다시 푼다(성분은 독립이라 결과가 전체 풀이와 같음). 잔차장은 그 성분 센터의 dirty 타일만 갱신, derived는 안 푼 성분 값을 그대로 둔다 |
| 반영 | `applyDerivedElevation(state, derived, req)` | `setEdgeElevation` 한 번: cm 단위 Δh·σ(σ 최소 1 cm), 평면 길이 0.5 m 이상이면 0.1% 단위 grade_pct. 요청에 있었지만 결과에 없는 구간은 옛 값을 지움. 엘리베이터 제외 |
| 정리 | `clearDirty(dirty, req)` | 요청에 들어간 것만 지움(요청 뒤에 생긴 표시는 남음) |

`ElevationDirty`는 바뀌지 않는 값(set 4개)이라 화면 상태에 그대로 둘 수 있다. History는 지금 패치를 밖으로 내주지
않으므로 편집기는 동작 실행 시 패치를 받는 기존 실시간 검사 경로에서 `markEditPatches`를 부르면 된다(2차).

## 7. ElevationStore (store.ts, types.ts)

- `ElevationStore` = `ElevationStoreV1`(`schemaVersion: 1`). `breaklines?: BreakLine[]`와 `NodeEstimate.sigmaRelM?`이 선택
  항목으로 추가됐다(없는 예전 파일도 그대로 읽힘).
- `addMeasurement(store, node, result)`: 노드 넣기·바꾸기, 대체 엣지 `qc: 'superseded'`, 새 엣지 추가(같은 id는 건너뜀).
- `serializeElevationStore(store)`: 화이트리스트 직렬화. 엣지의 `model`(σ 모델 파라미터 `tempC`, `sigmaInstFloorHpa`,
  `driftHpaPerHour`)은 측정값이 아니라 재현용 설정이다.

## 8. 실행

```bash
# DEM 준비(한 번): docs/ELEVATION_IMPLEMENTATION.md 2장
python tools/elevation/dem_prep.py contours … --out out/hy_tin

# 전체 풀이
python tools/elevation/campo_height_solver.py --store elevation_store.json --dem out/hy_tin.json --sigma-dem 2.0 \
  --campus data/campuses/hanyang-seoul --out out/solve --derived-out derived/elevation.json

# 지연 재계산(편집기·앱이 recomputeRequest를 dirty.json으로 저장한 뒤)
python tools/elevation/campo_height_solver.py --store elevation_store.json --dem out/hy_tin.json --sigma-dem 2.0 \
  --campus data/campuses/hanyang-seoul --out out/solve2 --derived-out derived/elevation.json \
  --dirty dirty.json --previous-residual out/solve/residual_field.json --previous-derived derived/elevation.json
```

선택 인자: `--floor-height-default 3.9`, `--floor-prior-sigma 1.0`, `--soft-flat-max-grade 0.01`,
`--breakline-attenuation 0`, `--method fusion|rbf`.

## 9. 테스트

| 위치 | 내용 |
|---|---|
| `packages/core/test/elevation/sensors.test.ts` | 옮겨 온 11개(기압 창, MAD, 버퍼 pair/roundtrip, TTL, 상태 머신, 사진 매핑) + floorIdOfLevel |
| `packages/core/test/elevation/store-recompute.test.ts` | 화이트리스트 직렬화(기압 없음), addMeasurement, isBreakline, dirty 표시·무시·자기 쓰기 무시, 요청 확장, 결과 반영, clearDirty |
| `packages/core/test/elevation/derived-contract.test.ts` | Python이 campus-basic로 만든 derived 파일 → 반영 → 스키마 검사 → 길찾기(DEM만으로는 경로 불변) |
| `packages/core/test/routing/grade.test.ts` | 경사 등급·σ 차단·Tobler·벌점·방향, 언덕 경로(프로필별 우회), 측정 시간과 벌점, 경사로, 하위 호환, 층 번호 없음 |
| `packages/core/test/edit/elevationProps.test.ts` | setEdgeElevation, reverse 부호, split·heal에서 지움 |
| `packages/core/test/validate.test.ts`, `migrate.test.ts` | 새 스키마 규칙, migrate가 값을 유지 |
| `tools/elevation/test_campo_height_solver.py`, `test_dem_prep.py` | 옮겨 온 15개 |
| `tools/elevation/test_campus_constraints.py` | 층고 prior·실측 우선, flat_exact, 1% 평지 보정·LOO, 언덕 건물 포탈, Break-line(fusion/rbf, 감쇠, 타일), 성분 제한 풀이, derived σ, CLI(--campus, --dirty, DEM 불변) |
| `tools/elevation/test_core_contract.py` | campus-basic 솔버 출력 = 커밋된 TS fixture(`CAMPO_UPDATE_FIXTURES=1`로 갱신) |

## 10. 알려진 한계

- DEM prior를 지점마다 독립으로 둔다. 실제 DEM 오차는 공간적으로 강하게 상관돼 있어, DEM만 있을 때 구간 σ가 크게 나오고
  (90 m DEM σ 3 m면 수 m) 길찾기는 그 경사를 쓰지 않는다. 기압 측정이나 1 m급 DEM(σ 0.5 m 안팎)이 들어와야 경사가 반영된다.
- 같은 층 평면 안의 단차(반 층, 복도 안 몇 칸 계단)는 층 평면 모델에 없다(`intraOffsetM`은 측정에만 있음).
- 연결통로(bridge)·실내 경사로는 soft_flat 대상이 아니다(요구 범위는 footway).
- 불연속선은 구간 가운데의 짧은 수직선으로만 만든다. 구간을 따라 이어지는 옹벽은 `ElevationStore.breaklines`로 그려야 한다.
- rbf + Break-line은 양정치성이 보장되지 않는다(fusion 권장, 기본값).

## 11. 결정과 명세 관계

SPEC-v0.2 9장은 "경사도 계산, 고도 데이터 합치기"를 v0.2 범위 밖으로 두었고, 현장 조사 앱 명세(SPEC-mobile)는 측정값을
지도 원본에 넣지 않는다고 했다. 이번 통합은 사용자 요청(2026-11-15)으로 그 범위를 연 것이다. 측정값(기압)은 여전히 지도
원본에 들어가지 않고, 지도 원본에는 **사람이 확인한 사실**(`flat_exact`, `is_breakline`)과 **재계산이 쓰는 파생 값**
(`elev_*`, `grade_pct`)만 들어간다. docs/decisions.md 2026-11-15 항목 참고.

## 12. 2차 작업: 화면 연결

| 할 일 | 위치 | 쓸 것 |
|---|---|---|
| 편집 동작마다 dirty 표시, 상태 표시줄에 "고도 다시 계산 필요 N곳" | packages/editor | `markEditPatches`, `isClean` |
| "고도 다시 계산" 버튼: 요청 JSON 저장 → 솔버 실행(개발 서버) → 결과 반영(이력 한 줄) | packages/editor (+ 개발 서버) | `recomputeRequest`, `readDerivedElevation`, `applyDerivedElevation`, `clearDirty` |
| 속성 패널에 `flat_exact`, `is_breakline` 토글, 계산 값은 읽기 전용 표시. 구간 종류를 계단 등으로 바꿀 때 `flat_exact`를 함께 지움(제보 처리 stairs_unmarked는 이미 지움) | packages/editor | 스키마 규칙(3장) |
| 경로 테스트 탭에 주의·급경사 구간 표시, 안내 문장에 "경사가 급한 길" | packages/editor, core route-text | `Route.slopeSegments` |
| 불연속선 그리기 도구(옹벽 등), 지도에 불연속선 표시 | packages/editor | `BreakLine`, `isBreakline` |
| 측정 FAB·십자선·카운트다운 시트·"측정된 기압" 메뉴 | apps/mobile | `useMeasureFlow`, `useBarometerSample`, `measuredPressureBuffer` |
| `ElevationRepo` 구현(expo-file-system 로컬 JSON) | apps/mobile | `addMeasurement`, `serializeElevationStore`, `markMeasurements` |
| `app.json`에 expo-sensors `motionPermission` 플러그인 문구 | apps/mobile | ELEVATION_IMPLEMENTATION.md 1장 |
| 검사 경고: flat_exact 구간의 계산 Δh가 σ 밖, 경사로 grade가 8% 초과 | packages/core validate | 새 경고 코드 |
| SPEC-v0.2 3.4 프로필 표에 경사 벌점 반영 | docs | 4.3장 |
| σ 모델·층고 prior·DEM σ를 팀 실측으로 다시 맞춤 | tools/elevation | ELEVATION_IMPLEMENTATION.md 4·7장 |

### 12.1 2차 작업 결과 (2026-11-15)

| 할 일 | 상태 | 구현 |
|---|---|---|
| dirty 표시, "고도 다시 계산 필요 N곳" | 완료 | `app/useElevation.ts`: 화면 상태가 바뀔 때마다(동작, 되돌리기, 다시 하기, 끌기) core `markStateChange`(이전·다음 상태의 레코드를 참조로 비교해 패치 경로를 만든 뒤 `markEditPatches`). 개수는 `dirtyCount`, 상태 표시줄 `StatusBar` |
| 고도 다시 계산 | 완료 | `server/elevation-api.ts` `POST /api/elevation/:id/recompute`: 저장 전 캠퍼스 파일을 임시 폴더에 쓰고 `--dirty`(+ 이전 residual·derived)로 솔버 실행. 폴더 `derived/<캠퍼스>/`(`CAMPO_ELEVATION_DIR`)에 `store.json`, `dem.json`(`CAMPO_ELEVATION_DEM`)이 없으면 이전 `elevation.json`을 그대로 읽는다. 결과는 `planRecomputeResult`(→ `applyDerivedElevation`) 이력 한 줄, 그다음 `clearDirty` |
| 속성 패널 토글·읽기 전용 값, 종류 변경 시 flat_exact 지움 | 완료 | `PropertiesPanel` 고도 칸(스키마가 막는 토글은 이유와 함께 흐리게), `model/menu.ts` 종류 바꾸기가 `kindChangeExtras`로 같은 이력에서 flat_exact·is_breakline을 지움 |
| 경로 테스트 경사 구간, 안내 문장 | 완료 | 지도에 주의(노랑)·급경사(빨강) 줄무늬(`SLOPE_LAYERS`), 경로 카드에 개수와 가장 가파른 곳, route-text `STEEP_NOTE` |
| 고도 단절선(옹벽·단차) 그리기 | 완료 | 도구 `breakline`(B, 바깥): 그린 선은 지도 데이터가 아니라 `store.json`의 `breaklines`(`PUT /api/elevation/:id/store`, 절대 기압이 든 파일은 거부). 그리거나 지우면 30 m 안 지점이 dirty. 지도에는 그린 선을 옹벽 기호(실선 + 한쪽 이빨)로, 불연속선 구간(바깥 계단, is_breakline)은 갈색 점선으로 표시. 상태 표시줄의 [고도 다시 계산]은 바뀐 곳이 없어도 "고도 최신"과 함께 늘 보이고, 그때는 누르지 못하며 툴팁으로 안내 |
| 앱의 측정된 기압 지도 표시 | 완료 | 메뉴 [측정된 기압]은 잰 지점을 지도에 핀으로 표시(메모리에 남은 분, 지나면 "저장됨"). 핀을 누르면 다시 재기(같은 key) 또는 삭제(`removeHeightNode` + 버퍼 `forgetNode`, 이어진 Δh 엣지의 다른 끝은 dirty) |
| 측정 FAB·카운트다운·"측정된 기압" | 완료 | `ui/measureSheets.tsx`: 메뉴 버튼 위 FAB → 십자선 [여기서 측정](층 안이면 그 층 평면, 바깥이면 3 m 안에서 전에 잰 지점을 다시 씀) → 안정화·10초 링 → 결과(좋음·보통·다시), 끝날 때 진동. 메뉴 "측정된 기압"은 메모리 버퍼 목록과 남은 시간, 기록 지우기 |
| `ElevationRepo` | 완료 | `storage/elevationRepo.ts`: `elevation/store.json`(`serializeElevationStore`, 임시 파일을 거쳐 씀), `elevation/dirty.json`(`markMeasurements`의 heightNodes), 설치 id. 내보내기 zip에 `elevation_store.json`, `elevation_dirty.json`(Δh·σ·Δt만) |
| `motionPermission` | 완료 | app.json 문구 |
| 검사 경고 | 완료 | W15 `flat-exact-not-flat`, W16 `steep-ramp`(SPEC-v0.2 8장) |
| 남은 일 | — | 편집기 현장 기록 불러오기가 zip의 `elevation_store.json`을 `derived/<캠퍼스>/store.json`에 합치는 것(지금은 손으로 복사), SPEC-v0.2 3.4 프로필 표, σ 모델 재추정 |

### 지형 3D와 건물 3D (편집기)

- 지도 왼쪽 위 [3D](건물)와 [지형] 버튼은 따로 켜고 끈다. 둘 중 하나라도 켜지면 지도가 52° 기운다. 그리는 것은 deck.gl(MapboxOverlay)이고 클릭·끌기는 그대로 2D 편집기가 받는다.
- 지형 고도: `derived/<캠퍼스>/solve/corrected_dem.json`(솔버 보정 결과: flat_exact, 평지 ±1%, 계단, 기압 Δh, 단절선 반영) → `dem.json` → 둘 다 없으면 샘플 언덕(화면에 "실제 고도 아님" 표시). 개발 서버 `GET /api/elevation/:id/terrain`이 EPSG:5186 그리드를 한 변 160칸 이하로 줄여 보낸다.
- 지형 위에는 바깥 구간(4 m마다 지형을 따라)과 건물의 지면 층(`ground_levels`) 외곽선을 올린다. 건물은 지면 층 외곽선 아래 가장 낮은 지형 높이에 서고, 층은 `buildingStack`(측정 층고 → `floor_height_m` → 3.9 m)대로 쌓인다. 지하층은 지면 아래.
- 건물 3D에서 건물·층을 고르면 그 건물의 실내 지점과 구간을 높이대로 띄운다: 고른 층은 픽토그램과 진한 선, 다른 층은 작은 점과 연한 선, 엘리베이터·층 사이 계단은 수직선(같은 elevator_id의 정차 지점도 한 줄로 잇는다).
- 높이 과장: 둘 중 하나가 켜져 있으면 지도 왼쪽 아래에 슬라이더와 숫자 칸(0.5~2.5배, 0.1 단위)이 뜬다. 지형 메쉬·격자선, 건물 층 높이(층고 × 배율), 실내 지점, 경로, 지형 피킹이 모두 같은 배율을 쓴다. 화면 상태(`Workspace`의 `exaggeration`)일 뿐 저장하지 않으며, 3D를 껐다 켜도 유지되고 새로고침하면 1배로 돌아간다.
- 경로 테스트 결과도 3D에 그린다(`deck3d.ts` `routeLayers`): 경로선(흰 테두리 + 프로필 색), 주의·급경사 구간, 직접 선택의 점선, 출발·도착 핀. 바깥 점은 지형 + 0.9 m, 실내 점은 그 건물·층 바닥 + 0.9 m(`RouteLine.refs`: 지점이면 그 지점의 범위, 직접 선택한 끝과 수선의 발이면 고른 범위). 바깥끼리는 4 m마다 지형을 따르고, 실내·엘리베이터·출입구 연결은 직선. 지형과 층판에 가리지 않게 깊이 검사 없이 맨 위에 그린다.
- 지형 피킹: 지형 3D가 켜져 있으면 클릭·끌기·미리보기·Terra Draw(길·건물 외곽선·고도 단절선 그리기)·경로 테스트 직접 선택의 위치를 커서 아래 시선과 지형 메쉬가 만나는 곳으로 잡는다(`terrain3d.ts` `pickSurface`: deck.gl과 같은 카메라의 `WebMercatorViewport.unproject(targetZ)`로 위에서 아래로 걸으며 교차를 찾고 이분법으로 좁힘). 지점·구간을 고르거나 붙일 때 비교하는 화면 위치도 지형 높이로 투영한다. 저장하는 좌표는 그대로 2D [lng, lat]. 그리는 중인 도형은 지형에 가려지므로 지형 위에 한 번 더 그린다.

### 고도 단절선을 고치면 다시 계산이 필요해진다

- 단절선을 그리거나 낮은 쪽·높이차·꺾은점을 고치거나 지우면 주변 30 m에 지점이 없어도 `ElevationDirty.breaklines`(선 id → 그 선이 덮던 영역 상자, 고치기 전·후)에 표시되어 `dirtyCount`가 1 이상이 되고 [고도 다시 계산]이 눌린다. 같은 선을 다시 고치면 영역이 더해지고, 계산 중에 또 고친 선은 `clearDirty` 뒤에도 남는다.
- `recomputeRequest`의 `breaklines: [{ id, boxes }]`를 솔버(`campo_height_solver.py --dirty`)가 읽는다. 그 상자를 지나는 캠퍼스 구간은 다시 풀고(낮은 쪽·높이차 제약이 생기거나 사라진다), 잔차장은 상자를 가장 큰 영향 반경만큼 넓힌 곳의 타일을 다시 계산한다. 그래서 `corrected_dem.json`이 바뀌고, 편집기는 계산이 끝나면 지형 그리드를 다시 읽어 지형 3D에 반영한다.
