# CAMPO 고도 보정: 구현 가이드 (v1 정지 측정 → v2 연속 보행·사진)

> 앞 리서치 보고서의 이론(2단계 하이브리드, hypsometric, 스키마 개념)은 반복하지 않고, **코드에 바로 넣는 데 필요한 사실과 결정**만 정리했다.
> 기준: Expo SDK 58 (expo 58.0.25, expo-sensors 58.0.5, expo-keep-awake 58.0.4, react-native 0.88.1), 2026-11-15 확인.
>
> 이 문서는 campo-elevation 묶음에서 옮겨 온 구현 가이드다. 레포에 합친 구조·경사 길찾기·캠퍼스 제약·지연 재계산은
> **docs/ELEVATION_INTEGRATION.md**에 있다(이 문서와 다르면 그쪽이 우선).

## 0. 폴더 구조와 실행

```
packages/core/src/elevation/       ← '@campo/core/elevation' 으로 import (packages/core/package.json exports)
  types.ts                 ← 공용 타입(영속 타입 ElevationStore에는 절대 기압 필드가 아예 없음)
  barometerWindow.ts       ← 10초 창 수집기(Welford 실시간 평균, MAD, 정지 판별) — 순수 TS
  pressureSessionBuffer.ts ← TTL 30분 휘발 버퍼 → Δh 엣지(static_pair / roundtrip)
  measureMachine.ts        ← 측정 UI 상태 머신(useReducer용 순수 리듀서)
  photoMapping.ts          ← (v2) 사진 → 경로 구간 + 정/역방향
  store.ts                 ← 저장소 반영(addMeasurement)·화이트리스트 직렬화(serializeElevationStore)
  recompute.ts             ← dirty 기록과 명시적 재계산 요청·결과 반영(ELEVATION_INTEGRATION.md)
  breakline.ts             ← isBreakline
packages/core/test/elevation/      ← Vitest (sensors.test.ts가 원래 node:test 11개를 옮긴 것)
apps/mobile/src/features/elevation/
  useBarometerSample.ts    ← Expo 센서 훅(가용성·권한·keep-awake·백그라운드 중단)
  useMeasureFlow.ts        ← 머신 + 훅 + 버퍼 + 저장소 연결 (화면 연결은 2차 작업)
tools/elevation/
  campo_grid.py            ← 경량 격자 포맷(json+bin) 읽기/쓰기/쌍선형 샘플
  dem_prep.py              ← NGII DEM/수치지형도 → 캠퍼스 클립 → COG + campo-grid
  campo_height_solver.py   ← 1단계 WLS(+캠퍼스 제약) + 2단계 Wendland 잔차장(+Break-line) (CLI)
  test_*.py                ← pytest
```

```bash
# TS (packages/core 테스트, 타입 체크) — 루트에서
npx vitest run packages/core/test/elevation
npm run typecheck

# Python (레포 밖 가상환경 권장)
python -m venv %LOCALAPPDATA%\campo-elev-venv
%LOCALAPPDATA%\campo-elev-venv\Scripts\python -m pip install -r tools/elevation/requirements.txt
cd tools/elevation && %LOCALAPPDATA%\campo-elev-venv\Scripts\python -m pytest -q
```

앱은 `@campo/core/elevation`(패키지 exports의 하위 경로)으로 가져온다. 경로 별칭은 필요 없다.

---

## 1. Expo Barometer와 Accelerometer: 팩트체크 결과

공식 문서와 **expo-sensors 58 네이티브 소스**(`ios/BarometerModule.swift`, `android/.../SensorSubscription.kt`)를 직접 확인했다.

