// 경로 찾기: 화면과 상관없는 순수 함수. useCampusRoute가 이 함수를 useMemo로 감싼다.
// 코어의 findRouteBetween을 그대로 쓰고, 화면이 필요로 하는 모양(예상 시간·층 이동·경사 경고·선)으로만 감싼다.
import {
  STEEP_NOTE,
  findRouteBetween,
  isClosedFor,
  snapToRoutes,
  type EdgeFeature,
  type PointRoute,
  type Position,
  type Profile,
  type RouteEnd,
  type RouteStep,
  type SlopeSegment,
} from '@campo/core';
import type { CampusRouteRequest, CampusRouteState, CampusRouteView, FloorChange, RouteEndpoint, RoutePoint, SlopeWarning } from '../contracts.ts';
import type { CampusRuntime } from '../campus/types.ts';

const DEFAULT_MODE: Profile = 'shortest';

/** 지도에서 고른 점이 가장 가까운 걷는 길에서 이만큼(m) 이상 떨어져 있으면 길이 없는 곳으로 본다(캠퍼스 밖을 골랐을 때). */
export const MAX_SNAP_DISTANCE_M = 150;

const NO_WALKWAY = '걷는 길이 없는 위치입니다. 캠퍼스 안에서 다시 골라 주세요.';

const VIA_LABEL: Record<FloorChange['kind'], string> = {
  elevator: '엘리베이터',
  stairs: '계단',
  escalator: '에스컬레이터',
};

const levelLabel = (level: number): string => (level < 0 ? `지하 ${-level}층` : `${level}층`);

/**
 * 지도에서 고른 점을 붙일 수 있는 구간: 이 이동 방식이 지날 수 있고(휠체어·계단 없는 길이면 계단·턱 제외),
 * 공사·고장으로 닫히지 않은 구간만. 그래야 휠체어로 고른 점이 가까운 계단에 붙어 길이 없다고 나오지 않는다.
 */
function walkableFor(runtime: CampusRuntime, profile: Profile): (edge: EdgeFeature) => boolean {
  const { closed } = runtime.graph;
  return (edge) =>
    !isClosedFor(edge.properties, profile) &&
    !closed.has(edge.id) &&
    !closed.has(edge.properties.from) &&
    !closed.has(edge.properties.to);
}

/** 요청한 출발·도착을 코어의 경로 끝(지점 또는 이 방식이 지날 수 있는 가장 가까운 걷는 구간 위의 점)으로 바꾼다. */
function endOf(runtime: CampusRuntime, endpoint: RouteEndpoint, profile: Profile): { end: RouteEnd; snapM: number | null } | { message: string } {
  if (endpoint.kind === 'node') {
    if (!runtime.graph.nodes.has(endpoint.nodeId)) {
      return { message: '고른 지점을 캠퍼스 데이터에서 찾지 못했습니다.' };
    }
    return { end: { nodeId: endpoint.nodeId }, snapM: null };
  }
  const { lat, lng } = endpoint;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { message: '고른 위치의 좌표가 올바르지 않습니다. 지도에서 다시 골라 주세요.' };
  }
  const snap = snapToRoutes(runtime.graph, [lng, lat], walkableFor(runtime, profile));
  if (snap === null || !(snap.distanceM < MAX_SNAP_DISTANCE_M)) return { message: NO_WALKWAY };
  return { end: { snap }, snapM: snap.distanceM };
}

/**
 * 경로선 위의 한 구간: 두 캠퍼스 지점 사이, 또는 지도에서 고른 점의 발(foot)과 지점 사이(null = 발).
 * start/end는 polyline의 index(양 끝 포함).
 */
interface PolylineLeg {
  from: string | null;
  to: string | null;
  start: number;
  end: number;
}

function polylineOf(runtime: CampusRuntime, route: PointRoute): { points: RoutePoint[]; legs: PolylineLeg[] } {
  const points: RoutePoint[] = [];
  const nodeIndex: (number | undefined)[] = [];
  const push = (position: Position): void => {
    points.push({ lat: position[1], lng: position[0] });
  };
  if (route.startFoot !== null) push(route.startFoot);
  // 평지를 건너는 구간(길 A → 평지 → 길 B)은 두 지점 사이에 평지 위 걷는 선을 끼워 넣는다(구멍을 돌아가는 꺾임 포함).
  const vias = route.viaPlazas ?? [];
  let next = 0;
  route.nodes.forEach((id, i) => {
    const node = runtime.graph.nodes.get(id);
    if (node !== undefined) push(node.geometry.coordinates as Position);
    nodeIndex.push(node !== undefined ? points.length - 1 : undefined);
    const via = vias[next];
    if (via !== undefined && via.fromNodeId === id && via.toNodeId === route.nodes[i + 1]) {
      for (const p of via.line.slice(1, -1)) push(p);
      next++;
    }
  });
  if (route.endFoot !== null) push(route.endFoot);
  const legs = legsOf(route, nodeIndex, points.length - 1);
  // 출발과 도착이 같은 자리면 점이 하나뿐이다. 한 점짜리 LineString은 지도에 그릴 수 없으므로 같은 점을 한 번 더 둔다.
  const only = points.length === 1 ? points[0] : undefined;
  if (only !== undefined) points.push({ lat: only.lat, lng: only.lng });
  return { points, legs };
}

