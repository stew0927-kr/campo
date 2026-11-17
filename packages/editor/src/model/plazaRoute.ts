// 경로 테스트 with 평지 ends: the line a route draws (the walk across a plaza, then the graph route, then the walk on the
// other plaza), the dashed plaza walks, and the sentences the route card shows. Nothing here finds a route: core does.
import {
  endAtPoint, plazaAt, snapToRoutes,
  type CampusGraph, type EdgeFeature, type EditEdge, type EditState, type PlazaLeg, type PointRoute, type Position, type RouteEnd, type RouteSnap,
} from '@campo/core';
import type { RoutePoint } from '../ui/ui-state.ts';
import { edgeInScope } from './scope.ts';
import type { RouteRef } from './terrain3d.ts';

/**
 * The end a 직접 선택 point makes: outdoors a point on a plaza's solid area walks across the plaza (core endAtPoint),
 * any other point snaps to the nearest edge of its floor or the outdoors. `inHole`: the point was in a plaza's hole.
 */
export function pointEnd(g: CampusGraph, state: EditState, p: RoutePoint): { end: RouteEnd; snap: RouteSnap | null; inHole: boolean } | null {
  const accept = (e: EdgeFeature) => edgeInScope(state, { props: e.properties } as unknown as EditEdge, p.scope);
  if (p.scope.kind !== 'outdoor') {
    const snap = snapToRoutes(g, p.at, accept);
    return snap ? { end: { snap }, snap, inHole: false } : null;
  }
  const end = endAtPoint(g, p.at, accept);
  if (!end) return null;
  return { end, snap: 'snap' in end ? end.snap : null, inHole: plazaAt(g, p.at)?.hit === 'hole' };
}

export const HOLE_NOTICE = '구멍 안입니다. 평지 바깥으로 보고 가장 가까운 길에 이었습니다.';

const same = (a: Position | undefined, b: Position | undefined): boolean => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/**
 * The points a found route is drawn through: the start's plaza walk (or the foot of its perpendicular), the route's
 * nodes, the destination's plaza walk (or foot). A point equal to the one before it (the contact node where a plaza
 * walk meets the route) is drawn once. `refs` say what each point stands on (for 지형 3D).
 */
export function routeStops(
  r: Pick<PointRoute, 'nodes' | 'startFoot' | 'endFoot' | 'startPlaza' | 'endPlaza'>,
  nodeAt: (id: string) => Position | undefined,
  fromRef: RouteRef,
  toRef: RouteRef,
): { coordinates: Position[]; refs: RouteRef[] } {
  const pts: { at: Position; ref: RouteRef }[] = [];
  const add = (at: Position, ref: RouteRef) => {
    if (!same(pts[pts.length - 1]?.at, at)) pts.push({ at, ref });
  };
  if (r.startPlaza) for (const p of r.startPlaza.path) add(p, fromRef);
  else if (r.startFoot) add(r.startFoot, fromRef);
  for (const id of r.nodes) {
    const at = nodeAt(id);
    if (at) add(at, { node: id });
  }
  if (r.endPlaza) for (const p of r.endPlaza.path) add(p, toRef);
  else if (r.endFoot) add(r.endFoot, toRef);
  return { coordinates: pts.map((p) => p.at), refs: pts.map((p) => p.ref) };
}

/** The plaza walks of a route, to be drawn dashed (a walk of one point, the end of a direct route, is none). */
export function plazaWalks(r: Pick<PointRoute, 'startPlaza' | 'endPlaza'>): PlazaLeg[] {
  return [r.startPlaza, r.endPlaza].filter((l): l is PlazaLeg => l !== undefined && l.path.length >= 2);
}

/** "평지 '분수 광장'을 가로질러 접점까지 12 m (직선)", or for both ends on one plaza "평지 '분수 광장' 안에서 바로 갑니다: 12 m (직선)". */
export function plazaLegText(leg: PlazaLeg, name: string): string {
  const m = `${Math.round(leg.lengthM)} m`;
  return leg.contact.kind === 'direct' ? `평지 '${name}' 안에서 바로 갑니다: ${m} (직선)` : `평지 '${name}'을 가로질러 접점까지 ${m} (직선)`;
}

/** The sentences of a route's plaza walks, start first (the empty end of a direct route says nothing). */
export function plazaLines(r: Pick<PointRoute, 'startPlaza' | 'endPlaza'>, nameOf: (plazaId: string) => string): string[] {
  return plazaWalks(r).map((leg) => plazaLegText(leg, nameOf(leg.plazaId)));
}
