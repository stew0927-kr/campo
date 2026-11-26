// 단계별 위치 안내(네비게이션) 화면이 쓰는 값. React를 import하지 않는 순수 모듈.
// 경로선(polyline)에서 각 안내 단계가 차지하는 구간을 잘라 카메라가 그 구간에 맞춰 이동하게 한다.
import { initialBearingDeg, type CampusGraph } from '@campo/core';
import type { CampusRouteView, RouteStepPhoto } from '../../contracts.ts';

export type LngLat = [number, number];

/** 안내 카드 하나: 단계 문장과 그 단계가 지나는 경로선 구간. */
export interface NavCard {
  /** steps의 index. 단계가 없는 경로(한 평지 안을 곧게 걷기)는 0 하나. */
  index: number;
  text: string;
  distanceM: number;
  coordinates: LngLat[];
  /** 그 단계 시작 지점이 실내면 건물·층(지도가 그 층을 보인다), 실외면 null. */
  buildingId: string | null;
  level: number | null;
  /**
   * 진행 방향(0~360): 지도를 이 방위가 화면 위쪽이 되게 돌린다. 실내 층 도면 단계, 엘리베이터·계단처럼 제자리에서 층만
   * 바뀌는 단계는 null(정북 유지).
   */
  bearingDeg: number | null;
}

const lngLat = (p: { lng: number; lat: number }): LngLat => [p.lng, p.lat];

/**
 * 각 단계가 경로선에서 차지하는 구간. 단계는 진행 순서라 nodeIds에서 앞에서부터 fromNodeId → toNodeId를 찾는다.
 * 첫 단계는 경로선 처음(지도에서 고른 점·평지 안 걷기 포함)부터, 마지막 단계는 경로선 끝까지 늘린다.
 * nodeIndex가 없거나 단계를 찾지 못하면 그 단계는 경로 전체를 쓴다.
 */
export function stepSegments(route: Pick<CampusRouteView, 'polyline' | 'nodeIds' | 'nodeIndex' | 'steps'>): LngLat[][] {
  const all = route.polyline.map(lngLat);
  const index = route.nodeIndex?.length === route.nodeIds.length ? route.nodeIndex : null;
  if (route.steps.length === 0) return all.length ? [all] : [];
  let cursor = 0;
  return route.steps.map((step, i) => {
    if (index === null) return all;
    let a = route.nodeIds.indexOf(step.fromNodeId, cursor);
    if (a < 0) a = route.nodeIds.indexOf(step.fromNodeId);
    const b = a < 0 ? -1 : route.nodeIds.indexOf(step.toNodeId, a);
    if (a < 0 || b < 0) return all;
    cursor = b;
    const start = i === 0 ? 0 : index[a]!;
    const end = i === route.steps.length - 1 ? all.length - 1 : index[b]!;
    if (start < 0 || end < 0 || end < start) return all;
    const part = all.slice(start, end + 1);
    // 엘리베이터처럼 한 자리에서 층만 바뀌는 단계도 카메라가 맞출 수 있게 점 두 개를 둔다.
    return part.length >= 2 ? part : part.length === 1 ? [part[0]!, part[0]!] : all;
  });
}

/** 단계 시작 지점의 건물·층(실외면 null). 층은 화면 표시용으로만 쓴다. */
export function stepScope(graph: CampusGraph | null, nodeId: string | null): { buildingId: string | null; level: number | null } {
  const props = nodeId ? graph?.nodes.get(nodeId)?.properties : undefined;
  const buildingId = props?.building_id ?? null;
  return buildingId ? { buildingId, level: props?.level ?? null } : { buildingId: null, level: null };
}

/** 안내 카드 목록. 단계가 없는 경로는 경로 전체를 걷는 카드 하나. */
export function navCards(route: CampusRouteView, graph: CampusGraph | null): NavCard[] {
  const segments = stepSegments(route);
  if (route.steps.length === 0) {
    const coordinates = segments[0] ?? [];
    return [{ index: 0, text: `도착지까지 약 ${Math.round(route.distanceM)}m 걸어가세요.`, distanceM: route.distanceM, coordinates, buildingId: null, level: null, bearingDeg: stepHeading(coordinates) }];
  }
  return route.steps.map((step, i) => {
    const coordinates = segments[i] ?? [];
    const scope = stepScope(graph, step.fromNodeId);
    const inPlace = step.kind === 'elevator' || step.kind === 'escalator' || (step.kind === 'stairs' && scope.buildingId !== null);
    return {
      index: i,
      text: step.text,
      distanceM: step.distanceM,
      coordinates,
      ...scope,
      bearingDeg: scope.buildingId !== null || inPlace ? null : stepHeading(coordinates),
    };
  });
}

