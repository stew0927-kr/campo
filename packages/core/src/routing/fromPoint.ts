// Routes that start or end at any point on the map (경로 테스트 → 직접 선택). The point is snapped to the nearest
// walkable edge by the foot of the perpendicular, and the route runs from that foot along the edge to one of its two
// ends, then through the graph as usual. Follows graph links only: no floor numbers here.
import { footOnLine, lineLength } from '../edit/geo.ts';
import type { CampusGraph, WalkLinkData } from '../graph.ts';
import { findRoute, type NearestRoute, type Route, type RouteResult, type SlopeSegment } from '../route.ts';
import { findNearestRestroom } from '../restroom.ts';
import { gradeClass, isEscalator, isStepFreeUnknown, type Profile } from '../costs.ts';
import type { EdgeFeature, Position } from '../types.ts';

/** Where a point meets the route network. */
export interface RouteSnap {
  /** The point that was picked. */
  point: Position;
  edgeId: string;
  /** Foot of the perpendicular from the point on the edge. */
  foot: Position;
  /** Metres from the point to the foot. */
  distanceM: number;
  /** Share of the edge's length from its `from` end to the foot, 0–1. */
  along: number;
}

/**
 * The nearest edge the route search walks (footway, corridor, steps, ramp: never an elevator edge, which has no
 * geometry to walk) to `point`, and the foot of the perpendicular on it. `accept` narrows the edges (the floor shown).
 */
export function snapToRoutes(g: CampusGraph, point: Position, accept: (edge: EdgeFeature) => boolean = () => true): RouteSnap | null {
  const seen = new Set<string>();
  let best: RouteSnap | null = null;
  g.graph.forEachLink((link) => {
    const data = link.data;
    if (data.kind !== 'walk' || seen.has(data.edge.id)) return;
    seen.add(data.edge.id);
    if (!accept(data.edge)) return;
    const coords = data.edge.geometry.coordinates;
    if (coords.length < 2) return;
    const foot = footOnLine(coords, point);
    if (best && foot.pointDistance >= best.distanceM) return;
    const total = lineLength(coords);
    best = { point, edgeId: data.edge.id, foot: foot.coord, distanceM: foot.pointDistance, along: total > 0 ? Math.min(1, Math.max(0, foot.totalDistance / total)) : 0 };
  });
  return best;
}

/** One end of a route: a campus node, or a snapped point. */
export type RouteEnd = { nodeId: string } | { snap: RouteSnap };

/** A route between two ends; a snapped end adds its foot and the stretch of edge to the graph route. */
export type PointRoute = Route & {
  /** Foot of the perpendicular at the start / end, when that end was a snapped point. */
  startFoot: Position | null;
  endFoot: Position | null;
};

export type PointRouteResult = PointRoute | Exclude<RouteResult, Route>;

interface Leg {
  nodeId: string;
  cost: number;
  timeSec: number;
  distanceM: number;
  /** The part of a caution / steep edge walked between the foot and the edge's end (in travel direction). */
  slope?: SlopeSegment;
}

/** The walk link from `a` to `b` over edge `edgeId`, if the edge can be walked that way. */
function walkLink(g: CampusGraph, a: string, b: string, edgeId: string): WalkLinkData | null {
  for (const link of g.graph.getLinks(a) ?? []) {
    if (String(link.fromId) === a && String(link.toId) === b && link.data.kind === 'walk' && link.data.edge.id === edgeId) return link.data;
  }
  return null;
}

/**
 * The partial walks between a snapped foot and the two ends of its edge. `leaving`: from the foot to the end (a start);
 * otherwise from the end to the foot (a destination). A share of the link's cost and time, as long as the profile may
 * use the link in that direction.
 */
function legsOf(g: CampusGraph, snap: RouteSnap, profile: Profile, leaving: boolean): Leg[] {
  let edge: EdgeFeature | undefined;
  g.graph.forEachLink((l) => {
    if (!edge && l.data.kind === 'walk' && l.data.edge.id === snap.edgeId) edge = l.data.edge;
  });
  if (!edge) return [];
  const { from, to } = edge.properties;
  const ends: [string, string, number][] = leaving
    ? [[to, from, snap.along], [from, to, 1 - snap.along]] // foot → from walks the to→from link for `along` of it
    : [[from, to, snap.along], [to, from, 1 - snap.along]]; // from → foot walks the from→to link for `along` of it
  const legs: Leg[] = [];
  ends.forEach(([a, b, share], i) => {
    const data = walkLink(g, a, b, snap.edgeId);
    if (!data || data.blocked[profile]) return;
    const cls = data.gradePct === null ? 'gentle' : gradeClass(data.gradePct);
    const slope: SlopeSegment | undefined = data.gradePct !== null && cls !== 'gentle' && share > 0
      ? { edgeId: snap.edgeId, from: a, to: b, gradePct: round1(data.gradePct), gradeClass: cls }
      : undefined;
    legs.push({ nodeId: i === 0 ? from : to, cost: data.cost[profile] * share, timeSec: data.timeSec * share, distanceM: data.lengthM * share, ...(slope ? { slope } : {}) });
  });
  return legs;
}

/**
 * The cheapest route between two ends for `profile`. A snapped end tries both ends of its edge (each a findRoute), so
 * the route may leave the foot either way. A node end is findRoute itself.
 */
