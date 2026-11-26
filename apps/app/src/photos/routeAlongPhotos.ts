// 지도 화면이 쓰는 "경로를 따라가는 사진" 목록. React를 import하지 않는 순수 모듈(apps/app/test/routeAlongPhotos.test.ts).
//
// 계약 훅 useRoutePhotos(routeStepPhotos)는 "단계마다 하나 + 도착 하나"이고 ±90° 밖 사진은 고르지 않는다(계약 그대로 둔다).
// 지도 화면은 사용자가 "그 지점에 무엇이 있는지"를 보고 싶어 하므로 이 모듈로 더 넓게 보인다.
// - 후보: 경로선이 지나는 모든 지점(route.nodeIds) 중 사진이 있는 지점. 단계 시작 지점은 사진이 없어도 자리를 남긴다
//   (뷰어 페이지·단계 목록이 단계 순서를 지키게).
// - 방향: 그 지점에서의 실제 진행 방위(경로선 앞뒤 점). 단계 시작 지점은 단계 방위(bearing_deg)를 먼저 쓰고, 없으면 이 값.
// - 고르기: 코어 choosePhotoForStep(±45° → ±45° 들어오는 방향 → ±90°)으로 먼저 고르고, 그래도 없으면 진행 방위에 가장
//   가까운 사진(방향 없는 사진은 마지막)을 "정면이 아닐 수 있습니다" 배지와 함께 보인다. 사진을 숨기지 않는다.
// - 같은 지점을 반대로 지나면 진행 방위가 180° 달라 다른 사진이 고르진다.
// - 경로 근처 사진(그래프를 넘길 때): 경로 위 지점이 아니어도 같은 범위(같은 건물·같은 층, 실외는 실외)의 경로선 구간에서
//   NEAR_PHOTO_M 안이면 가장 가까운 구간의 단계 사진으로 넣는다. 핀은 사진의 실제 촬영 지점에 두고(lngLat), 방위는 그 구간의
//   진행 방향이다. 왕복처럼 같은 구간을 두 번 지나면 지날 때마다(단계마다) 하나씩.
import { DEFAULT_HFOV_DEG, arrowFor, bearingAlong, choosePhotoForStep, initialBearingDeg, normalizeDeg, photosForPoint, signedDiffDeg, type CampusGraph, type HeadedPhoto, type LngLat } from '@campo/core';
import type { CampusRouteView, PhotoCatalog, RoutePhoto, RouteStepPhoto } from '../contracts.ts';
import { isEmptyCatalog } from './catalog.ts';
import { APPROXIMATE_BADGE } from './photoText.ts';

/** 경로선에서 이 거리(m) 안에 찍힌 사진 지점은 그 구간 단계의 사진으로 본다(같은 건물·층 / 실외). */
export const NEAR_PHOTO_M = 18;

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

/** 사진 고르기: 코어 규칙으로 먼저, 없으면 가장 가까운 사진을 배지와 함께(숨기지 않는다). 사진이 없으면 null. */
export function pickAlong(photos: readonly RoutePhoto[], outDeg: number | null, inDeg: number | null): Omit<RouteStepPhoto, 'stepIndex' | 'nodeId' | 'lngLat'> | null {
  if (photos.length === 0) return null;
  const targetDeg = outDeg ?? inDeg;
  const pick = choosePhotoForStep(photos.map(headed), { outDeg, inDeg });
  const byId = (id: string) => photos.find((p) => p.photoId === id)!;
  if (pick.kind !== 'none') {
    const photo = byId(pick.photo.path);
    return { pick: pick.kind, photo, deltaDeg: pick.deltaDeg, arrow: arrowFor(pick.deltaDeg, photo.hfov_deg ?? DEFAULT_HFOV_DEG), targetDeg, badge: pick.kind === 'approximate' ? APPROXIMATE_BADGE : null };
  }
  const nearest = photosForPoint(photos.map(headed), targetDeg)[0]!;
  const photo = byId(nearest.path);
  const deltaDeg = targetDeg !== null && photo.heading_deg !== null ? signedDiffDeg(targetDeg, photo.heading_deg) : null;
  return { pick: 'approximate', photo, deltaDeg, arrow: deltaDeg === null ? null : arrowFor(deltaDeg, photo.hfov_deg ?? DEFAULT_HFOV_DEG), targetDeg, badge: APPROXIMATE_BADGE };
}