| 항목 | Android | iOS | 코드 반영 |
|---|---|---|---|
| 압력 단위 | hPa (`Sensor.TYPE_PRESSURE` 값 그대로) | hPa (CMAltimeter kPa를 모듈이 ×10) | 단위 변환 불필요. 300~1100 hPa 밖은 버림 |
| `relativeAltitude` | **없음** | 있음(첫 이벤트 기준 m) | 사용 안 함. 양 플랫폼 모두 압력으로 직접 Δh 계산(같은 식, 같은 σ 모델) |
| `setUpdateInterval` | 센서는 `SENSOR_DELAY_NORMAL`로 등록하고, JS로 보내는 이벤트만 간격(기본 100 ms)으로 솎음. `HIGH_SAMPLING_RATE_SENSORS` 권한이 있으면 `SENSOR_DELAY_FASTEST` | **no-op**(소스에 "Nothing we can do"). CMAltimeter 고정 주기, 개발자 보고로는 약 1 Hz | iOS는 10초에 표본 10개 안팎 → `minSamples`를 iOS 7 / Android 20으로 분리 |
| Android 12+ 200 Hz 제한 | 200 Hz 초과 시 `HIGH_SAMPLING_RATE_SENSORS` 필요 | 해당 없음 | 기압엔 불필요(기압계 자체가 그만큼 빠르지 않음) |
| `timestamp` | `SensorEvent.timestamp` ns ÷ 1e9 = **부팅 후 초** | `CMLogItem.timestamp` = **부팅 후 초** | 에폭 시각이 아님 → 시간창 매칭은 `Date.now()`, 센서 ts는 중복 제거에만 사용 |
| 백그라운드 | `OnActivityEntersBackground`에서 구독 중단 | 큐 중단 가능 | `AppState`가 active가 아니면 측정 무효(`app_background`) |
| `isAvailableAsync()` | 기본 센서가 있으면 true | `CMAltimeter.isRelativeAltitudeAvailable()` | try/catch로 감싸 예외는 false. false면 FAB 자체를 숨김 |
| 권한 | 기본 granted | 동작 및 피트니스 권한(`NSMotionUsageDescription`). iOS 17.4 팝업 버그 우회 코드가 모듈에 있음 | `getPermissionsAsync` 후 필요 시 `request…` |
| 시뮬레이터 | 에뮬레이터 확장 제어로 가상 압력 가능 | **기압계·가속도계 없음** | 실기기 테스트 필수 |
| 가속도 단위 | g (모듈이 `GRAVITY_EARTH`로 나눔) | g | 정지 판별 임계는 \|a\| 표준편차 0.03 g |
| 화면 꺼짐 | `expo-keep-awake` `activateKeepAwakeAsync(tag)` / `deactivateKeepAwake(tag)` | 동일 | 태그 `campo-barometer-window`로 측정 중에만 켜고, 실패해도 측정은 진행 |

`app.json` 설정:

```json
{
  "expo": {
    "plugins": [
      ["expo-sensors", { "motionPermission": "캠퍼스 계단·층 높이를 보정하기 위해 기압 센서를 사용합니다." }]
    ]
  }
}
```

**10초 측정 흐름**(`useBarometerSample`): 가용성 확인 → 권한 → keep-awake → 2초 안정화(값은 화면에만 표시하고 결과에선 버림) → 10초 수집 → MAD(k=3.5, 1.4826 스케일, 0.01 hPa 양자화 대비 하한 0.005) 제거 → `(meanPressureHpa, stdHpa, sampleCount, timestamp)`와 품질 정보 반환. UI 갱신은 250 ms 틱이라 샘플마다 리렌더하지 않는다.

품질 등급(`gradeWindow`):

| 경고 | 조건(초기값) | 등급 |
|---|---|---|
| `DEVICE_MOVED` | 정지 비율 < 0.8 | retry(저장 불가) |
| `PRESSURE_TREND` | 창 내 기울기 > 0.01 hPa/s (10초에 약 0.8 m) | retry (엘리베이터·이동 중) |
| `UNSTABLE_PRESSURE` | 이상치 제거 후 σ > 0.06 hPa (약 0.5 m) | usable + "바람 주의" |
| `LOW_SAMPLE_COUNT` | iOS < 7, Android < 20 | usable |

