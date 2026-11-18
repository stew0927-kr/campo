// 지도 썸네일 마커와 확대 뷰어가 그릴 값을 만든다(GeoJSON 점·이미지 등록표·페이지 목록). React 없는 순수 모듈.
import type { CampusRouteView, PhotoCatalog, RoutePhoto, RouteStepPhoto } from '../contracts.ts';
import { arrowForPhoto, otherPhotosAt } from './routePhotos.ts';
import { APPROXIMATE_BADGE, ARRIVAL_TEXT, photoAccessibilityLabel, photoCounterText } from './photoText.ts';

// ---- 지도 마커 ----

/** MapLibre 스타일 이미지 키(썸네일 하나당 하나). 스타일 식에 안전한 글자만 남긴다. */
export const thumbKeyOf = (photoId: string): string => `route-photo-${photoId.replace(/[^A-Za-z0-9_-]/g, '_')}`;

export interface PhotoMarkerProps {
  /** Images에 등록한 키. */
  icon: string;
  /** RouteStepPhoto 목록 안의 위치(뷰어를 열 때 그대로 쓴다). */
  index: number;
  /** approximate 사진: 경고 배지 레이어를 겹친다. */
  warn: boolean;
}

/** 사진과 좌표가 있는 단계만 점 Feature로. Feature id는 photoId가 아니라 단계 위치다(같은 사진이 두 단계에 나올 수 있다). */
export function photoMarkerFeatures(stepPhotos: readonly RouteStepPhoto[]): GeoJSON.FeatureCollection<GeoJSON.Point, PhotoMarkerProps> {
  const features: GeoJSON.Feature<GeoJSON.Point, PhotoMarkerProps>[] = [];
  stepPhotos.forEach((s, index) => {
    if (s.photo === null || s.lngLat === null) return;
    features.push({
      type: 'Feature',
      id: index,
      geometry: { type: 'Point', coordinates: [s.lngLat[0], s.lngLat[1]] },
      properties: { icon: thumbKeyOf(s.photo.photoId), index, warn: s.pick === 'approximate' },
    });
  });
  return { type: 'FeatureCollection', features };
}

/** <Images images={…}>에 넘기는 등록표: 키 → { source: { uri: thumbUrl } }. 앱에 번들한 썸네일은 쓰지 않는다. */
export function thumbImages(stepPhotos: readonly RouteStepPhoto[]): Record<string, { source: { uri: string } }> {
  const images: Record<string, { source: { uri: string } }> = {};
  for (const s of stepPhotos) if (s.photo) images[thumbKeyOf(s.photo.photoId)] = { source: { uri: s.photo.thumbUrl } };
  return images;
}

/** 지도 탭 이벤트의 Feature에서 단계 위치를 읽는다. 없으면 null. */
export function markerIndexOf(feature: { id?: unknown; properties?: unknown } | undefined): number | null {
  const props = feature?.properties as Partial<PhotoMarkerProps> | null | undefined;
  const raw = typeof props?.index === 'number' ? props.index : feature?.id;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

// ---- 확대 뷰어 ----

/** 뷰어 한 페이지(경로의 한 단계 또는 도착 지점). */
export interface PhotoViewerPage {
  key: string;
  stepIndex: number;
  /** "3 / 7 · 공학관 2층 엘리베이터 앞" */
  counter: string;
  /** 단계 안내 문장(코어 RouteStep.text) 또는 도착 문구. */
  stepText: string;
  step: RouteStepPhoto;
  /** 같은 지점의 다른 사진(고른 사진 제외, photosForPoint 순서). */
  others: RoutePhoto[];
  /** 스크린리더 레이블. */
  accessibilityLabel: string;
}

/** 단계 지점의 표시 이름. 화면이 장소 이름을 알면 넘기고, 모르면 층 표시("2층")만 쓴다. */
export type PlaceLabel = (nodeId: string) => string | null | undefined;

const levelText = (level: number | null): string | null => (level === null ? null : level < 0 ? `지하 ${-level}층` : `${level}층`);

/** 뷰어 페이지 목록. 단계마다 한 페이지(노드당 한 장)로 경로 순서를 지킨다. 사진이 없는 단계도 문구 페이지로 남는다. */
export function photoViewerPages(
  route: CampusRouteView | null,
  stepPhotos: readonly RouteStepPhoto[],
  catalog: PhotoCatalog | null,
  placeLabel?: PlaceLabel,
): PhotoViewerPage[] {
  if (route === null || stepPhotos.length === 0) return [];
  const total = stepPhotos.length;
  return stepPhotos.map((step, i) => {
    const routeStep = route.steps[step.stepIndex];
    const arrival = routeStep === undefined;
    const last = route.steps[route.steps.length - 1];
    const level = arrival ? (last?.toLevel ?? null) : routeStep.fromLevel;
    const place = placeLabel?.(step.nodeId) ?? levelText(level);
    const others = catalog ? otherPhotosAt(catalog.byNodeId(step.nodeId), step.targetDeg, step.photo?.photoId ?? null) : [];
    return {
      key: `${step.stepIndex}:${step.nodeId}`,
      stepIndex: step.stepIndex,
      counter: photoCounterText(i, total, place),
      stepText: arrival ? ARRIVAL_TEXT : routeStep.text,
      step,
      others,
      accessibilityLabel: photoAccessibilityLabel({
        index: i, total, place, arrow: step.arrow, hint: step.photo?.direction_hint ?? null, badge: step.badge,
      }),
    };
  });
}

/**
 * 뷰어에서 "이 지점 다른 사진"으로 고른 사진을 페이지에 보일 때의 값. 화살표는 같은 가야 할 방향으로 다시 잡고,
 * 방향 없는 사진이면 화살표 없이 "정면이 아닐 수 있습니다" 배지를 붙인다(자동으로 고르지 않은 사진이므로).
 */
export function withPhoto(step: RouteStepPhoto, photo: RoutePhoto, badge: string = APPROXIMATE_BADGE): RouteStepPhoto {
  const a = arrowForPhoto(photo, step.targetDeg);
  if (!a) return { ...step, photo, deltaDeg: null, arrow: null, badge };
  const sameWay = Math.abs(a.deltaDeg) <= 45;
  return { ...step, photo, deltaDeg: a.deltaDeg, arrow: a.arrow, badge: sameWay ? null : badge };
}