/**
 * 경로를 따라 사진 목록(경로 순서). 단계 i의 시작 지점, 그 단계 안에서 지나는 사진 지점들, …, 마지막에 도착 지점.
 * stepIndex는 그 지점이 속한 단계(도착은 steps.length). 경로가 없거나 카탈로그가 비면 [].
 */
export function routeAlongPhotos(route: CampusRouteView | null, catalog: PhotoCatalog | null, graph: CampusGraph | null = null): RouteStepPhoto[] {
  if (route === null || route.steps.length === 0 || isEmptyCatalog(catalog)) return [];
  const line: LngLat[] = route.polyline.map((p) => [p.lng, p.lat]);
  const lineAt = nodeLineIndex(route);
  const point = (k: number): [number, number] | null => (k >= 0 && lineAt[k]! >= 0 ? [line[lineAt[k]!]![0], line[lineAt[k]!]![1]] : null);
  const out: RouteStepPhoto[] = [];
  /** 경로 순서 정렬 키(nodeIds 자리, 근처 사진은 구간 안 위치만큼 더한다). */
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
  /** nodeIds 자리 k가 속한 단계. */
  const stepOf: number[] = route.nodeIds.map(() => -1);
  let cursor = 0;
  route.steps.forEach((step, i) => {
    let a = route.nodeIds.indexOf(step.fromNodeId, cursor);
    if (a < 0) a = route.nodeIds.indexOf(step.fromNodeId);
    const b = a < 0 ? -1 : route.nodeIds.indexOf(step.toNodeId, a);
    entry(i, step.fromNodeId, a, step.bearing_deg ?? null, step.bearing_in_deg ?? null, true);
    if (a >= 0 && b > a) {
      for (let k = a; k < b; k++) stepOf[k] = i;
      for (let k = a + 1; k < b; k++) entry(i, route.nodeIds[k]!, k, null, null, false);
      cursor = b;
    }
  });
  const last = route.steps[route.steps.length - 1]!;
  let end = route.nodeIds.lastIndexOf(last.toNodeId);
  if (end < cursor) end = route.nodeIds.indexOf(last.toNodeId, cursor);
  entry(route.steps.length, last.toNodeId, end, null, last.bearing_arrive_deg ?? null, true);
  if (graph) {
    for (const near of nearbyPhotos(route, catalog!, graph, line, lineAt, stepOf)) {
      const chosen = pickAlong(catalog!.byNodeId(near.nodeId), near.bearingDeg, near.bearingDeg);
      if (!chosen) continue;
      order.push(near.order);
      out.push({ stepIndex: near.stepIndex, nodeId: near.nodeId, lngLat: near.lngLat, ...chosen });
    }
  }
  // 경로 순서로(같은 자리면 넣은 순서). 단계 시작이 단계 안 사진보다 앞에 온다.
  return out.map((s, i) => ({ s, i, key: order[i]! })).sort((x, y) => x.key - y.key || x.s.stepIndex - y.s.stepIndex || x.i - y.i).map((x) => x.s);
}

const M_PER_DEG_LAT = 110_540, M_PER_DEG_LNG = 111_320;
/** 점 p에서 선분 ab까지(m, 평면 근사)와 선분 위 위치 t(0~1). */
export function segmentDistance(p: LngLat, a: LngLat, b: LngLat): { m: number; t: number } {
  const kx = M_PER_DEG_LNG * Math.cos((p[1] * Math.PI) / 180);
  const [ax, ay, bx, by, px, py] = [a[0] * kx, a[1] * M_PER_DEG_LAT, b[0] * kx, b[1] * M_PER_DEG_LAT, p[0] * kx, p[1] * M_PER_DEG_LAT];
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { m: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t };
}