---

## 2. 국토지리정보원 DEM: 실제로 받을 수 있는 것 (중요한 정정)

앞 보고서에는 "1m/5m/10m DEM 무상 다운로드"라고 적었는데, **이번 조사로 정정**한다.

| 자료 | 해상도 | 받는 방법 | 형식·좌표 | CAMPO 용도 |
|---|---|---|---|---|
| 국토정보플랫폼 **공개 DEM** | **90 m** | 로그인 → 국토정보맵 → 공개DEM → 사유 입력 → 무료 | zip 안에 `.img`(ERDAS Imagine), ascii(x y z), pdf. 블로그마다 좌표계 서술이 달라(5186 권장 / 코드 주석은 5179) **파일의 CRS를 직접 확인** | 최후의 fallback prior |
| **1:5,000 수치지형도 v2.0** 등고선 `N3L_F0010000` + 표고점 `N3P_F0020000` | 등고선 5 m 간격 → TIN 1 m 격자 | 국토정보맵 → 수치지형도Ver2.0(SHP) → 무료 | SHP(+prj, DBF 인코딩 cp949 가능성) | **권장 기본 prior** |
| 5 m DEM(전국) / 1 m DEM(도심지) | 5 m / 1 m | **공개제한 공간정보**: 법인·사업자등록자가 LX 보안심사를 받거나(2024-03-19 개정법), 공간정보 안심구역 이용 | — | 사업화 이후 검토 |
| KNGeoid24 (2024-10 공개) / KNGeoid18 | 격자 | 국토정보플랫폼 지오이드 서비스, 무료 | `.gri`, `.dat` | GPS 고도를 쓸 때만 |

수직 기준: DEM과 수치지형도 높이는 **정표고(평균해수면 기준)**, GNSS·스마트폰 GPS 고도는 기본적으로 **타원체고**다(H = h − N). 한국의 지오이드고는 15~34 m(평균 약 25 m)다. **CAMPO는 Δh(상대값)만 측정하고 절대 기준은 DEM에서 가져오므로 지오이드 보정이 필요 없다.** 다만 GPS 고도를 솔버에 넣고 싶어지면 그때 반드시 KNGeoid로 H를 만들어 넣어야 한다. 캠퍼스 1 km 안에서 N의 변화는 무시할 만하지만, 절대값 25 m 차이는 치명적이다.

`dem_prep.py`의 두 경로:

```bash
# A) 90 m 공개 DEM → 1 m (보간일 뿐이며 스크립트가 경고를 출력함)
python dem_prep.py raster --src 37612.img 37613.img --boundary hy_seoul.geojson --res 1.0 --out out/hy_dem
# B) 수치지형도 등고선/표고점 TIN, 빈 곳(도심 건물 밀집지)은 90 m DEM으로 채움
python dem_prep.py contours --contours */N3L_F0010000.shp --spots */N3P_F0020000.shp \
    --boundary hy_seoul.geojson --fallback-raster 37612.img --res 1.0 --out out/hy_tin
python dem_prep.py sample --grid out/hy_tin.json --lonlat 127.0450 37.5570
```

- 출력: `*.tif`(COG, DEFLATE+predictor, 256 블록, 오버뷰, `VERTICAL_DATUM` 태그) + `*.json/*.bin`(campo-grid; float32, 또는 `--grid-dtype uint16`이면 1 cm 양자화로 용량 절반). 가상 600 m 캠퍼스·1 m 해상도 기준 uint16 bin은 0.54 MB, COG는 53 KB였다.
- 목표 격자는 해상도 배수로 snap된다. 재처리해도 셀 경계가 바뀌지 않아 타일 캐시가 유지된다.
- 등고선 높이 필드는 `등고수치` 등 후보명을 자동 탐지하고, 실패하면 `--z-field`로 지정한다. 실제 파일의 필드명은 첫 다운로드 때 꼭 확인할 것.
- `--sigma-dem` 초기값: 90 m DEM은 3~5 m, 등고선 TIN은 1.5~2.5 m(1:5,000 등고선 간격 5 m의 절반 안팎). 검증점으로 다시 맞춘다.

