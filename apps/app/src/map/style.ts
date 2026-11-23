// 지도 배경: MapLibre용 벡터 스타일(캠퍼스 약도 톤). 앱은 구글·네이버·카카오 지도를 쓰지 않는다(AGENTS.md).
// 데이터는 OpenFreeMap(OpenStreetMap 기반, API 키 없음)의 벡터 타일이고, 출처 표시는 지도 화면에 반드시 남긴다.
// 상점·카페·정류장 같은 POI 아이콘과 글씨는 일부러 넣지 않는다. 경로선(#1F5EFF)이 돋보이도록 바탕은 옅게 둔다.
// 사용법: <Map mapStyle={OSM_RASTER_STYLE}>  (docs/FRONTEND_HANDOFF.md 4장)
// 이름 `OSM_RASTER_STYLE`은 하위 호환용으로 남긴 별칭이다(이제 벡터 스타일이다).
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

export const OSM_ATTRIBUTION = '© OpenStreetMap 기여자 · OpenFreeMap';

const FONT = ['Noto Sans Regular'];
const SOURCE = 'openmaptiles';

const ROAD_MINOR = ['minor', 'service', 'track'];
const WALKWAY_CLASSES = ['path', 'pedestrian'];

export const CAMPUS_SKETCH_STYLE: StyleSpecification = {
  version: 8,
  name: '캠포 캠퍼스 약도',
  sources: {
    [SOURCE]: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: OSM_ATTRIBUTION,
    },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#F6F7F4' } },
    {
      id: 'landcover',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landcover',
      filter: ['in', 'class', 'wood', 'grass', 'farmland'],
      paint: { 'fill-color': '#E4EFE2', 'fill-opacity': 0.7 },
    },
    {
      id: 'landuse',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      filter: ['in', 'class', 'cemetery', 'garden', 'playground', 'pitch', 'stadium', 'track'],
      paint: { 'fill-color': '#E4EFE2', 'fill-opacity': 0.8 },
    },
    {
      id: 'landuse-campus',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'landuse',
      filter: ['in', 'class', 'school', 'university', 'college'],
      paint: { 'fill-color': '#F0F1EC' },
    },
    {
      id: 'park',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'park',
      paint: { 'fill-color': '#E4EFE2' },
    },
    {
      id: 'water',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'water',
      paint: { 'fill-color': '#D6E8F5' },
    },
    {
      id: 'waterway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'waterway',
      paint: { 'line-color': '#D6E8F5', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 18, 3] },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['in', 'class', ...ROAD_MINOR],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.4, 18, 5] },
    },
    {
      id: 'road-major',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#FFFFFF',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2.5, 18, 9],
      },
    },
    {
      id: 'walkway',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 15,
      filter: ['in', 'class', ...WALKWAY_CLASSES],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ECEEE8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 19, 3],
      },
    },
    {
      id: 'walkway-steps',
      type: 'line',
      source: SOURCE,
      'source-layer': 'transportation',
      minzoom: 16,
      filter: ['all', ['in', 'class', ...WALKWAY_CLASSES], ['==', 'subclass', 'steps']],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#D3D7D0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 16, 1, 19, 3],
        'line-dasharray': [0.6, 0.6],
      },
    },
    {
      id: 'building',
      type: 'fill',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 14,
      maxzoom: 16,
      paint: { 'fill-color': '#EAECE8', 'fill-outline-color': '#D3D7D0' },
    },
    {
      id: 'building-outline',
      type: 'line',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 16,
      paint: { 'line-color': '#D3D7D0', 'line-width': 0.6 },
    },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: SOURCE,
      'source-layer': 'building',
      minzoom: 16,
      paint: {
        'fill-extrusion-color': '#EAECE8',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.55,
      },
    },
    {
      id: 'road-name',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'transportation_name',
      minzoom: 14,
      filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
      layout: {
        'symbol-placement': 'line',
        'text-field': ['coalesce', ['get', 'name:ko'], ['get', 'name']],
        'text-font': FONT,
        'text-size': 11,
      },
      paint: { 'text-color': '#5B6158', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
    },
    {
      id: 'campus-name',
      type: 'symbol',
      source: SOURCE,
      'source-layer': 'poi',
      minzoom: 14,
      filter: ['in', 'class', 'college', 'university'],
      layout: {
        'text-field': ['coalesce', ['get', 'name:ko'], ['get', 'name']],
        'text-font': FONT,
        'text-size': 12,
        'text-max-width': 8,
      },
      paint: { 'text-color': '#3F463C', 'text-halo-color': '#F6F7F4', 'text-halo-width': 1.5 },
    },
  ],
};

// 하위 호환: 기존 화면 코드는 OSM_RASTER_STYLE 이름으로 계속 쓴다.
export const OSM_RASTER_STYLE: StyleSpecification = CAMPUS_SKETCH_STYLE;