/** 경로선을 진행 순서대로 구간(발 → 첫 지점, 지점 → 지점, 마지막 지점 → 발)으로 나눈다. 좌표를 찾지 못한 지점 옆 구간은 뺀다. */
function legsOf(route: PointRoute, nodeIndex: readonly (number | undefined)[], last: number): PolylineLeg[] {
  const legs: PolylineLeg[] = [];
  const add = (from: string | null, to: string | null, start: number | undefined, end: number | undefined): void => {
    if (start !== undefined && end !== undefined && start <= end) legs.push({ from, to, start, end });
  };
  const ids = route.nodes;
  if (ids.length === 0) {
    // 한 구간 위에서 발에서 발로 바로 걷는 경로.
    if (route.startFoot !== null && route.endFoot !== null) add(null, null, 0, last);
    return legs;
  }
  if (route.startFoot !== null) add(null, ids[0]!, 0, nodeIndex[0]);
  for (let i = 0; i + 1 < ids.length; i++) add(ids[i]!, ids[i + 1]!, nodeIndex[i], nodeIndex[i + 1]);
  if (route.endFoot !== null) add(ids[ids.length - 1]!, null, nodeIndex[ids.length - 1], last);
  return legs;
}

/** 계단·에스컬레이터·엘리베이터 단계 중 층이 실제로 바뀌는 곳만. 층 번호는 표시에만 쓴다(길찾기는 비교하지 않는다). */
function floorChangesOf(steps: readonly RouteStep[]): FloorChange[] {
  const changes: FloorChange[] = [];
  for (const step of steps) {
    if (step.kind !== 'elevator' && step.kind !== 'stairs' && step.kind !== 'escalator') continue;
    const { fromLevel, toLevel } = step;
    if (fromLevel === null || toLevel === null || fromLevel === toLevel) continue;
    changes.push({
      kind: step.kind,
      fromLevel,
      toLevel,
      label: `${levelLabel(fromLevel)} → ${levelLabel(toLevel)} (${VIA_LABEL[step.kind]})`,
    });
  }
  return changes;
}

/**
 * 경사 구간마다 경로선에서 차지하는 자리를 찾는다. 경사 구간과 경로선 구간은 둘 다 진행 순서이므로 앞에서부터 차례로 맞춘다.
 * 지점과 지점 사이는 두 id가 같아야 하고, 발 쪽 구간(null)은 그 쪽 id를 따지지 않는다.
 */
function placeSegments(segments: readonly SlopeSegment[], legs: readonly PolylineLeg[]): (PolylineLeg | null)[] {
  let cursor = 0;
  return segments.map((segment) => {
    for (let k = cursor; k < legs.length; k++) {
      const leg = legs[k]!;
      if ((leg.from === null || leg.from === segment.from) && (leg.to === null || leg.to === segment.to)) {
        cursor = k + 1;
        return leg;
      }
    }
    return null;
  });
}

function slopeWarningsOf(segments: readonly SlopeSegment[], points: readonly RoutePoint[], legs: readonly PolylineLeg[]): SlopeWarning[] {
  const placed = placeSegments(segments, legs);
  return segments.map((segment, i) => {
    const leg = placed[i];
    const place = leg
      ? { polylineRange: [leg.start, leg.end] as [number, number], coordinates: points.slice(leg.start, leg.end + 1).map((p): [number, number] => [p.lng, p.lat]) }
      : {};
    const where = segment.gradePct > 0 ? '오르막' : segment.gradePct < 0 ? '내리막' : '평지';
    const word = segment.gradeClass === 'steep' ? '급경사' : '경사';
    const tail = segment.gradeClass === 'steep' ? ` · ${STEEP_NOTE}` : '';
    return {
      edgeId: segment.edgeId,
      gradePct: segment.gradePct,
      gradeClass: segment.gradeClass,
      message: `${word} ${Math.abs(segment.gradePct)}% (${where})${tail}`,
      ...place,
    };
  });
}

function viewOf(runtime: CampusRuntime, route: PointRoute): CampusRouteView {
  const line = polylineOf(runtime, route);
  const view: CampusRouteView = {
    profile: route.profile,
    usedProfile: route.fallback !== null ? 'fewest_steps' : route.profile,
    timeSec: route.timeSec,
    distanceM: route.distanceM,
    stairsCount: route.stairsCount,
    escalatorCount: route.escalatorCount,
    steps: route.steps,
    floorChanges: floorChangesOf(route.steps),
    slopeWarnings: slopeWarningsOf(route.slopeSegments, line.points, line.legs),
    fallbackMessage: route.fallback !== null ? route.fallback.message : null,
    polyline: line.points,
    nodeIds: [...route.nodes],
  };
  return view;
}

/**
 * 출발·도착·모드로 경로를 찾는다.
 * - 둘 중 하나라도 없으면 idle(화면은 이전 결과를 그대로 두면 된다).
 * - 지점을 찾지 못하거나 길이 없으면 not-found와 함께 한국어 설명을 준다.
 */
export function computeRoute(runtime: CampusRuntime | null, request: CampusRouteRequest | null): CampusRouteState {
  if (request === null || request.from === null || request.to === null) {
    return { status: 'idle', route: null, message: null };
  }
  if (runtime === null) {
    return { status: 'error', route: null, message: '캠퍼스 데이터를 아직 읽지 못했습니다.' };
  }
  const profile = request.mode ?? DEFAULT_MODE;
  const from = endOf(runtime, request.from, profile);
  if ('message' in from) return { status: 'not-found', route: null, message: from.message };
  const to = endOf(runtime, request.to, profile);
  if ('message' in to) return { status: 'not-found', route: null, message: to.message };

  const result = findRouteBetween(runtime.graph, from.end, to.end, profile);
  if (!result.found) return { status: 'not-found', route: null, message: result.message };

  const route = viewOf(runtime, result);
  if (from.snapM !== null) route.snappedStartM = from.snapM;
  if (to.snapM !== null) route.snappedEndM = to.snapM;
  return { status: 'ok', route, message: null };
}
