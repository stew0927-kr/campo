// 경로 찾기: 화면과 상관없는 순수 함수. useCampusRoute가 이 함수를 useMemo로 감싼다.
// 코어의 findRouteBetween을 그대로 쓰고, 화면이 필요로 하는 모양(예상 시간·층 이동·경사 경고·선)으로만 감싼다.
import {
  STEEP_NOTE,
  WALK_SPEED_MPS,
  findRouteBetween,
  isClosedFor,
  plazaAt,
  snapToRoutes,
  type EdgeFeature,
  type PointRoute,
  type PointRouteResult,
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

/** 경로 끝 후보 하나. snapM: 걷는 길까지 내려간 거리(평지·지점이면 null). plazaId: 평지 안의 점이면 그 평지. */
interface EndChoice {
  end: RouteEnd;
  snapM: number | null;
  plazaId: string | null;
}

/**
 * 계단 최소(fewest_steps)에서 가장 가까운 구간이 계단이면, 이 거리(m) 안의 계단 아닌 구간도 출발 후보로 본다.
 * 그래야 고른 점이 계단에 붙어 계단 끝까지 갔다가 되돌아오는 길이 나오지 않는다.
 */
export const STAIR_FREE_SNAP_SLACK_M = 25;

const isSteps = (edge: EdgeFeature): boolean => edge.properties.highway === 'steps';

/**
 * 요청한 출발·도착을 코어의 경로 끝 후보로 바꾼다(편집기 경로 테스트의 직접 선택과 같은 규칙: core endAtPoint).
 * - 지점: 그 지점 하나.
 * - 평지(plaza)의 단단한 면 안의 점: 평지 안을 곧게(구멍은 돌아서) 걸어 길에 닿는 평지 끝. 평지 밖으로 나가지 않는다.
 * - 그 밖(평지의 구멍 포함): 이 방식이 지날 수 있는 가장 가까운 걷는 구간 위의 점. 계단 최소는 계단 아닌 구간도 후보로 둔다.
 */
function endsOf(runtime: CampusRuntime, endpoint: RouteEndpoint, profile: Profile, usePlaza = true): EndChoice[] | { message: string } {
  if (endpoint.kind === 'node') {
    if (!runtime.graph.nodes.has(endpoint.nodeId)) {
      return { message: '고른 지점을 캠퍼스 데이터에서 찾지 못했습니다.' };
    }
    return [{ end: { nodeId: endpoint.nodeId }, snapM: null, plazaId: null }];
  }
  const { lat, lng } = endpoint;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { message: '고른 위치의 좌표가 올바르지 않습니다. 지도에서 다시 골라 주세요.' };
  }
  const point: Position = [lng, lat];
  const choices: EndChoice[] = [];
  // 평지 안의 점은 평지 안에서만 걷는다: 평지 밖 길에 공중으로 붙이는 후보는 두지 않는다(평지가 길과 닿지 않을 때만 usePlaza=false로 다시).
  const on = usePlaza ? plazaAt(runtime.graph, point) : null;
  if (on?.hit === 'solid') return [{ end: { plaza: { plazaId: on.plaza.id, point } }, snapM: null, plazaId: on.plaza.id }];
  const walkable = walkableFor(runtime, profile);
  const snap = snapToRoutes(runtime.graph, point, walkable);
  if (snap !== null && snap.distanceM < MAX_SNAP_DISTANCE_M) {
    choices.push({ end: { snap }, snapM: snap.distanceM, plazaId: null });
    if (profile === 'fewest_steps') {
      const flat = snapToRoutes(runtime.graph, point, (e) => walkable(e) && !isSteps(e));
      if (flat !== null && flat.edgeId !== snap.edgeId && flat.distanceM < Math.min(MAX_SNAP_DISTANCE_M, snap.distanceM + STAIR_FREE_SNAP_SLACK_M)) {
        choices.push({ end: { snap: flat }, snapM: flat.distanceM, plazaId: null });
      }
    }
  }
  return choices.length > 0 ? choices : { message: NO_WALKWAY };
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

function polylineOf(runtime: CampusRuntime, route: PointRoute): { points: RoutePoint[]; legs: PolylineLeg[]; nodeIndex: number[] } {
  const points: RoutePoint[] = [];
  const nodeIndex: (number | undefined)[] = [];
  // 바로 앞 점과 같은 점(평지 걷는 선이 길과 닿는 지점)은 한 번만 넣는다(편집기 routeStops와 같다).
  const push = (position: Position): void => {
    const last = points[points.length - 1];
    if (last !== undefined && last.lng === position[0] && last.lat === position[1]) return;
    points.push({ lat: position[1], lng: position[0] });
  };
  // 출발: 평지 안의 점이면 평지 안을 걷는 선(고른 점 → 길과 닿는 곳), 아니면 걷는 길 위의 발.
  const startPath = route.startPlaza?.path ?? (route.startFoot !== null ? [route.startFoot] : []);
  for (const p of startPath) push(p);
  const hasStart = startPath.length > 0;
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
  // 도착: 길과 닿는 곳 → 평지 안의 고른 점, 아니면 발.
  const endPath = route.endPlaza?.path ?? (route.endFoot !== null ? [route.endFoot] : []);
  for (const p of endPath) push(p);
  const hasEnd = endPath.length > 0;
  const legs = legsOf(route, nodeIndex, points.length - 1, hasStart, hasEnd);
  // 출발과 도착이 같은 자리면 점이 하나뿐이다. 한 점짜리 LineString은 지도에 그릴 수 없으므로 같은 점을 한 번 더 둔다.
  const only = points.length === 1 ? points[0] : undefined;
  if (only !== undefined) points.push({ lat: only.lat, lng: only.lng });
  return { points, legs, nodeIndex: nodeIndex.map((i) => i ?? -1) };
}

/** 경로선을 진행 순서대로 구간(출발 쪽 → 첫 지점, 지점 → 지점, 마지막 지점 → 도착 쪽)으로 나눈다. 좌표를 찾지 못한 지점 옆 구간은 뺀다. */
function legsOf(route: PointRoute, nodeIndex: readonly (number | undefined)[], last: number, hasStart: boolean, hasEnd: boolean): PolylineLeg[] {
  const legs: PolylineLeg[] = [];
  const add = (from: string | null, to: string | null, start: number | undefined, end: number | undefined): void => {
    if (start !== undefined && end !== undefined && start <= end) legs.push({ from, to, start, end });
  };
  const ids = route.nodes;
  if (ids.length === 0) {
    // 한 구간 위(또는 한 평지 안)에서 출발 점에서 도착 점으로 바로 걷는 경로.
    if (hasStart && hasEnd) add(null, null, 0, last);
    return legs;
  }
  if (hasStart) add(null, ids[0]!, 0, nodeIndex[0]);
  for (let i = 0; i + 1 < ids.length; i++) add(ids[i]!, ids[i + 1]!, nodeIndex[i], nodeIndex[i + 1]);
  if (hasEnd) add(ids[ids.length - 1]!, null, nodeIndex[ids.length - 1], last);
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
    nodeIndex: line.nodeIndex,
  };
  if (route.startPlaza) view.startPlazaId = route.startPlaza.plazaId;
  if (route.endPlaza) view.endPlazaId = route.endPlaza.plazaId;
  return view;
}

