// 가장 가까운 화장실: 출발 위치(지점 또는 지도 위 점)에서 코어의 findNearestRestroom으로 목적지 화장실을 고른다.
// 남자/여자를 고르면 restroomGender.ts의 판정(+휠체어)으로 후보를 정해 코어의 findNearest·findRouteBetween으로 고른다.
// 고른 화장실까지의 실제 경로는 화면이 기존 useCampusRoute로 다시 계산한다(경로 모양이 다른 길찾기와 같도록).
// React를 import하지 않는 순수 모듈.
import { endAtPoint, findNearest, findNearestRestroom, findNearestRestroomFrom, findRouteBetween, isClosedFor, type CampusGraph, type Profile, type RouteEnd } from '@campo/core';
import type { CampusRuntime } from '../../campus/types.ts';
import type { CampusRouteRequest, RouteEndpoint, TravelMode } from '../../contracts.ts';
import { restroomNodeMatches, type RestroomWanted } from './restroomGender.ts';

export type RestroomResult = { found: true; nodeId: string; request: CampusRouteRequest } | { found: false; message: string };

export const RESTROOM_NONE = '가까운 화장실을 찾지 못했습니다. 다른 출발 위치를 골라 주세요.';
export const RESTROOM_NONE_WHEELCHAIR = '휠체어로 갈 수 있는 화장실을 찾지 못했습니다. 휠체어 가능을 끄거나 다른 출발 위치를 골라 주세요.';
export const RESTROOM_NONE_GENDER = '조건에 맞는 화장실을 찾지 못했습니다. 성별을 전체로 바꾸거나 다른 출발 위치를 골라 주세요.';

/**
 * 지도 위 점에서 성별 조건에 맞는 가장 가까운 화장실: 후보마다 findRouteBetween을 돌려 가장 싼 것.
 * 비용이 같으면 지점 id가 작은 쪽(결과가 데이터 순서에 따라 바뀌지 않게).
 */
function cheapestRestroom(graph: CampusGraph, from: RouteEnd, wanted: RestroomWanted, wheelchair: boolean, profile: Profile): string | null {
  const ids = [...graph.nodes].filter(([id, node]) => !graph.closed.has(id) && restroomNodeMatches(node, wanted, wheelchair)).map(([id]) => id).sort();
  let best: { id: string; cost: number } | null = null;
  for (const id of ids) {
    const r = findRouteBetween(graph, from, { nodeId: id }, profile);
    if (r.found && (!best || r.cost < best.cost)) best = { id, cost: r.cost };
  }
  return best?.id ?? null;
}

/**
 * 출발 위치에서 가장 가까운 화장실과 그곳까지의 길찾기 요청.
 * wheelchair: 휠체어 사용 가능(wheelchair: 'yes')인 화장실만, 휠체어 이동 방식으로 찾는다.
 * mode: 휠체어가 아닐 때 쓸 이동 방식(기본 가장 빠른 길).
 * gender: 전체(기본, 지금까지와 같다) / 남자 / 여자. 성별 제한이 없는 화장실은 남자·여자 양쪽 후보다.
 */
export function nearestRestroom(runtime: CampusRuntime | null, from: RouteEndpoint, wheelchair: boolean, mode: TravelMode = 'shortest', gender: RestroomWanted = 'any'): RestroomResult {
  const none = wheelchair ? RESTROOM_NONE_WHEELCHAIR : gender !== 'any' ? RESTROOM_NONE_GENDER : RESTROOM_NONE;
  if (!runtime) return { found: false, message: none };
  const kind = wheelchair ? 'wheelchair' : 'any';
  const travel: TravelMode = wheelchair ? 'wheelchair' : mode === 'wheelchair' ? 'shortest' : mode;
  let target: string | null = null;
  if (from.kind === 'node') {
    if (!runtime.graph.nodes.has(from.nodeId)) return { found: false, message: '고른 지점을 캠퍼스 데이터에서 찾지 못했습니다.' };
    const result = gender === 'any'
      ? findNearestRestroom(runtime.graph, from.nodeId, kind)
      : findNearest(runtime.graph, from.nodeId, (node) => restroomNodeMatches(node, gender, wheelchair), wheelchair ? 'wheelchair' : 'shortest');
    if (result.found) target = result.targetId;
  } else {
    const profile = wheelchair ? 'wheelchair' : 'shortest';
    const end = endAtPoint(runtime.graph, [from.lng, from.lat], (edge) => !isClosedFor(edge.properties, profile));
    if (end && gender === 'any') {
      const result = findNearestRestroomFrom(runtime.graph, end, kind);
      if (result.found) target = result.targetId;
    } else if (end) {
      target = cheapestRestroom(runtime.graph, end, gender, wheelchair, profile);
    }
  }
  if (target === null) return { found: false, message: none };
  return { found: true, nodeId: target, request: { from, to: { kind: 'node', nodeId: target }, mode: travel } };
}