/** 사진이 있는 그래프 지점(카탈로그·그래프마다 한 번). */
const photoNodeCache = new WeakMap<PhotoCatalog, WeakMap<CampusGraph, string[]>>();
function photoNodes(catalog: PhotoCatalog, graph: CampusGraph): string[] {
  let byGraph = photoNodeCache.get(catalog);
  if (!byGraph) photoNodeCache.set(catalog, (byGraph = new WeakMap()));
  let ids = byGraph.get(graph);
  if (!ids) byGraph.set(graph, (ids = [...graph.nodes.keys()].filter((id) => catalog.byNodeId(id).length > 0)));
  return ids;
}

const scopeKey = (graph: CampusGraph, id: string): string | null => {
  const p = graph.nodes.get(id)?.properties;
  if (!p) return null;
  return p.building_id ? `${p.building_id}\u0000${String(p.level)}` : 'outdoor';
};

/**
 * 경로 위 지점이 아닌 사진 지점 중 경로선 구간에서 NEAR_PHOTO_M 안인 것. 구간은 같은 범위의 두 지점 사이(층·건물이 바뀌는
 * 구간은 보지 않는다), 범위가 같은 사진만 본다. 사진 지점마다 단계별로 가장 가까운 구간 하나, 이웃 단계끼리는 더 가까운 쪽만.
 */
export function nearbyPhotos(route: CampusRouteView, catalog: PhotoCatalog, graph: CampusGraph, line: readonly LngLat[], lineAt: readonly number[], stepOf: readonly number[]):
  { nodeId: string; stepIndex: number; lngLat: [number, number]; bearingDeg: number | null; order: number }[] {
  const onRoute = new Set(route.nodeIds);
  const scopes = route.nodeIds.map((id) => scopeKey(graph, id));
  const out: ReturnType<typeof nearbyPhotos> = [];
  for (const id of photoNodes(catalog, graph)) {
    if (onRoute.has(id)) continue;
    const scope = scopeKey(graph, id);
    const coord = graph.nodes.get(id)!.geometry.coordinates;
    const p: LngLat = [coord[0]!, coord[1]!];
    const best = new Map<number, { m: number; order: number; bearingDeg: number | null }>();
    for (let k = 0; k + 1 < route.nodeIds.length; k++) {
      const step = stepOf[k]!;
      if (step < 0 || scopes[k] === null || scopes[k] !== scopes[k + 1] || scopes[k] !== scope) continue;
      const from = lineAt[k]!, to = lineAt[k + 1]!;
      if (from < 0 || to <= from) continue;
      for (let j = from; j < to; j++) {
        const a = line[j]!, b = line[j + 1]!;
        const d = segmentDistance(p, a, b);
        if (d.m > NEAR_PHOTO_M) continue;
        const old = best.get(step);
        const flat = a[0] === b[0] && a[1] === b[1];
        if (!old || d.m < old.m) best.set(step, { m: d.m, order: k + (j - from + d.t) / Math.max(1, to - from), bearingDeg: flat ? null : initialBearingDeg(a, b) });
      }
    }
    const hits = [...best.entries()].sort((x, y) => x[0] - y[0]);
    for (const [step, hit] of hits) {
      const nearer = hits.some(([s, h]) => Math.abs(s - step) === 1 && (h.m < hit.m || (h.m === hit.m && s < step)));
      if (!nearer) out.push({ nodeId: id, stepIndex: step, lngLat: [p[0], p[1]], bearingDeg: hit.bearingDeg, order: hit.order });
    }
  }
  return out;
}
