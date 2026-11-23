// 가장 가까운 화장실: 출발 위치(지점 또는 지도 위 점)에서 코어의 findNearestRestroom으로 목적지 화장실을 고른다.
// 고른 화장실까지의 실제 경로는 화면이 기존 useCampusRoute로 다시 계산한다(경로 모양이 다른 길찾기와 같도록).
// React를 import하지 않는 순수 모듈.
import { endAtPoint, findNearestRestroom, findNearestRestroomFrom, isClosedFor } from '@campo/core';
import type { CampusRuntime } from '../../campus/types.ts';
import type { CampusRouteRequest, RouteEndpoint, TravelMode } from '../../contracts.ts';

export type RestroomResult = { found: true; nodeId: string; request: CampusRouteRequest } | { found: false; message: string };

export const RESTROOM_NONE = '가까운 화장실을 찾지 못했습니다. 다른 출발 위치를 골라 주세요.';
export const RESTROOM_NONE_WHEELCHAIR = '휠체어로 갈 수 있는 화장실을 찾지 못했습니다. 휠체어 가능을 끄거나 다른 출발 위치를 골라 주세요.';

/**
 * 출발 위치에서 가장 가까운 화장실과 그곳까지의 길찾기 요청.
 * wheelchair: 휠체어 사용 가능(wheelchair: 'yes')인 화장실만, 휠체어 이동 방식으로 찾는다.
 * mode: 휠체어가 아닐 때 쓸 이동 방식(기본 가장 빠른 길).
 */
export function nearestRestroom(runtime: CampusRuntime | null, from: RouteEndpoint, wheelchair: boolean, mode: TravelMode = 'shortest'): RestroomResult {
  const none = wheelchair ? RESTROOM_NONE_WHEELCHAIR : RESTROOM_NONE;
  if (!runtime) return { found: false, message: none };
  const kind = wheelchair ? 'wheelchair' : 'any';
  const travel: TravelMode = wheelchair ? 'wheelchair' : mode === 'wheelchair' ? 'shortest' : mode;
  let target: string | null = null;
  if (from.kind === 'node') {
    if (!runtime.graph.nodes.has(from.nodeId)) return { found: false, message: '고른 지점을 캠퍼스 데이터에서 찾지 못했습니다.' };
    const result = findNearestRestroom(runtime.graph, from.nodeId, kind);
    if (result.found) target = result.targetId;
  } else {
    const profile = wheelchair ? 'wheelchair' : 'shortest';
    const end = endAtPoint(runtime.graph, [from.lng, from.lat], (edge) => !isClosedFor(edge.properties, profile));
    if (end) {
      const result = findNearestRestroomFrom(runtime.graph, end, kind);
      if (result.found) target = result.targetId;
    }
  }
  if (target === null) return { found: false, message: none };
  return { found: true, nodeId: target, request: { from, to: { kind: 'node', nodeId: target }, mode: travel } };
}
