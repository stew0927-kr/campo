// 경로 테스트: which parts of buildings outside the shown floor stay sharp while a found route is on the map.
// Display only: routing never uses this.
import type { EditState, PointRouteResult } from '@campo/core';
import type { Scope } from './scope.ts';

export interface RouteFocus {
  /** Node and edge ids on the found routes shown. */
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  /** Buildings the route starts or ends in (outdoor places do not count). */
  targetBuildings: ReadonlySet<string>;
  /** Buildings the route only passes through: not a target and not the building being shown. */
  passBuildings: ReadonlySet<string>;
}

/**
 * The focus of the routes drawn, or null when it does not apply: not the 경로 테스트 tab, or no route was found.
 * `endBuildings`: building ids of the 출발 and 도착 ends (a place's node building, or the scope a picked point stands in).
 */
export function routeFocusOf(
  state: Pick<EditState, 'nodes'>,
  scope: Scope,
  routesOpen: boolean,
  routes: readonly PointRouteResult[],
  endBuildings: readonly (string | null | undefined)[],
): RouteFocus | null {
  if (!routesOpen) return null;
  const found = routes.filter((r): r is Extract<PointRouteResult, { found: true }> => r.found);
  if (found.length === 0) return null;
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const r of found) {
    for (const id of r.nodes) nodeIds.add(id);
    for (const id of r.edgeIds) edgeIds.add(id);
  }
  const targetBuildings = new Set<string>();
  for (const b of endBuildings) if (b) targetBuildings.add(b);
  const passBuildings = new Set<string>();
  for (const id of nodeIds) {
    const b = state.nodes[id]?.props.building_id;
    if (b && !targetBuildings.has(b) && !(scope.kind === 'building' && scope.buildingId === b)) passBuildings.add(b);
  }
  return { nodeIds, edgeIds, targetBuildings, passBuildings };
}
