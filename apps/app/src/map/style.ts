// 지도 배경: MapLibre용 래스터 스타일. 앱은 구글·네이버·카카오 지도를 쓰지 않는다(AGENTS.md).
// 타일은 현장 조사 앱과 같은 OpenStreetMap 공개 타일이고, 출처 표시는 지도 화면에 반드시 남긴다.
// 사용법: <Map mapStyle={OSM_RASTER_STYLE}>  (docs/FRONTEND_HANDOFF.md 4장)
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

export const OSM_ATTRIBUTION = '© OpenStreetMap 기여자';

export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  name: '캠포 배경(OSM)',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.de/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 14,
      maxzoom: 19,
      attribution: OSM_ATTRIBUTION,
    },
  },
  layers: [
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
    },
  ],
};