type Best = { result: PointRoute; from: EndChoice; to: EndChoice; score: number };

/** 출발·도착 후보마다 코어로 경로를 찾고, 비용 + 길까지 내려가는 걸음(초)이 가장 작은 것을 고른다. */
function bestRoute(runtime: CampusRuntime, fromEndpoint: RouteEndpoint, toEndpoint: RouteEndpoint, profile: Profile, usePlaza: boolean): Best | { message: string; plaza: boolean } {
  const froms = endsOf(runtime, fromEndpoint, profile, usePlaza);
  const tos = endsOf(runtime, toEndpoint, profile, usePlaza);
  const plaza = (!('message' in froms) && froms.some((c) => c.plazaId !== null)) || (!('message' in tos) && tos.some((c) => c.plazaId !== null));
  if ('message' in froms) return { message: froms.message, plaza };
  if ('message' in tos) return { message: tos.message, plaza };
  let best: Best | null = null;
  let firstMiss: Exclude<PointRouteResult, PointRoute> | null = null;
  for (const from of froms) {
    for (const to of tos) {
      const result = findRouteBetween(runtime.graph, from.end, to.end, profile);
      if (!result.found) {
        firstMiss ??= result;
        continue;
      }
      const score = result.cost + ((from.snapM ?? 0) + (to.snapM ?? 0)) / WALK_SPEED_MPS;
      if (best === null || score < best.score) best = { result, from, to, score };
    }
  }
  return best ?? { message: firstMiss?.message ?? NO_WALKWAY, plaza };
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
  let found = bestRoute(runtime, request.from, request.to, profile, true);
  // 평지가 이 방식으로 길에 닿지 않으면(접점이 없는 평지) 예전처럼 가장 가까운 길에 붙여 다시 찾는다.
  if ('message' in found && found.plaza) found = bestRoute(runtime, request.from, request.to, profile, false);
  if ('message' in found) return { status: 'not-found', route: null, message: found.message };
  const best = found;

  const route = viewOf(runtime, best.result);
  if (best.from.snapM !== null) route.snappedStartM = best.from.snapM;
  if (best.to.snapM !== null) route.snappedEndM = best.to.snapM;
  return { status: 'ok', route, message: null };
}