---

## 3. 솔버 (`campo_height_solver.py`)

```bash
python campo_height_solver.py --store elevation_store.json --dem out/hy_tin.json --sigma-dem 2.0 --out out/solve
# → corrected_dem.(json|bin), residual_field.(json|bin), store.solved.json(estimates, lastSolve, edge.qc 갱신)
```

처리 순서(성분별):
1. **연결 성분 분리**(union-find). DEM prior가 하나도 닿지 않는 성분(예: 층끼리만 잰 건물)은 `floating=true`로 표시하고 첫 노드를 0으로 gauge 고정한다. 이 경우 상대 높이만 유효하다.
2. **Baarda data snooping**: LS → `w = v/√qvv`, |w| 최대인 엣지가 z(1−α/2)(α=0.001이면 3.29)를 넘으면 한 개 제거 → 다시 반복.
3. **Huber IRLS**(k=1.5): 남은 엣지의 중간 크기 이상치를 감가(`downweighted`).
4. **χ² 전역 검정**: vᵀPv와 χ²(m−n)의 95% 구간을 비교한다. 실패하면 개별 엣지보다 σ 모델(§4) 자체를 의심할 것.
5. **redundancy r < 0.05인 엣지는 `untestable`**: 루프나 왕복이 없는 단일 연결이라 틀려도 잡을 수 없다는 뜻이다. → UX에서 "왕복 측정"을 유도하는 근거가 된다.
6. 노드 σ는 두 가지다. `sigma`(절대, DEM datum 오차 포함, 보통 1 m 이상)와 `sigma_rel`(datum 공통 오차를 뺀 상대 σ, 보통 0.1~0.3 m). **2단계 잔차장 가중에는 `sigma_rel`을 쓴다.** 절대 σ로 가중하면 모든 보정이 DEM 쪽으로 과하게 수축한다(테스트로 확인).

가상 캠퍼스 테스트 결과(실외 5개, 층 평면 2개, 엣지 12개, `e2_bad`에 +2.5 m 오차):

```
w-test reject e2_bad |w|=6.47 > 3.29
global χ² = 5.75, dof = 9, 95% range [2.70, 19.02] → PASS
층고 2F−1F 추정 4.07 m (참값 4.20), 상대 높이 오차 ≤ 0.35 m
```

**2단계 잔차장**은 두 가지 방법을 제공한다.

| method | 반경 | 식 | 언제 |
|---|---|---|---|
| `fusion`(기본) | **노드별 가변 R_i** | z = Σφᵢπᵢrᵢ / (π₀ + Σφᵢπᵢ) | 앱 기본값. 선형계를 풀 필요가 없고 타일 단위 국소 갱신이 **정확히** 전체 재계산과 같음(테스트로 검증) |
| `rbf` | 균일 R | (Φ + λΣ)c = r | 반경이 같고 보간식이 엄밀해야 할 때(Wendland C²의 양정치성 보장) |

가변 반경에 대칭 RBF를 그대로 쓰면 행렬의 양정치성이 보장되지 않는다. 그래서 가변 반경은 fusion(커널 가중 베이즈 융합)으로 처리했다. 두 방법 모두 R 밖에서는 정확히 0이며, 반경 밖은 DEM 그대로라는 점을 테스트로 확인했다.

증분 갱신: `dirty_tiles(grid, changed_centers, tile)` → `update_tiles(...)`. 새 엣지가 들어오면 그 성분만 다시 풀고, 추정치가 바뀐 노드의 bbox⊕R 타일만 다시 그린다.

---

