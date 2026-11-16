# 프론트 연결 지침서 — 캠포 사용자 앱 (`apps/app`)

> 대상: 5탭 화면을 만드는 프론트 담당과 그 AI. 이 문서 하나로 시작할 수 있게 썼다.
> 관련 문서: 저장소 규칙 `AGENTS.md`, 길찾기 명세 `docs/v0.2/SPEC-v0.2.md`, GPS 매칭 설계 `docs/MAP_MATCHING.md`.

**이번 과제의 범위(먼저 읽는다)**

- **한양대학교(서울캠퍼스)만** 다룬다. 다른 캠퍼스 선택·전환 화면은 만들지 않는다(`bundle-campus`의 캠퍼스 인자는 개발용).
- 5탭 중 **논술·축제·학교행사 탭은 가상(mock) 데이터**로 만든다. 서버·크롤링·실제 일정 연동은 하지 않는다. 화면 문구와 가상 데이터는 한국어 존댓말로 쓴다.
- **지도·길찾기, 내정보 탭**만 이 문서의 계약 Hook(`useCampusData`·`useCampusRoute`·`useGpsMatcher`)과 실제 캠퍼스 데이터를 쓴다.
- 5탭 UI와 탭 네비게이션은 **프론트 담당과 그 AI가 만드는 것이 이 과제의 일이다.** 아래 "빈 시작 화면 1개"는 스캐폴드 커밋의 상태일 뿐이며, 5탭을 만드는 것을 막는 규칙이 아니다.

---

## 0. 지금 무엇이 되어 있나

