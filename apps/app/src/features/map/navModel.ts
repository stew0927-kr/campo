// 단계별 위치 안내(네비게이션) 화면이 쓰는 값. React를 import하지 않는 순수 모듈.
// 경로선(polyline)에서 각 안내 단계가 차지하는 구간을 잘라 카메라가 그 구간에 맞춰 이동하게 한다.
import type { CampusGraph } from '@campo/core';
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
    return [{ index: 0, text: `도착지까지 약 ${Math.round(route.distanceM)}m 걸어가세요.`, distanceM: route.distanceM, coordinates: segments[0] ?? [], buildingId: null, level: null }];
  }
  return route.steps.map((step, i) => ({
    index: i,
    text: step.text,
    distanceM: step.distanceM,
    coordinates: segments[i] ?? [],
    ...stepScope(graph, step.fromNodeId),
  }));
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