export function findRouteBetween(g: CampusGraph, from: RouteEnd, to: RouteEnd, profile: Profile): PointRouteResult {
  const starts: Leg[] = 'nodeId' in from ? [{ nodeId: from.nodeId, cost: 0, timeSec: 0, distanceM: 0 }] : legsOf(g, from.snap, profile, true);
  const ends: Leg[] = 'nodeId' in to ? [{ nodeId: to.nodeId, cost: 0, timeSec: 0, distanceM: 0 }] : legsOf(g, to.snap, profile, false);
  let best: { route: Route; s: Leg; e: Leg; total: number } | null = null;
  let firstMiss: Exclude<RouteResult, Route> | null = null;
  for (const s of starts) {
    for (const e of ends) {
      const r = findRoute(g, s.nodeId, e.nodeId, profile);
      if (!r.found) {
        firstMiss ??= r;
        continue;
      }
      const total = s.cost + r.cost + e.cost;
      if (!best || total < best.total) best = { route: r, s, e, total };
    }
  }
  // Both ends on one edge: walking straight along it from foot to foot beats any detour through its end nodes.
  const direct = 'snap' in from && 'snap' in to ? directOnEdge(g, from.snap, to.snap, profile) : null;
  if (direct && (!best || direct.cost <= best.total)) return direct;
  if (!best) {
    return firstMiss ?? { found: false, profile, reason: 'no-route', message: '고른 자리 옆 구간을 이 방식으로는 지날 수 없습니다.' };
  }
  const { route, s, e, total } = best;
  return {
    ...route,
    cost: round1(total),
    timeSec: round1(route.timeSec + s.timeSec + e.timeSec),
    distanceM: round1(route.distanceM + s.distanceM + e.distanceM),
    // The stretches between the feet and the graph route count too (a point picked on a steep edge).
    slopeSegments: [...(s.slope ? [s.slope] : []), ...route.slopeSegments, ...(e.slope ? [e.slope] : [])],
    startFoot: 'snap' in from ? from.snap.foot : null,
    endFoot: 'snap' in to ? to.snap.foot : null,
  };
}

/**
 * The walk from one foot to another on the same edge, without leaving it (null when the feet are on different edges
 * or the profile may not walk the edge that way). No graph node is passed, so nodes and steps are empty.
 */
function directOnEdge(g: CampusGraph, a: RouteSnap, b: RouteSnap, profile: Profile): PointRoute | null {
  if (a.edgeId !== b.edgeId) return null;
  let edge: EdgeFeature | undefined;
  g.graph.forEachLink((l) => {
    if (!edge && l.data.kind === 'walk' && l.data.edge.id === a.edgeId) edge = l.data.edge;
  });
  if (!edge) return null;
  const forward = b.along >= a.along;
  const [u, v] = forward ? [edge.properties.from, edge.properties.to] : [edge.properties.to, edge.properties.from];
  const data = walkLink(g, u, v, a.edgeId);
  if (!data || data.blocked[profile]) return null;
  const share = Math.abs(b.along - a.along);
  const p = edge.properties;
  const cls = data.gradePct === null ? 'gentle' : gradeClass(data.gradePct);
  const slopeSegments: SlopeSegment[] = data.gradePct !== null && cls !== 'gentle' && share > 0
    ? [{ edgeId: a.edgeId, from: u, to: v, gradePct: round1(data.gradePct), gradeClass: cls }]
    : [];
  const moving = share > 0;
  return {
    found: true,
    profile,
    nodes: [],
    edgeIds: moving ? [a.edgeId] : [],
    cost: round1(data.cost[profile] * share),
    timeSec: round1(data.timeSec * share),
    distanceM: round1(data.lengthM * share),
    stairsCount: moving && !isEscalator(p) && p.highway === 'steps' ? 1 : 0,
    escalatorCount: moving && isEscalator(p) ? 1 : 0,
    steps: [],
    uncertainSegments: moving && (profile === 'step_free' || profile === 'wheelchair') && isStepFreeUnknown(p) ? [{ edgeId: a.edgeId, from: u, to: v }] : [],
    slopeSegments,
    fallback: null,
    startFoot: a.foot,
    endFoot: b.foot,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 가장 가까운 화장실 from an end that may be a snapped point (findNearestRestroom from each end of its edge). */
export function findNearestRestroomFrom(g: CampusGraph, from: RouteEnd, kind: 'any' | 'wheelchair'): (PointRoute & { targetId: string }) | Exclude<RouteResult, Route> {
  const profile: Profile = kind === 'wheelchair' ? 'wheelchair' : 'shortest';
  const starts: Leg[] = 'nodeId' in from ? [{ nodeId: from.nodeId, cost: 0, timeSec: 0, distanceM: 0 }] : legsOf(g, from.snap, profile, true);
  let best: { route: NearestRoute; s: Leg; total: number } | null = null;
  let firstMiss: Exclude<RouteResult, Route> | null = null;
  for (const s of starts) {
    const r = findNearestRestroom(g, s.nodeId, kind);
    if (!r.found) {
      firstMiss ??= r;
      continue;
    }
    const total = s.cost + r.cost;
    if (!best || total < best.total) best = { route: r, s, total };
  }
  if (!best) return firstMiss ?? { found: false, profile, reason: 'no-route', message: '고른 자리 옆 구간을 이 방식으로는 지날 수 없습니다.' };
  const { route, s, total } = best;
  return {
    ...route,
    cost: round1(total),
    timeSec: round1(route.timeSec + s.timeSec),
    distanceM: round1(route.distanceM + s.distanceM),
    slopeSegments: [...(s.slope ? [s.slope] : []), ...route.slopeSegments],
    startFoot: 'snap' in from ? from.snap.foot : null,
    endFoot: null,
  };
}
