// 건물 이름을 MapLibre 네이티브 SymbolLayer로 그릴 재료. React를 import하지 않는 순수 모듈.
// 이름이 React Native Marker(별도 뷰)였을 때는 팬·줌에서 지도보다 늦게 따라왔다. 네이티브 심볼은 지도와 같은 프레임에 그려진다.
// - 화면에서 건물 긴 변이 BUILDING_LABEL_MIN_SPAN_PX(48px) 미만이면 이름을 얹지 않는다: 건물마다 그 배율(minZoom)을 미리
//   계산하고, 같은 배율 구간끼리 한 레이어(minzoom)로 묶는다(필터의 zoom 식은 정수 배율에서만 평가되어 쓰지 않는다).
// - 겹침은 MapLibre가 피한다(text-allow-overlap: false). 우선순위: 큰 건물 먼저(symbol-sort-key), 큰 건물 구간 레이어가 위.
import type { SymbolLayerSpecification } from '@maplibre/maplibre-react-native';
import type { FeatureCollection, Point } from 'geojson';
import type { BuildingLabel } from './mapLabels.ts';
import { BUILDING_LABEL_MIN_SPAN_PX, BUILDING_LABEL_MIN_ZOOM } from './mapLabels.ts';

/** 배율 구간 폭. 0.5 단위면 건물이 나타나는 배율이 실제 48px 기준과 많아야 0.5단계 어긋난다. */
export const NAME_ZOOM_STEP = 0.5;
/** 이보다 큰 배율이 필요한 아주 작은 건물은 이름을 얹지 않는다(지도 최대 배율 근처). */
export const NAME_MAX_ZOOM = 21;

/** 이름 글자: 은은한 회색 + 흰 테두리. 층 선택이 열린 건물만 진하게. */
export const NAME_COLOR = '#5C6672';
export const NAME_PICKED_COLOR = '#0B3FC4';
export const NAME_FONT: string[] = ['Noto Sans Regular'];

/** 건물 긴 변 `spanM`이 위도 `lat`에서 화면 `minPx` 이상이 되는 가장 작은 배율(MapLibre 512px 타일). */
export function spanMinZoom(spanM: number, lat: number, minPx = BUILDING_LABEL_MIN_SPAN_PX): number {
  if (!(spanM > 0)) return Number.POSITIVE_INFINITY;
  return Math.log2((78271.517 * Math.cos((lat * Math.PI) / 180) * minPx) / spanM);
}

/** 배율 구간(레이어 minzoom): BUILDING_LABEL_MIN_ZOOM(15.5) 이상, NAME_ZOOM_STEP 단위로 올림. 너무 작은 건물은 null. */
export function nameZoomBucket(spanM: number, lat: number): number | null {
  const z = Math.max(BUILDING_LABEL_MIN_ZOOM, spanMinZoom(spanM, lat));
  if (!Number.isFinite(z) || z > NAME_MAX_ZOOM) return null;
  return Math.ceil(z / NAME_ZOOM_STEP - 1e-9) * NAME_ZOOM_STEP;
}

export interface BuildingNameProps { id: string; name: string; picked: boolean; bucket: number; sort: number }

/**
 * 건물 이름 점(건물 가운데). `pickedId`(층 선택이 열린 건물)는 picked = true.
 * sort: 작을수록 먼저 자리를 잡는다(선택 건물 → 큰 건물).
 */
export function buildingNameFeatures(labels: readonly BuildingLabel[], pickedId: string | null = null): FeatureCollection<Point, BuildingNameProps> {
  const features: FeatureCollection<Point, BuildingNameProps>['features'] = [];
  for (const label of labels) {
    const bucket = nameZoomBucket(label.spanM, label.lat);
    const picked = label.id === pickedId;
    if (bucket === null && !picked) continue;
    features.push({
      type: 'Feature',
      properties: { id: label.id, name: label.name, picked, bucket: picked ? BUILDING_LABEL_MIN_ZOOM : bucket!, sort: picked ? -1 : Math.round(-label.spanM) },
      geometry: { type: 'Point', coordinates: [label.lng, label.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** 데이터에 있는 배율 구간, 큰 건물(낮은 배율) 먼저. 레이어는 이 순서의 역순으로 쌓아 큰 건물 레이어가 위(먼저 배치)에 온다. */
export function nameBuckets(data: FeatureCollection<Point, BuildingNameProps>): number[] {
  return [...new Set(data.features.map((f) => f.properties.bucket))].sort((a, b) => a - b);
}

/** SymbolLayer layout: 화면 기준 수평 글자(지도가 돌아가거나 기울어도 정방향), 겹치면 숨김. */
export const NAME_LAYOUT: NonNullable<SymbolLayerSpecification['layout']> = {
  'text-field': ['get', 'name'],
  'text-font': NAME_FONT,
  'text-size': ['interpolate', ['linear'], ['zoom'], 15.5, 10, 18, 11],
  'text-max-width': 7,
  'text-line-height': 1.2,
  'text-rotation-alignment': 'viewport',
  'text-pitch-alignment': 'viewport',
  'text-keep-upright': true,
  'text-allow-overlap': false,
  'text-ignore-placement': false,
  'text-padding': 4,
  'symbol-sort-key': ['get', 'sort'],
};

/** SymbolLayer paint: 옅은 글자 + 흰 halo 1.2. 선택 건물만 진한 파랑. (굵기는 폰트 묶음이 Regular 하나라 색 대비로 낮춘다.) */
export const NAME_PAINT: NonNullable<SymbolLayerSpecification['paint']> = {
  'text-color': ['case', ['get', 'picked'], NAME_PICKED_COLOR, NAME_COLOR],
  'text-halo-color': '#FFFFFF',
  'text-halo-width': 1.2,
  'text-halo-blur': 0.2,
};