## 4. 휘발 버퍼와 σ 모델 (`pressureSessionBuffer.ts`)

- 메모리 싱글턴이며 **AsyncStorage에 저장하지 않는다**. 앱이 죽으면 절대 기압도 함께 사라진다(의도된 동작). `sessionId`는 앱 프로세스마다 하나다(같은 기기 차분 원칙).
- 새 창 W_k가 들어오면:
  - W_{k-1}과 다른 노드이고 Δt ≤ 30분 → `static_pair`
  - W_{k-2}가 같은 노드(A→B→A) → A 기압을 시간 선형보간한 `roundtrip` 엣지를 만들고, 기존 pair 엣지는 `supersede`로 반환한다(저장소에서 `qc='superseded'` 처리, 솔버는 무시)
  - 같은 노드 재측정 → 엣지 없음, 진단 메시지에 겉보기 Δh를 남김(드리프트·평탄성 확인용)
- σ 모델(초기값, `DEFAULT_DH_MODEL`):
  `σ_Δp² = Σ(seᵢ² + 0.03²) + (0.3 hPa/h · Δt)²`, `σ_Δh = (H/p̄)·σ_Δp`, H = R_d·T/g
  → 창 표준오차 0.004 hPa 기준, Δt 6분 static_pair의 σ는 약 0.44 m, 같은 구간을 A→B→A(12분) roundtrip으로 재면 약 0.32 m. 테스트에서는 0.6 hPa/h 드리프트로 생긴 pair 편향 +0.5 m를 roundtrip이 0.02 m 이내로 제거했다.
- 이 값들은 **반드시 팀 실측으로 다시 잡을 것**: 정지폰 1~2시간 로그 → `sigmaInstFloorHpa`, 왕복 폐합차 → `driftHpaPerHour`. 엣지마다 `model` 필드에 사용한 파라미터를 기록하므로 나중에 재계산할 수 있다.

---

## 5. 측정 UI 상태 머신과 UX 엣지 케이스

```
hidden ─ENABLE→ idle ─FAB→ targeting ─CROSSHAIR_CONFIRM→ confirming ─START→ preparing
  ─PREP_OK→ settling(2s) ─SETTLE_DONE→ sampling(10s) ─SAMPLE_DONE→ reviewing ─SAVE→ committing ─COMMIT_OK→ done
진행 중 INTERRUPT → interrupted → RETRY | CANCEL         PREP_FAIL → error → DISMISS
```

| 상황 | 처리 |
|---|---|
| 측정 모드 OFF(평상시) | `hidden`: FAB 없음. 기록은 설정 → `측정된 기압` 메뉴에서만 조회 |
| 기압계 없는 기기 | ENABLE 자체를 보내지 않음 / `barometer_unavailable` → DISMISS 시 hidden |
| iOS 권한 거부 | `permission_denied` → 설정 앱 이동 안내(`canAskAgain=false`면 재요청 불가) |
| 십자선 확정 후 지도를 움직임 | 확정 순간의 좌표를 target에 복사해 고정 |
| 실내/실외 선택 | 실외: 반경 R 내 기존 실외 노드가 있으면 "같은 지점 재측정?" 제안(`existingNodeKey`). 실내: 건물·층 선택 + 반층 로비 등은 `intraOffsetM` |
| 현관·자동문 바로 앞 | 팝업에 "문에서 3 m 이상 떨어지세요" 안내(문 개폐 압력 스파이크) |
| 측정 중 앱 전환·전화·잠금 | `app_background` → interrupted, 다시 측정 |
| 화면 꺼짐 | keep-awake. 실패해도 진행하되 "화면을 켜 두세요" 문구 |
| 손에 들고 걷기 시작 | `DEVICE_MOVED` → retry 등급, 저장 버튼 비활성 |
| 엘리베이터 안 | `PRESSURE_TREND` → retry |
| 바람·공조 | 실시간 σ > 0.06 hPa면 "바람 주의" 배지, 결과는 usable |
| 첫 측정 | 엣지 0개 + "기준점 저장됨, 다음 지점을 30분 안에 측정하면 높이차가 생성돼요" + TTL 카운트다운 |
| 30분 초과 | 엣지를 만들지 않고 새 앵커로 처리(진단 메시지) |
| A→B 후 | "출발점에서 한 번 더 재면 정확도가 올라가요"(roundtrip 유도, untestable 방지) |
| iOS 첫 이벤트 지연 | 안정화 후 3초 안에 첫 샘플이 없으면 `no_samples` |
| 연타 | 훅의 `busy` 에러, 머신은 해당 상태에서 무시 |
| 저장 실패 | `commit_failed` → 창은 이미 버퍼에 들어가 있으므로, 같은 결과로 다시 저장하지 말고 재측정 유도(현재 구현). 엣지 쓰기만 실패한 경우를 위해 `ElevationRepo`에 재시도 큐를 두는 것을 권장 |

