// 경로 찾기: 화면과 상관없는 순수 함수. useCampusRoute가 이 함수를 useMemo로 감싼다.
// 코어의 findRouteBetween을 그대로 쓰고, 화면이 필요로 하는 모양(예상 시간·층 이동·경사 경고·선)으로만 감싼다.
import { STEEP_NOTE, findRouteBetween, snapToRoutes, type PointRoute, type Position, type RouteEnd, type RouteStep, type SlopeSegment } from '@campo/core';
import type { CampusRouteRequest, CampusRouteState, CampusRouteView, FloorChange, RouteEndpoint, RoutePoint, SlopeWarning } from '../contracts.ts';
import type { CampusRuntime } from '../campus/types.ts';

const DEFAULT_MODE = 'shortest';

const VIA_LABEL: Record<FloorChange['kind'], string> = {
  elevator: '엘리베이터',
  stairs: '계단',
  escalator: '에스컬레이터',
};

const levelLabel = (level: number): string => (level < 0 ? `지하 ${-level}층` : `${level}층`);

/** 요청한 출발·도착을 코어의 경로 끝(지점 또는 가장 가까운 걷는 구간 위의 점)으로 바꾼다. */
function endOf(runtime: CampusRuntime, endpoint: RouteEndpoint): { end: RouteEnd; snapM: number | null } | { message: string } {
  if (endpoint.kind === 'node') {
    if (!runtime.graph.nodes.has(endpoint.nodeId)) {
      return { message: '고른 지점을 캠퍼스 데이터에서 찾지 못했습니다.' };
    }
    return { end: { nodeId: endpoint.nodeId }, snapM: null };
  }
  const snap = snapToRoutes(runtime.graph, [endpoint.lng, endpoint.lat]);
  if (snap === null) return { message: '걷는 길이 없는 위치입니다. 캠퍼스 안에서 다시 골라 주세요.' };
  return { end: { snap }, snapM: snap.distanceM };
}

function polylineOf(runtime: CampusRuntime, route: PointRoute): RoutePoint[] {
  const points: RoutePoint[] = [];
  const push = (position: Position): void => {
    points.push({ lat: position[1], lng: position[0] });
  };
  if (route.startFoot !== null) push(route.startFoot);
  for (const id of route.nodes) {
    const node = runtime.graph.nodes.get(id);
    if (node !== undefined) push(node.geometry.coordinates as Position);
  }
  if (route.endFoot !== null) push(route.endFoot);
  return points;
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

function slopeWarningsOf(segments: readonly SlopeSegment[]): SlopeWarning[] {
  return segments.map((segment) => {
    const where = segment.gradePct > 0 ? '오르막' : segment.gradePct < 0 ? '내리막' : '평지';
    const word = segment.gradeClass === 'steep' ? '급경사' : '경사';
    const tail = segment.gradeClass === 'steep' ? ` · ${STEEP_NOTE}` : '';
    return {
      edgeId: segment.edgeId,
      gradePct: segment.gradePct,
      gradeClass: segment.gradeClass,
      message: `${word} ${Math.abs(segment.gradePct)}% (${where})${tail}`,
    };
  });
}

function viewOf(runtime: CampusRuntime, route: PointRoute): CampusRouteView {
  const view: CampusRouteView = {
    profile: route.profile,
    usedProfile: route.fallback !== null ? 'fewest_steps' : route.profile,
    timeSec: route.timeSec,
    distanceM: route.distanceM,
    stairsCount: route.stairsCount,
    escalatorCount: route.escalatorCount,
    steps: route.steps,
    floorChanges: floorChangesOf(route.steps),
    slopeWarnings: slopeWarningsOf(route.slopeSegments),
    fallbackMessage: route.fallback !== null ? route.fallback.message : null,
    polyline: polylineOf(runtime, route),
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
  const from = endOf(runtime, request.from);
  if ('message' in from) return { status: 'not-found', route: null, message: from.message };
  const to = endOf(runtime, request.to);
  if ('message' in to) return { status: 'not-found', route: null, message: to.message };

  const profile = request.mode ?? DEFAULT_MODE;
  const result = findRouteBetween(runtime.graph, from.end, to.end, profile);
  if (!result.found) return { status: 'not-found', route: null, message: result.message };

  const route = viewOf(runtime, result);
  if (from.snapM !== null) route.snappedStartM = from.snapM;
  if (to.snapM !== null) route.snappedEndM = to.snapM;
  return { status: 'ok', route, message: null };
}