/**
 * 이 단계에서 보여 줄 현장 사진: 단계 시작 지점의 사진(마지막 단계는 도착 지점 사진도 본다). 사진이 없으면 null.
 * 반환하는 entry는 RouteStepPhoto 목록 안의 위치(로드뷰 장면 위치와 같다).
 */
export function stepPhotoEntry(stepPhotos: readonly RouteStepPhoto[], stepIndex: number, lastStep: boolean): number | null {
  const at = stepPhotos.findIndex((s) => s.stepIndex === stepIndex && s.photo !== null && s.lngLat !== null);
  if (at >= 0) return at;
  if (!lastStep) return null;
  const end = stepPhotos.findIndex((s) => s.stepIndex === stepIndex + 1 && s.photo !== null && s.lngLat !== null);
  return end >= 0 ? end : null;
}

/* ---------- 위치 안내 카메라: 진행 방향이 화면 위쪽 ---------- */

/** 단계 진입 방위를 볼 때 단계 경로의 앞쪽 거리(m). */
export const NAV_HEADING_LOOK_M = 25;
/** 단계 앞쪽으로 걷는 거리가 이보다 짧으면(엘리베이터·제자리 계단) 방위를 정하지 않는다. */
export const NAV_HEADING_MIN_M = 3;
/** 진행 방향으로 돌릴 때의 기울기(도). 회전하지 않는 단계는 0. */
export const NAV_PITCH_DEG = 45;

const M_PER_DEG_LAT = 110_540, M_PER_DEG_LNG = 111_320;
const metres = (a: LngLat, b: LngLat) => {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * M_PER_DEG_LNG * k, (b[1] - a[1]) * M_PER_DEG_LAT);
};

/** 경로선을 처음부터 `m`만큼 걸은 점(선이 짧으면 끝점)과 실제로 걸은 거리. */
export function pointAlong(coordinates: readonly LngLat[], m: number): { point: LngLat; walkedM: number } | null {
  const first = coordinates[0];
  if (!first) return null;
  let walked = 0;
  for (let i = 0; i + 1 < coordinates.length; i++) {
    const a = coordinates[i]!, b = coordinates[i + 1]!;
    const seg = metres(a, b);
    if (seg <= 0) continue;
    if (walked + seg >= m) {
      const t = (m - walked) / seg;
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], walkedM: m };
    }
    walked += seg;
  }
  return { point: coordinates[coordinates.length - 1]!, walkedM: walked };
}

/**
 * 단계에 들어설 때의 진행 방위(0~360, 북쪽 0, 시계 방향): 단계 경로 첫 점에서 앞쪽 `lookM`(20~30 m) 지점까지.
 * 앞쪽으로 걷는 거리가 NAV_HEADING_MIN_M보다 짧으면(엘리베이터·제자리에서 층만 바뀌는 계단) null.
 */
export function stepHeading(coordinates: readonly LngLat[], lookM = NAV_HEADING_LOOK_M): number | null {
  const start = coordinates[0];
  const ahead = pointAlong(coordinates, lookM);
  if (!start || !ahead || ahead.walkedM < NAV_HEADING_MIN_M) return null;
  return initialBearingDeg(start, ahead.point);
}

/** 위치 안내 단계의 카메라. bearing이 null이면 정북·평면으로 구간 맞춤(fit)을 쓴다. */
export interface NavCamera { center: LngLat; zoom: number; bearing: number }

/**
 * 진행 방향으로 돌린 카메라: 단계 앞쪽(최대 60 m)의 가운데를 화면 가운데에, 그 거리가 화면 높이의 절반쯤 들어오는 배율.
 * 방위를 정할 수 없는 단계는 null.
 */
export function navCamera(coordinates: readonly LngLat[], bearingDeg: number | null, viewHeightPx: number): NavCamera | null {
  if (bearingDeg === null || coordinates.length === 0) return null;
  const total = pointAlong(coordinates, Number.POSITIVE_INFINITY)!.walkedM;
  const spanM = Math.min(Math.max(total, 30), 60);
  const center = pointAlong(coordinates, Math.min(total, spanM) / 2)!.point;
  const height = viewHeightPx > 0 ? viewHeightPx : 640;
  // MapLibre 512px 타일: 1px = 78271.517·cos(위도) / 2^zoom m.
  const zoom = Math.log2((78271.517 * Math.cos((center[1] * Math.PI) / 180) * height * 0.5) / spanM);
  return { center, zoom: Math.min(19.5, Math.max(16.5, zoom)), bearing: bearingDeg };
}
