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

- `campus-sketch.geojson` — 속성: `kind`(`building` / `road` / `footway` / `steps` / `green` / `water`), `name`(`name:ko` 우선), 건물의 `height_m`(`height` 태그, 없으면 `building:levels`×3 m, 둘 다 없으면 6 m)·`levels`, `osm_id`.
- `campus-sketch-style.json` — 위 GeoJSON을 얹는 MapLibre 스타일(배경·녹지·물·길·계단·건물 3D). 글자(label) 레이어는 글꼴 서버가 필요해서 넣지 않았습니다.

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

`npx vitest run --project osm-campus-map` (네트워크 불필요, `test/fixtures/sample-overpass.json` 사용).
