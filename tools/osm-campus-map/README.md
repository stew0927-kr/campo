# osm-campus-map

OpenStreetMap(Overpass) 데이터를 **캠퍼스 약도용 GeoJSON**과 **MapLibre 스타일**로 바꾸는 CLI입니다. Node.js만 있으면 됩니다(Windows 포함).

## 실행

```bash
npm run osm-campus-map
```

기본값: `data/campuses/hanyang-seoul/campus.json`의 `bbox`로 Overpass API에서 받아 `tools/osm-campus-map/out/`에 씁니다.

| 옵션 | 설명 |
|---|---|
| `--bbox w,s,e,n` | 범위 직접 지정 (예: `127.0395,37.553,127.0505,37.5615`) |
| `--input <overpass.json>` | 네트워크 대신 로컬 Overpass JSON(`out geom`)을 변환 |
| `--out <dir>` | 출력 폴더 (기본 `tools/osm-campus-map/out/`) |

```bash
npm run osm-campus-map -- --input my-overpass.json --out /tmp/sketch
```

## 출력

- `campus-sketch.geojson` — 속성: `kind`(`building` / `road` / `footway` / `steps` / `green` / `water`; 기본 스타일은 `footway`·`steps`를 그리지 않음), `name`(`name:ko` 우선), 건물의 `height_m`(`height` 태그, 없으면 `building:levels`×3 m, 둘 다 없으면 6 m)·`levels`, `osm_id`.
- `campus-sketch-style.json` — 위 GeoJSON을 얹는 **B안 기본 스타일**: 2D 평면에 배경·수계·녹지·차도(테두리+면)·건물(평면+외곽선)만 그립니다. 글자(label) 레이어는 글꼴 서버가 필요해서 넣지 않았습니다.

### 기본 스타일(B안): 평면 + 건물·차도·녹지·물

우리가 직접 매핑한 길과 평지 레이어를 위에 얹기 좋도록 바탕을 일부러 단순하게 둡니다.

- 3D 돌출(`fill-extrusion`)은 쓰지 않습니다. 건물은 모든 줌에서 2D 평면(`building-flat`)과 외곽선(`building-outline`)으로 보입니다.
- OSM 보행로(`footway`)와 계단(`steps`)은 그리지 않습니다(점선 없음). 길 안내용 보행 경로는 팀이 직접 매핑한 데이터가 맡습니다.
- 색: 배경 `#f4f1ea`, 수계 `#cfe3f2`, 녹지 `#e1edd4`, 차도 테두리 `#e0dbd0`·면 `#ffffff`, 건물 `#e7e2d8`·외곽선 `#d2ccc0`.

GeoJSON 변환은 그대로라서 `footway`·`steps`·`height_m`은 파일에 남아 있습니다. 나중에 필요하면 스타일에 `['==', ['get', 'kind'], 'footway']` 같은 필터의 레이어를 직접 더해 선택적으로 쓸 수 있습니다.

상점·음식점·카페·ATM·버스정류장·자판기 같은 POI 점과 그 밖의 태그는 모두 버립니다. 좌표는 소수점 6자리로 줄이고 중복점·깨진 폴리곤을 정리합니다.

## `apps/app`에 붙이기

`out/`의 두 파일을 앱이 읽을 수 있는 곳(예: `apps/app/assets/`)에 복사한 뒤, 기존 OSM 래스터 배경 대신 또는 위에 얹습니다. `maplibre-react-native`에서는 스타일의 `sources`를 복사해 쓰면 됩니다.

```tsx
import sketch from '../assets/campus-sketch.geojson';
import sketchStyle from '../assets/campus-sketch-style.json';

// 스타일 전체를 배경으로 쓰기: GeoJSON을 URL 대신 객체로 넣는다
const mapStyle = {
  ...sketchStyle,
  sources: { 'campo-sketch': { ...sketchStyle.sources['campo-sketch'], data: sketch } },
};
// <Map mapStyle={mapStyle} />
```

출처 표시 `© OpenStreetMap 기여자`는 스타일에 들어 있으며 지도 화면에서 계속 보여야 합니다(ODbL). 구글·네이버·카카오 지도·타일은 쓰지 않습니다. 이 도구는 `apps/app`을 직접 고치지 않습니다.

## 테스트

`npx vitest run --project osm-campus-map` (네트워크 불필요, `test/fixtures/sample-overpass.json` 사용). 스타일 테스트는 3D·보행로 레이어가 없고, 건물이 모든 줌에서 보이며, 팔레트가 위 값인지 확인합니다.
