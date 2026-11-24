// 경로 테스트 → 가장 가까운 (남자 / 여자) 화장실. Pure: no React, tested in Node.
// core's isRestroomFor only lets 'unisex' into both lists, so the gender rule lives here and is combined with core's
// findNearestRestroomFrom / findRouteBetween (core is not changed for it).
import {
  findNearestRestroomFrom, findRouteBetween,
  type CampusGraph, type NodeFeature, type PointRouteResult, type Profile, type RouteEnd,
} from '@campo/core';

/** 전체 / 남자 / 여자. */
export type RestroomWanted = 'any' | 'male' | 'female';

export const NO_MATCH_MESSAGE = '조건에 맞는 화장실이 없습니다.';

/**
 * Does a restroom with this restroom_gender belong in the `wanted` list? 'male' is left out of the women's list only and
 * 'female' out of the men's list only; every other value ('unisex', 'family', 'all', 'unknown', '', null, absent, any
 * unknown text) has no gender limit and is in both. 'any' takes every restroom.
 */
export function genderAllows(gender: unknown, wanted: RestroomWanted): boolean {
  if (wanted === 'male') return gender !== 'female';
  if (wanted === 'female') return gender !== 'male';
  return true;
}

/** A restroom node for `wanted`, wheelchair-usable (wheelchair: 'yes') when asked. Only node_type 'restroom' is a restroom. */
export function isRestroomMatch(node: NodeFeature, opts: { gender: RestroomWanted; wheelchair: boolean }): boolean {
  const p = node.properties;
  if (p.node_type !== 'restroom') return false;
  if (opts.wheelchair && p.wheelchair !== 'yes') return false;
  return genderAllows(p.restroom_gender, opts.gender);
}

export type NearestRestroomResult = (PointRouteResult & { found: true; targetId: string }) | Extract<PointRouteResult, { found: false }>;

/**
 * 가장 가까운 화장실 from `from`. gender 'any' is core's findNearestRestroomFrom as before. A gender tries every matching
 * restroom with findRouteBetween (the wheelchair profile when asked, else shortest) and keeps the cheapest; a tie goes
 * to the smaller node id, so the answer never depends on the map's order. No match: no-route with NO_MATCH_MESSAGE.
 */
export function findNearestRestroomFor(
  graph: CampusGraph,
  from: RouteEnd,
  opts: { gender: RestroomWanted; wheelchair: boolean },
): NearestRestroomResult {
  if (opts.gender === 'any') return findNearestRestroomFrom(graph, from, opts.wheelchair ? 'wheelchair' : 'any') as NearestRestroomResult;
  const profile: Profile = opts.wheelchair ? 'wheelchair' : 'shortest';
  const ids = [...graph.nodes].filter(([id, n]) => !graph.closed.has(id) && isRestroomMatch(n, opts)).map(([id]) => id).sort();
  if (ids.length === 0) return { found: false, profile, reason: 'no-route', message: NO_MATCH_MESSAGE };
  let best: { id: string; result: Extract<PointRouteResult, { found: true }> } | null = null;
  let firstMiss: Extract<PointRouteResult, { found: false }> | null = null;
  for (const id of ids) {
    const r = findRouteBetween(graph, from, { nodeId: id }, profile);
    if (!r.found) {
      firstMiss ??= r;
      continue;
    }
    // ids are sorted, so a strict < keeps the smaller id on a tie.
    if (!best || r.cost < best.result.cost) best = { id, result: r };
  }
  if (!best) return firstMiss!;
  return { ...best.result, targetId: best.id };
}

/** 가장 가까운 화장실 / 가장 가까운 남자 화장실 / 휠체어로 갈 수 있는 가장 가까운 여자 화장실 … */
export function nearestLabel(gender: RestroomWanted, wheelchair: boolean): string {
  const word = gender === 'male' ? '남자 화장실' : gender === 'female' ? '여자 화장실' : '화장실';
  return `${wheelchair ? '휠체어로 갈 수 있는 ' : ''}가장 가까운 ${word}`;
}

/** The result card's title. */
export function nearestTitle(gender: RestroomWanted, wheelchair: boolean): string {
  const word = gender === 'male' ? '남자 ' : gender === 'female' ? '여자 ' : '';
  return wheelchair ? `가장 가까운 휠체어 ${word}화장실 (휠체어 경로)` : `가장 가까운 ${word}화장실`;
}