`측정된 기압` 메뉴: `measuredPressureBuffer.list()`로 세션별 창(시각, 평균 hPa, σ, 남은 TTL)을 **화면에만** 표시하고, 저장소의 엣지(Δh, σ, method, qc)를 함께 보여 준다. "기압 기록 지우기" 버튼은 `clear()`.

---

## 6. v2 연속 보행 + 사진: 스키마를 깨지 않고 확장하기

`ElevationStoreV1`에 `profiles`, `anchorPasses`, `photos`, `photoAssignments`가 이미 optional로 들어가 있다. v2를 붙여도 `schemaVersion` 1을 유지한다.

1. **스트림**: `PressureStreamChunk`(Ephemeral)를 메모리에 받는다. 정지 구간(가속도 판별) 또는 노드 통과(`RouteAnchorPass`: user_tap/map_match/stop_detected) 시점을 앵커로 삼아, 앵커 시각 ±5초 기압으로 `PressureAnchorObservation(source:'walk_stop'|'walk_pass')`를 만들어 **같은 버퍼에 add**한다. 그러면 `method:'walk_anchor'` 엣지가 같은 테이블에 들어간다(정지 측정보다 σ를 크게).
2. **프로파일**: 앵커 사이의 연속 상대 고도는 `DhProfile{sM[], relHM[]}`로 **시작 앵커 기준 상대값만** 저장한다. 절대 기압은 저장하지 않는다.
3. **사진**: 촬영 직후 `decision: 'kept'|'discarded'`를 받는다. 지운 사진은 로컬 파일까지 삭제한다. 세션이 끝나면 `assignPhotosToRoute()`가 `alongM`(없으면 앵커 시각 선형보간)으로 구간을 찾고, 촬영 heading과 구간 방위각의 차이로 forward(≤60°) / backward(≥120°) / side를 판정한다. 신뢰도는 나침반 정확도로 정규화한다.
4. 서버(PostGIS)로 옮길 때 테이블은 보고서의 `height_node / obs_session / dh_edge / dh_profile / edge_photo`에 그대로 대응한다. TS 타입의 필드명이 컬럼명과 1:1이 되도록 맞춰 두었다.

## 7. 다음에 할 일 (우선순위)

1. 국토정보맵에서 한양대 서울캠퍼스 도엽의 **수치지형도 v2.0 SHP**와 **공개 DEM**을 받아 `.prj`·필드명·CRS를 확인하고 `dem_prep.py contours` 실행
2. 팀원 기기별 정지 1~2시간 로그와 계단 왕복 5회 → σ 모델 재추정
3. 줄자·도면으로 잰 검증점 3~5개를 따로 보관(솔버에 넣지 않음) → `sigma-dem`, R 튜닝
4. `ElevationRepo` 로컬 JSON 구현(expo-file-system), 이후 FastAPI + PostGIS로 교체
