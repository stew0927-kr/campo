// 지도 화면이 쓰는 "경로를 따라가는 사진" 목록. React를 import하지 않는 순수 모듈(apps/app/test/routeAlongPhotos.test.ts).
//
// 계약 훅 useRoutePhotos(routeStepPhotos)는 "단계마다 하나 + 도착 하나"이고 ±90° 밖 사진은 고르지 않는다(계약 그대로 둔다).
// 지도 화면은 이 모듈로 단계 사이 지점의 사진까지 보인다.
// - 후보: 경로선이 실제로 지나는 지점(route.nodeIds) 중 사진이 있는 지점만. 경로 밖 근처 지점의 사진은 넣지 않는다
//   (예전 NEAR_PHOTO_M 18 m 보정은 다른 복도·방 사진이 끼어들어 없앴다). 단계 시작 지점은 사진이 없어도 자리를 남긴다
//   (뷰어 페이지·단계 목록이 단계 순서를 지키게).
// - 방향: 그 지점에서의 실제 진행 방위(경로선 앞뒤 점). 단계 시작 지점은 단계 방위(bearing_deg)를 먼저 쓰고, 없으면 이 값.
// - 고르기: 진행 방위와 ±ALONG_MAX_DEG(90°) 안을 보는 사진만 후보로 남기고, 그 안에서 코어 choosePhotoForStep(±45° → ±45°
//   들어오는 방향 → ±90°)으로 고른다. 진행 방향과 크게 어긋나거나 반대인 사진, 방향 없는 사진은 아예 빼고, 대안이 없으면 그 지점은
//   사진 없음이다. 그래서 이 목록에는 "뒤로"(U턴) 화살표도 "정면이 아닐 수 있습니다" 배지도 나오지 않는다.
// - 같은 지점을 반대로 지나면 진행 방위가 180° 달라 다른 사진이 고르진다(왕복이면 지날 때마다 하나씩).
import { DEFAULT_HFOV_DEG, angleDiffDeg, arrowFor, bearingAlong, choosePhotoForStep, normalizeDeg, type HeadedPhoto, type LngLat } from '@campo/core';
import type { CampusRouteView, PhotoCatalog, RoutePhoto, RouteStepPhoto } from '../contracts.ts';
import { isEmptyCatalog } from './catalog.ts';

/** 진행 방위와 사진 방위 차이가 이보다 크면(반대·크게 어긋남) 후보에서 뺀다. */
export const ALONG_MAX_DEG = 90;

/** 지점의 진행 방위를 볼 때 경로선을 따라 앞(뒤)으로 보는 거리(m). 복도 한 칸 정도. */
export const ALONG_LOOK_M = 6;

const headed = (p: RoutePhoto): HeadedPhoto => ({ path: p.photoId, heading_deg: p.heading_deg, ...(p.heading_source ? { heading_source: p.heading_source } : {}) });

/** nodeIds의 각 자리가 polyline 몇 번째 점인가(모르면 -1). nodePositions와 같은 규칙. */
export function nodeLineIndex(route: Pick<CampusRouteView, 'polyline' | 'nodeIds' | 'snappedStartM' | 'nodeIndex'>): number[] {
  const offset = route.snappedStartM !== undefined ? 1 : 0;
  const index = route.nodeIndex?.length === route.nodeIds.length ? route.nodeIndex : null;
  return route.nodeIds.map((_, i) => {
    const at = index ? index[i]! : i + offset;
    return at >= 0 && at < route.polyline.length ? at : -1;
  });
}

/**
 * 경로선 `line`의 `at`번째 점에서의 진행 방위. 나가는 방향(out)과 들어오는 방향(in) — 들어오는 방향은 걸어온 쪽이 아니라
 * 걸어가는 쪽으로 돌려 준다. 둘 다 모르면 null.
 */
export function lineBearings(line: readonly LngLat[], at: number, lookM = ALONG_LOOK_M): { outDeg: number | null; inDeg: number | null } {
  if (at < 0 || at >= line.length) return { outDeg: null, inDeg: null };
  const out = bearingAlong(line, at, 1, lookM);
  const back = bearingAlong(line, at, -1, lookM);
  return { outDeg: out, inDeg: back === null ? null : normalizeDeg(back + 180) };
}