브랜치 `feat/user-app-scaffold`(기준 브랜치: `feat/elevation-integration`, PR #3)에 **최종 사용자용 앱의 뼈대**를 만들었다.

| 되어 있는 것 | 파일 |
|---|---|
| Expo 앱 워크스페이스(`@campo/app`), 빈 시작 화면 **1개** | `apps/app/App.tsx`, `index.ts`, `package.json` |
| Android 빌드·배포 설정(권한, APK/AAB 프로필) | `apps/app/app.json`, `apps/app/eas.json` |
| 캠퍼스 데이터 번들(빌드 때 자동) | `apps/app/scripts/bundle-campus.mjs` |
| 캠퍼스 데이터 읽기 → 그래프·GPS 망·화면 목록 | `apps/app/src/campus/` |
| **안정 계약 Hook 3개** + 순수 엔진 + 단위 테스트 26개 | `apps/app/src/contracts.ts`, `src/hooks/`, `src/route/`, `src/matching/`, `test/` |
| 지도 배경(OSM 래스터) 스타일 | `apps/app/src/map/style.ts` |

**일부러 비워 둔 것** — 프론트 담당이 자유롭게 정하면 된다.

- 5탭 UI·탭 네비게이션·화면 전환 (지도·길찾기 / 논술 / 축제 / 학교행사 / 내정보)
- 각 탭의 화면·컴포넌트·테마
- 논술·축제·학교행사 탭의 가상 데이터(이번 과제는 한양대 기준 가상 데이터)
- 로그인·설정 저장

**데이터 현황(중요)**: `data/campuses/hanyang-seoul/`에는 지금 `campus.json`과 **빈 GeoJSON 두 개**뿐이다. 즉 현재 앱을 켜면 `지점 0 · 구간 0`으로 정상 동작한다(오류 아님). 데이터 담당이 지점·구간을 채우면 `npm run bundle-campus`만 다시 돌리면 앱에 반영된다. 데이터는 `data/` 담당 영역이므로 앱에서 고치지 않는다.

데이터가 비어 있는 동안 길찾기·지점 목록 화면을 시험하려면 `useCampusData(bundle)`에 **개발용 번들을 직접 넘긴다**(`BundledCampus` 모양은 `src/campus/types.ts`, 만드는 예는 `test/helpers.ts`의 `bundleOf`·`bundleFrom`; 코어의 `packages/core/test/fixtures/campus-basic`을 읽으면 지점·건물·층·엘리베이터가 다 있다). 개발용 번들은 `data/`에 넣거나 커밋하지 않는다.

---

## 1. 실행

```bash
# 저장소 루트에서
npm install                # 처음 한 번 (Node 22 이상, .nvmrc 참고)
npm run app                # = npm run start -w @campo/app — 캠퍼스 번들 후 Expo 시작
npm test                   # 전체 테스트(Vitest)
npm run typecheck          # 워크스페이스 전체 타입 검사(앱은 캠퍼스 번들 후 tsc)
```

- **`expo-dev-client`가 설치되어 있어서 `npm run app`(= `expo start`)은 기본으로 개발 빌드(development client)용으로 뜬다.** 개발 빌드 APK를 폰에 설치해 두었다면(6장 `build:development`) 터미널 QR을 그 앱으로 찍는다. MapLibre 지도는 네이티브 모듈이라 **개발 빌드에서만** 그려진다.
- 개발 빌드 없이 빠르게 화면·훅만 보려면 Expo Go로 연다: `npm run start -w @campo/app -- --go` (터미널에서 `s`를 눌러 전환해도 된다). Expo Go에서는 **MapLibre 지도가 그려지지 않고**(나머지 화면·훅·위치·기압 센서는 동작), 개발 빌드에서만 확인되는 부분이 있다.
- `npm run android`도 실행 전에 캠퍼스 번들을 만든다(`preandroid`). EAS 클라우드 빌드는 `eas-build-post-install`이 같은 일을 한다.
- 캠퍼스 바꾸기: `npm run bundle-campus -w @campo/app -- <campus id>` (기본 `hanyang-seoul`).
- 생성되는 `apps/app/assets/campus.generated.json`은 **커밋하지 않는다**(`prestart`·`preandroid`·`typecheck`·`export`와 EAS 빌드의 `eas-build-post-install`이 매번 다시 만든다).

---

## 2. 폴더 지도

```
apps/app/
  App.tsx                 ← 지금은 빈 시작 화면 1개. 여기서 5탭을 시작하면 된다(자유 영역)
  index.ts                ← Expo 진입점(registerRootComponent)
  app.json / eas.json     ← 앱 이름·패키지명·권한 / EAS 빌드·제출 프로필
  metro.config.js         ← 모노레포 Metro 설정(apps/mobile과 같은 규칙, React 한 벌 보장)
  scripts/bundle-campus.mjs
  assets/campus.generated.json   ← 생성물(커밋 안 함)
  src/
    contracts.ts          ← ★ 안정 계약(타입). 화면은 이 타입만 본다
    campus/               ← 번들 읽기(parseCampus → buildGraph → buildMatchNetwork)
    route/routeEngine.ts  ← 경로 찾기 순수 함수(computeRoute)
    matching/matcherSession.ts  ← GPS 매칭 + 실내외 전환 세션(React 없음)
    hooks/                ← 위 엔진을 React에 붙이는 얇은 껍데기 3개
    map/style.ts          ← MapLibre 배경 스타일(OSM)
    index.ts              ← 한 줄 import용 배럴
  test/                   ← 순수 엔진 단위 테스트
```

화면에서는 한 줄로 가져오면 된다.

```tsx
import { useCampusData, useCampusRoute, useGpsMatcher, OSM_RASTER_STYLE } from './src';
```

---

## 3. 안정 계약 Hook 3개

### 3.1 지켜야 할 규칙(계약의 정의)

1. **필드 이름과 의미를 바꾸지 않는다.** 화면이 이미 쓰고 있는 이름을 바꾸면 프론트 전체가 깨진다.
2. **새 필드는 반드시 optional(`?`)로 더한다.** 필수 필드를 더하는 변경도 하위 호환이 깨지는 변경이라 같이 상의한다.
3. **안내 문구는 계약이 주는 값을 그대로 쓴다.** `message`, `label`, `steps[].text`는 이미 한국어 존댓말이다. 화면에서 새로 만들지 않는다(문구가 두 군데서 갈라지면 유지보수가 안 된다).
4. **코어 타입을 다시 정의하지 않는다.** `@campo/core` 타입을 그대로 쓰거나 감싼다.

### 3.2 `useCampusData()` — 지도 데이터

```tsx
const data = useCampusData();
// data.status        'ready' | 'error'
// data.runtime       CampusRuntime | null   ← useCampusRoute에 넘기는 값
// data.campus        { id, name, center: {lat,lng}, bbox } | null
// data.counts        { nodes, edges, buildings }
// data.places        [{ id, name, nodeType, buildingId, level, lat, lng, roomRef? }]   (이름 있는 지점·장소·출입구·화장실·강의실 문. name은 항상 한국어, 강의실 문은 nodeType 'door'에 roomRef(호수))
// data.buildings     [{ id, name, levels }]
// data.graph         CampusGraph | null     (코어 그래프, 직접 읽어도 된다)
// data.network       MatchNetwork | null    (useGpsMatcher에 넘긴다)
// data.issues        string[]               (읽지 못한 항목, 비어 있으면 정상)
// data.error         string | null          (status==='error'일 때 화면에 그대로 보여 줄 한국어)
// data.reload()      다시 파싱
```

- 데이터가 앱 안에 있어서 **첫 렌더에서 바로 읽는다**(네트워크 없음). 그래서 `loading` 상태가 없다.
- 데이터가 아주 커지면 첫 프레임이 잠깐 늦어질 수 있다. 그때는 로딩 화면을 먼저 그리는 구조로 바꾸면 되는데, 계약은 그대로 두고 내부만 바꾸면 된다.

### 3.3 `useCampusRoute(runtime, request)` — 경로·예상 시간·층 이동·경사 경고

```tsx
import { useMemo, useState } from 'react';
import { useCampusData, useCampusRoute, type CampusRouteRequest } from './src';

const data = useCampusData();
const [request, setRequest] = useState<CampusRouteRequest | null>(null);
const route = useCampusRoute(data.runtime, request);

// 출발·도착 정하기
setRequest({
  from: { kind: 'node', nodeId: 'n_A_1_main' },          // 캠퍼스 지점 id
  to: { kind: 'point', lat: 37.5572, lng: 127.045 },     // 지도에서 고른 점(가장 가까운 길에 붙는다)
  mode: 'wheelchair',                                    // 생략하면 'shortest'
});
```

`request`(요청)

| 필드 | 형 | 설명 |
|---|---|---|
| `from`, `to` | `RouteEndpoint \| null` | `{ kind: 'node', nodeId }` 또는 `{ kind: 'point', lat, lng }`. 둘 중 하나라도 `null`이면 `idle` |
| `mode?` | `TravelMode` | `'shortest'`(기본) `'step_free'` `'fewest_steps'` `'elevator_first'` `'wheelchair'` |
| `alternatives?` | `boolean` | 예약 필드. 지금은 무시된다(대안 경로는 아직 없다) |

`route`(결과, `CampusRouteState`)

| 필드 | 형 | 설명 |
|---|---|---|
| `status` | `'idle' \| 'ok' \| 'not-found' \| 'error'` | `idle`=아직 요청 없음, `not-found`=길 없음/지점 없음 |
| `message` | `string \| null` | `not-found`·`error`일 때 그대로 보여 줄 한국어 |
| `route` | `CampusRouteView \| null` | 아래 |

`route.route`(찾은 경로, `CampusRouteView`)

| 필드 | 형 | 설명 |
|---|---|---|
| `profile` / `usedProfile` | `Profile` | 요청한 프로필 / 실제로 쓴 프로필(계단을 피할 수 없어 `fewest_steps`로 대체되면 다르다) |
| `timeSec`, `distanceM` | `number` | 예상 시간(초), 걷는 거리(m). 표시는 `Math.round(timeSec/60)` |
| `stairsCount`, `escalatorCount` | `number` | 계단·에스컬레이터 수 |
| `steps` | `RouteStep[]` | 단계별 안내. `text`가 한국어 문장, `kind`는 `walk`·`stairs`·`escalator`·`elevator`·`portal`·`bridge`·`ramp`, `fromLevel`/`toLevel`은 표시용 층 |
| `floorChanges` | `FloorChange[]` | 층이 바뀌는 곳 `{ kind, fromLevel, toLevel, label }` — 예: `"1층 → 4층 (엘리베이터)"`. 실외에서 건물 안으로 들어서는 경우(한쪽 층을 모름)는 `steps[].text`에 들어 있다 |
| `slopeWarnings` | `SlopeWarning[]` | `{ edgeId, gradePct, gradeClass: 'caution' \| 'steep', message }` — 예: `"급경사 12% (오르막) · 경사가 급한 길입니다"` |
| `fallbackMessage` | `string \| null` | 계단·턱을 피할 수 없을 때 코어가 만든 안내 |
| `polyline` | `{ lat, lng }[]` | 지도에 그릴 선(출발 → 도착) |
| `nodeIds` | `string[]` | 경로가 지나는 지점 id — `useGpsMatcher`의 `routeNodeIds`로 넘긴다 |
| `snappedStartM?`, `snappedEndM?` | `number` | 지도에서 고른 점이 길에서 떨어진 거리(m). 150 m 이상 떨어진 점(캠퍼스 밖)과 NaN 같은 잘못된 좌표는 `not-found`와 한국어 `message`로 돌아온다 |

출발과 도착이 같은 지점이면 `ok`(걸리는 시간 0, 단계 없음)이고 `polyline`은 같은 점 두 개다. 그래서 `polyline`은 항상 LineString으로 그릴 수 있다.

지도에 그리는 예(자유 영역이므로 참고만):

```tsx
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';

const line = {
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: route.route?.polyline.map((p) => [p.lng, p.lat]) ?? [] },
};

<Map mapStyle={OSM_RASTER_STYLE} style={{ flex: 1 }}>
  <Camera centerCoordinate={[data.campus?.center.lng ?? 127.045, data.campus?.center.lat ?? 37.5572]} zoomLevel={17} />
  <GeoJSONSource id="route" data={line}>
    <Layer id="route-line" type="line" paint={{ 'line-color': '#2563EB', 'line-width': 4 }} />
  </GeoJSONSource>
</Map>
```

### 3.4 `useGpsMatcher(network, options)` — 현재 위치·모드·층

```tsx
const gps = useGpsMatcher(data.network, { routeNodeIds: route.route?.nodeIds ?? null });

// 센서 표본을 1초에 한 번 넣는다
gps.pushFix({ tMs: Date.now(), lat, lng, accuracyM, speedMps, headingDeg, compassDeg, baroDeltaM });
```

- `pushFix`는 넣은 즉시 스냅숏을 돌려주고, 동시에 `gps` 상태도 갱신한다.
- `position`이 `null`이면 아직 첫 표본 전이다.
- `routeNodeIds`가 바뀌어도(재탐색 등) 세션은 그대로 이어진다. 위치·모드·층 추적은 `network`가 바뀔 때만 처음부터 다시 시작한다.

`gps`(스냅숏, `GpsMatcherApi`)

| 필드 | 형 | 설명 |
|---|---|---|
| `mode` | `'OUTDOOR' \| 'APPROACHING' \| 'PORTAL' \| 'INDOOR' \| 'OFF_NETWORK_SUSPECT'` | 실내외 상태 |
| `buildingId`, `level` | `string \| null`, `number \| null` | 실내일 때 건물·층(표시용) |
| `position` | `{ lat, lng, confidence, stationary, free, skipped } \| null` | 망 위에 맞춘 현재 위치. `skipped`=이번 표본을 건너뜀(직전 위치 유지) |
| `messages` | `string[]` | 이번 표본에서 나온 안내 문구(한국어). 비어 있으면 말할 것이 없다 |
| `events` | `NavEvent[]` | 위 문구의 원본 이벤트(모드 변경·`REROUTE`·`FLOOR_CHANGED`) |
| `rerouteRequested` | `boolean` | true면 새 경로를 찾아 `setRoute`로 다시 넣는다 |
| `fixCount` | `number` | 지금까지 쓴 표본 수 |
| `pushFix(fix)` / `setRoute(nodeIds \| null)` / `reset()` | 함수 | 표본 넣기 / 따라갈 경로 바꾸기 / 처음부터 |

센서 표본 만들기(참고 구현 — 값의 단위와 부호를 정확히 지켜야 한다). `Barometer`는 `addListener`로만 값을 받는다(마지막 값을 읽는 동기 함수는 없다).

```tsx
import { useEffect } from 'react';
import * as Location from 'expo-location';
import { Barometer } from 'expo-sensors';
import type { SensorFix } from '@campo/core';

const HPA_TO_M = 8.3; // 지표 근처에서 1 hPa ≈ 8.3 m (0.12 hPa ≈ 1 m)

function useSensorFixes(pushFix: (fix: SensorFix) => unknown) {
  useEffect(() => {
    let cancelled = false;
    let locationSub: Location.LocationSubscription | null = null;
    let baroSub: { remove: () => void } | null = null;
    let baseHpa: number | null = null; // 안내를 시작할 때의 기압(기준)
    let lastHpa: number | null = null; // 가장 최근 기압

    (async () => {
      // 위치 권한이 먼저다. 거절되면 fix를 못 받으므로 안내 문구를 보여 주고 끝낸다.
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      // 기압계는 없는 기기가 있다. 없으면 baroDeltaM 없이(층 판정 없이) 위치만 쓴다.
      if (await Barometer.isAvailableAsync()) {
        baroSub = Barometer.addListener(({ pressure }) => {
          baseHpa ??= pressure;
          lastHpa = pressure;
        });
      }

      locationSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (position) => {
          const { coords } = position;
          // 이 저장소는 exactOptionalPropertyTypes를 켜 두었다: 값이 없는 선택 필드에 undefined를 넣지 말고 아예 빼야 한다.
          const fix: SensorFix = { tMs: position.timestamp, lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy ?? 999 };
          if (coords.speed !== null) fix.speedMps = coords.speed;
          if (coords.heading !== null) fix.headingDeg = coords.heading;
          // 위로 올라가면 기압이 내려가므로 부호를 뒤집는다: 상승 = 양수(코어의 baroDeltaM 약속).
          if (baseHpa !== null && lastHpa !== null) fix.baroDeltaM = -(lastHpa - baseHpa) * HPA_TO_M;
          pushFix(fix);
        },
      );
      if (cancelled) locationSub.remove();
    })();

    return () => {
      cancelled = true;
      locationSub?.remove();
      baroSub?.remove();
    };
  }, [pushFix]);
}
```

> `tMs`는 **뒤로 가지 않아야 한다**(`position.timestamp` 사용). 기압은 `baroDeltaM`(시작점 대비 높이 차, m, **올라가면 양수**)만 넘긴다 — 절대 기압은 코어가 받지 않는다. 기압(hPa)은 높이가 오를수록 **내려가므로** `-(현재 − 기준) × 8.3`이다. 기준(`baseHpa`)을 새로 잡고 싶으면(안내를 다시 시작할 때) 값을 비워 다음 값으로 다시 시작한다.

---

## 4. 5탭 연결 방법

탭 구성과 순서는 프론트 담당이 정한다. 아래는 각 탭이 **이미 있는 것을 쓰는지, 새로 만드는지**만 정리한 것이다.

| 탭 | 쓰는 계약 | 새로 만들 것 |
|---|---|---|
| **지도·길찾기** | `useCampusData`(지도·지점), `useCampusRoute`(경로), `useGpsMatcher`(현재 위치), `OSM_RASTER_STYLE` | 지도 화면, 출발/도착 고르기 UI, 경로 요약 카드(시간·층 이동·경사), 안내 문구 표시 |
| **논술** | 없음(가상 데이터) | `src/features/essay/` 아래 목록·상세와 `mock.ts` 가상 데이터 |
| **축제** | 없음(가상 데이터) | 날짜·부스·시간표 가상 데이터와 화면 |
| **학교행사** | 없음(가상 데이터) | 학사일정 형태의 가상 데이터와 목록·상세 |
| **내정보** | `useCampusData().campus`(캠퍼스 이름 정도) | 설정 화면. 저장이 필요하면 `expo-file-system` 또는 `AsyncStorage` 추가(패키지 추가는 프론트 담당이 결정) |

탭 네비게이션은 아직 라이브러리가 없다. 둘 중 하나를 고르면 된다.

1. **라이브러리 없이**: `App.tsx`에서 `useState<'map'|'essay'|'festival'|'events'|'me'>` 하나와 하단 버튼 5개로 조건부 렌더. 의존성이 늘지 않고 Expo Go에서 바로 돈다(가장 빠른 길).
2. **`@react-navigation/bottom-tabs`**: 화면이 많아지고 뒤로가기·딥링크가 필요해지면. 설치 후 `apps/app/package.json`만 바꾼다(`packages/core`는 건드리지 않는다).

---

## 5. 수정해도 되는 곳 / 건드리면 안 되는 곳

| 구역 | 규칙 |
|---|---|
| `apps/app/App.tsx`, `apps/app/src/features/**`, 새 컴포넌트·테마·화면 | **자유.** 마음대로 만들고 지워도 된다 |
| `apps/app/src/contracts.ts`, `src/hooks/**`, `src/campus/**`, `src/route/**`, `src/matching/**` | **계약 영역.** 이름·의미를 유지하고 새 필드는 optional로만 더한다. 바꿔야 할 것 같으면 **바꾸지 말고 먼저 사람(리드)에게 묻는다.** PR 설명에 이유를 쓰는 것으로 대신하지 않는다 |
| `apps/app/app.json`, `eas.json` | 패키지명 `kr.hanyang.campo`, `versionCode` 규칙, 권한 목록은 유지. 바꿀 때는 6장을 먼저 읽는다 |
| `packages/core/**`, `data/**`, `packages/tools/**` | **건드리지 않는다.** 필요하면 먼저 리드에게 묻는다 |
| `apps/mobile/**`, `apps/editor/**` | **건드리지 않는다**(다른 담당·다른 앱) |

시험 삼아 코어를 고쳐야 할 것 같으면, 먼저 이 앱의 계약 안에서 해결할 수 있는지 본다(대부분은 `computeRoute`·`matcherSession`에서 감싸면 된다).

---

## 6. EAS Build & Google Play 배포

### 6.1 준비물

| 준비물 | 지금 상태 |
|---|---|
| Expo 계정 | 조원 공용 계정 `campuspotal` 사용(계정 전환 방법은 팀 문서 참고) |
| EAS 프로젝트 연결 | **아직 없다.** 처음 한 번 `npx eas init` → `app.json`의 `extra.eas.projectId`가 채워진다(커밋한다) |
| Android 서명 키 | EAS가 만들어 관리한다(keystore를 저장소에 넣지 않는다) |
| Google Play 서비스 계정 키 | **아직 없다.** `apps/app/keys/play-service-account.json`에 두고 커밋하지 않는다(`.gitignore`에 `keys/` 포함) |

### 6.2 프로필(`eas.json`)

| 프로필 | 결과물 | 쓰는 때 |
|---|---|---|
| `development` | **APK**(development client, 내부 배포) | MapLibre·센서 등 네이티브 모듈을 실기기에서 확인할 때 |
| `preview` | **APK**(내부 배포) | 팀·지도교수에게 설치 파일로 돌릴 때, 에뮬레이터에 바로 설치 |
| `production` | **AAB**(Play 업로드용, `autoIncrement`로 versionCode 자동 증가) | 제출·심사 |

### 6.3 명령

```bash
cd apps/app
npx eas login                 # 공용 계정 campuspotal
npx eas init                  # 한 번만
npm run build:development     # development client APK
npm run build:preview         # preview APK
npm run build:production      # production AAB (versionCode 자동 증가)
npm run submit:android        # Play 내부 트랙에 초안(draft)으로 제출
```

- `version`/`versionCode`의 기준은 EAS 원격(`appVersionSource: "remote"`)이다. 스토어에 올린 뒤에는 `app.json`의 값을 손으로 올리지 않는다.
- `submit`은 위 서비스 계정 키가 있어야 동작한다. 키가 없으면 빌드까지만 하고, 제출은 콘솔에서 수동으로 해도 된다.

### 6.4 권한(`app.json` `android.permissions`)

| 권한 | 왜 |
|---|---|
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | 현재 위치를 지도 위에 표시하고 길을 안내 |
| `ACTIVITY_RECOGNITION` | 걸음 수(만보계)를 속도 힌트로 사용 |
| `BODY_SENSORS`, `HIGH_SAMPLING_RATE_SENSORS` | 기압 센서로 층 이동 판단 |

권한 문구(사용자에게 보이는 설명)는 `app.json`의 `plugins` 안에 한국어로 들어 있다. 문구를 고치면 앱을 다시 빌드해야 반영된다.

---

## 7. 테스트·타입 검사

```bash
npm test                   # 전체 (코어·편집기·도구·현장조사 앱 + 이 앱 26개)
npm run typecheck          # 워크스페이스 전체
```

- 이 앱의 테스트는 **React 없이 도는 순수 엔진**만 본다(`test/campusRoute.test.ts`, `test/gpsMatcher.test.ts`, `test/loadBundledCampus.test.ts`).
  - `computeRoute`(경로·층 이동·경사·캠퍼스 밖·잘못된 좌표·출발=도착), `createGpsMatcherSession`(위치·건너뛰기·재탐색·경로 교체·빈 망), `loadBundledCampus`(데이터 읽기·빈 캠퍼스·오류·강의실 문·한국어 이름).
- 테스트는 코어의 `campus-basic` fixture를 그대로 읽어 쓴다(`test/helpers.ts`) — 지점·구간·건물·층·엘리베이터가 다 들어 있는 작은 캠퍼스다.
- 화면 테스트(렌더링 스냅숏 등)는 아직 없다. 필요해지면 `@testing-library/react-native` 도입을 팀에서 정한다.
- 커밋 전에 `npm test`와 `npm run typecheck` 결과를 PR 설명에 붙인다(저장소 규칙).

---

## 8. 저장소 규칙 중 이 앱에 바로 걸리는 것

- **구글·네이버·카카오 지도/타일/위성사진 금지.** 배경은 OSM(`OSM_RASTER_STYLE`)이고, 화면에 `© OpenStreetMap 기여자` 출처를 남긴다.
- **길찾기는 층 번호를 비교하지 않는다.** 층은 화면 표시·GPS 후보 필터에만 쓴다. 경로는 구간 연결로만 정해진다(`packages/core`가 이미 그렇게 되어 있다).
- 화면 문구는 **한국어 존댓말**, 코드 식별자와 커밋 메시지는 영어.
- 데이터 스키마(`data/schema`)·코어 타입을 바꾸지 않는다. 바꿔야 하면 SPEC·fixture·테스트를 같은 PR에서 고친다.
- 기능 하나 = 브랜치 하나 = PR 하나.

---

## 9. 다음에 하면 좋은 순서(제안)

1. `App.tsx`에 5탭 껍데기(하단 버튼 5개 + 빈 화면 5개) — 계약을 아직 쓰지 않아도 된다.
2. 지도 탭: `<Map>`+`<Camera>`로 배경 띄우고, `data.buildings`/`data.places`로 마커, `route.route.polyline`으로 경로선.
3. 길찾기 입력 UI: `places`(이름 있는 지점)에서 출발·도착 고르기, `mode` 칩(휠체어·엘리베이터 우선 등).
4. 경로 요약 카드: `timeSec`·`distanceM`·`stairsCount`·`floorChanges[].label`·`slopeWarnings[].message`.
5. 실기기 GPS: `useGpsMatcher`에 1초 표본을 넣고 `position`·`messages`를 화면에 반영, `rerouteRequested`면 다시 경로 탐색.
6. 논술·축제·학교행사: 가상 데이터 모양을 팀에서 먼저 합의하고 `src/features/<tab>/mock.ts`로 시작.
7. EAS `preview` APK로 팀 배포 → 발표 전 `production` AAB 준비.

막히면 이 문서 3장(계약)과 `apps/app/src/contracts.ts`의 주석이 기준이다. 계약을 바꾸는 편이 맞다고 판단되면 바꾸지 말고 먼저 사람에게 묻는다(PR 설명으로 대신하지 않는다).
