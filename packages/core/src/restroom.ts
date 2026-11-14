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