/**
 * 사진 고르기: 진행 방위(`outDeg`, 없으면 `inDeg`)와 ±ALONG_MAX_DEG 안을 보는 사진만 남긴 뒤 코어 규칙으로 고른다.
 * 남는 사진이 없거나(반대·방향 없음) 진행 방위를 모르면 null — 억지로 넣지 않는다. 배지는 붙이지 않는다.
 */
export function pickAlong(photos: readonly RoutePhoto[], outDeg: number | null, inDeg: number | null): Omit<RouteStepPhoto, 'stepIndex' | 'nodeId' | 'lngLat'> | null {
  const targetDeg = outDeg ?? inDeg;
  if (targetDeg === null) return null;
  const facing = photos.filter((p) => p.heading_deg !== null && angleDiffDeg(p.heading_deg, targetDeg) <= ALONG_MAX_DEG);
  if (facing.length === 0) return null;
  const pick = choosePhotoForStep(facing.map(headed), { outDeg, inDeg });
  if (pick.kind === 'none' || Math.abs(pick.deltaDeg) > ALONG_MAX_DEG) return null;
  const photo = facing.find((p) => p.photoId === pick.photo.path)!;
  return { pick: pick.kind, photo, deltaDeg: pick.deltaDeg, arrow: arrowFor(pick.deltaDeg, photo.hfov_deg ?? DEFAULT_HFOV_DEG), targetDeg, badge: null };
}

/**
 * 경로를 따라 사진 목록(경로 순서). 단계 i의 시작 지점, 그 단계 안에서 지나는 사진 지점들, …, 마지막에 도착 지점.
 * stepIndex는 그 지점이 속한 단계(도착은 steps.length). 경로가 없거나 카탈로그가 비면 [].
 */
export function routeAlongPhotos(route: CampusRouteView | null, catalog: PhotoCatalog | null): RouteStepPhoto[] {
  if (route === null || route.steps.length === 0 || isEmptyCatalog(catalog)) return [];
  const line: LngLat[] = route.polyline.map((p) => [p.lng, p.lat]);
  const lineAt = nodeLineIndex(route);
  const point = (k: number): [number, number] | null => (k >= 0 && lineAt[k]! >= 0 ? [line[lineAt[k]!]![0], line[lineAt[k]!]![1]] : null);
  const out: RouteStepPhoto[] = [];
  /** 경로 순서 정렬 키(nodeIds 자리). */
  const order: number[] = [];
  const entry = (stepIndex: number, nodeId: string, k: number, stepOut: number | null, stepIn: number | null, keepEmpty: boolean) => {
    const along = k >= 0 ? lineBearings(line, lineAt[k]!) : { outDeg: null, inDeg: null };
    const outDeg = stepOut ?? along.outDeg;
    const inDeg = stepIn ?? along.inDeg;
    const chosen = pickAlong(catalog!.byNodeId(nodeId), outDeg, inDeg);
    const base = { stepIndex, nodeId, lngLat: point(k) };
    if (chosen) { order.push(k); out.push({ ...base, ...chosen }); }
    else if (keepEmpty) { order.push(k); out.push({ ...base, pick: 'none', photo: null, deltaDeg: null, arrow: null, targetDeg: outDeg ?? inDeg, badge: null }); }
  };
  let cursor = 0;
  route.steps.forEach((step, i) => {
    let a = route.nodeIds.indexOf(step.fromNodeId, cursor);
    if (a < 0) a = route.nodeIds.indexOf(step.fromNodeId);
    const b = a < 0 ? -1 : route.nodeIds.indexOf(step.toNodeId, a);
    entry(i, step.fromNodeId, a, step.bearing_deg ?? null, step.bearing_in_deg ?? null, true);
    if (a >= 0 && b > a) {
      for (let k = a + 1; k < b; k++) entry(i, route.nodeIds[k]!, k, null, null, false);
      cursor = b;
    }
  });
  const last = route.steps[route.steps.length - 1]!;
  let end = route.nodeIds.lastIndexOf(last.toNodeId);
  if (end < cursor) end = route.nodeIds.indexOf(last.toNodeId, cursor);
  entry(route.steps.length, last.toNodeId, end, null, last.bearing_arrive_deg ?? null, true);
  // 경로 순서로(같은 자리면 넣은 순서). 단계 시작이 단계 안 사진보다 앞에 온다.
  return out.map((s, i) => ({ s, i, key: order[i]! })).sort((x, y) => x.key - y.key || x.s.stepIndex - y.s.stepIndex || x.i - y.i).map((x) => x.s);
}
