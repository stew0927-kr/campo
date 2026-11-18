// 경로의 단계마다 보여 줄 사진을 고르고 화살표를 계산한다. useRoutePhotos가 이 함수를 useMemo로 감싼다.
// React·React Native를 import하지 않는 순수 모듈이라 Node에서 테스트한다(apps/app/test/photos.test.ts).
import {
  DEFAULT_HFOV_DEG,
  arrowFor,
  choosePhotoForStep,
  photosForPoint,
  signedDiffDeg,
  type HeadedPhoto,
} from '@campo/core';
import type { CampusRouteView, PhotoCatalog, RoutePhoto, RouteStepPhoto } from '../contracts.ts';
import { isEmptyCatalog } from './catalog.ts';
import { APPROXIMATE_BADGE } from './photoText.ts';

/** 코어의 사진 고르기에 넘기는 모양. path 자리에 photoId를 넣는다. */
const headed = (p: RoutePhoto): HeadedPhoto => ({
  path: p.photoId,
  heading_deg: p.heading_deg,
  ...(p.heading_source ? { heading_source: p.heading_source } : {}),
});

/**
 * 경로가 지나는 지점의 좌표. polyline은 [출발 발끝?] + nodeIds의 좌표 + [도착 발끝?] 순서라(routeEngine polylineOf),
 * 출발이 지도 위 점이었으면(snappedStartM) 한 칸 밀어서 읽는다.
 */
export function nodePositions(route: Pick<CampusRouteView, 'polyline' | 'nodeIds' | 'snappedStartM'>): Map<string, [number, number]> {
  const offset = route.snappedStartM !== undefined ? 1 : 0;
  const out = new Map<string, [number, number]>();
  route.nodeIds.forEach((id, i) => {
    const p = route.polyline[i + offset];
    if (p !== undefined && !out.has(id)) out.set(id, [p.lng, p.lat]);
  });
  return out;
}

/** 지점의 사진 중 고른 사진을 빼고 "이 지점 다른 사진" 순서로(가야 할 방향에 가까운 것 먼저, 방향 없는 사진은 뒤). */
export function otherPhotosAt(photos: readonly RoutePhoto[], targetDeg: number | null, exceptId: string | null): RoutePhoto[] {
  const byId = new Map(photos.map((p) => [p.photoId, p]));
  return photosForPoint(photos.map(headed), targetDeg)
    .map((h) => byId.get(h.path)!)
    .filter((p) => p.photoId !== exceptId);
}

/** 가야 할 방향 `targetDeg`에서 사진 하나를 볼 때의 화살표. 사진에 방향이 없으면 null. */
export function arrowForPhoto(photo: RoutePhoto, targetDeg: number | null): { deltaDeg: number; arrow: RouteStepPhoto['arrow'] } | null {
  if (photo.heading_deg === null || targetDeg === null) return null;
  const deltaDeg = signedDiffDeg(targetDeg, photo.heading_deg);
  return { deltaDeg, arrow: arrowFor(deltaDeg, photo.hfov_deg ?? DEFAULT_HFOV_DEG) };
}

/**
 * 단계마다(그리고 도착 지점에) 고른 사진. 경로가 없거나 카탈로그가 비면 [].
 * - 단계 i: 그 단계를 시작하는 지점(fromNodeId), 나가는 방향 bearing_deg와 들어오는 방향 bearing_in_deg로 고른다.
 * - 도착(stepIndex = steps.length): 마지막 단계의 toNodeId, 도착하는 방향 bearing_arrive_deg로 고른다.
 * 고르는 규칙은 코어의 choosePhotoForStep(±45° 나가는 방향 → ±45° 들어오는 방향 → ±90° + 배지 → 없음)이다.
 */
export function routeStepPhotos(route: CampusRouteView | null, catalog: PhotoCatalog | null): RouteStepPhoto[] {
  if (route === null || route.steps.length === 0 || isEmptyCatalog(catalog)) return [];
  const positions = nodePositions(route);
  const last = route.steps[route.steps.length - 1]!;
  const stops = [
    ...route.steps.map((step) => ({ nodeId: step.fromNodeId, outDeg: step.bearing_deg ?? null, inDeg: step.bearing_in_deg ?? null })),
    { nodeId: last.toNodeId, outDeg: null, inDeg: last.bearing_arrive_deg ?? null },
  ];
  return stops.map((stop, stepIndex): RouteStepPhoto => {
    const photos = catalog!.byNodeId(stop.nodeId);
    const pick = choosePhotoForStep(photos.map(headed), stop);
    const targetDeg = stop.outDeg ?? stop.inDeg;
    const base = { stepIndex, nodeId: stop.nodeId, lngLat: positions.get(stop.nodeId) ?? null, targetDeg };
    if (pick.kind === 'none') return { ...base, pick: 'none', photo: null, deltaDeg: null, arrow: null, badge: null };
    const photo = photos.find((p) => p.photoId === pick.photo.path)!;
    return {
      ...base,
      pick: pick.kind,
      photo,
      deltaDeg: pick.deltaDeg,
      arrow: arrowFor(pick.deltaDeg, photo.hfov_deg ?? DEFAULT_HFOV_DEG),
      badge: pick.kind === 'approximate' ? APPROXIMATE_BADGE : null,
    };
  });
}
