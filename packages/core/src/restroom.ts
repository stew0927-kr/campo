import type { CampusGraph } from './graph.ts';
import { findNearest, type NearestResult } from './route.ts';
import type { NodeFeature, RestroomGender } from './types.ts';

/**
 * Is this node a restroom a person looking for `wanted` can use? A restroom marked 'unisex' (남·여 모두: a men's and a
 * women's restroom side by side, recorded as one point) matches a search for either. Use as a findNearest predicate.
 */
export function isRestroomFor(node: NodeFeature, wanted: 'male' | 'female'): boolean {
  if (node.properties.node_type !== 'restroom') return false;
  const g: RestroomGender | undefined = node.properties.restroom_gender;
  return g === wanted || g === 'unisex';
}

/** A restroom checked on site as usable from a wheelchair (wheelchair: 'yes'; 'unknown' and 'limited' are not). */
export function isWheelchairRestroom(node: NodeFeature): boolean {
  return node.properties.node_type === 'restroom' && node.properties.wheelchair === 'yes';
}

/**
 * 가장 가까운 화장실 from `fromId`. any: every restroom, the shortest route. wheelchair: only wheelchair restrooms,
 * by the wheelchair profile (no steps, ramps kept to a minimum, no fallback to stairs).
 */
export function findNearestRestroom(g: CampusGraph, fromId: string, kind: 'any' | 'wheelchair'): NearestResult {
  return kind === 'wheelchair'
    ? findNearest(g, fromId, isWheelchairRestroom, 'wheelchair')
    : findNearest(g, fromId, (n) => n.properties.node_type === 'restroom', 'shortest');
}
