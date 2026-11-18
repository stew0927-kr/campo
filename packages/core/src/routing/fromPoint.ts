// Routes that start or end at any point on the map (경로 테스트 → 직접 선택). The point is snapped to the nearest
// walkable edge by the foot of the perpendicular, and the route runs from that foot along the edge to one of its two
// ends, then through the graph as usual. Follows graph links only: no floor numbers here.
import { footOnLine, lineLength } from '../edit/geo.ts';
import type { CampusGraph, WalkLinkData } from '../graph.ts';
import { findRoute, type NearestRoute, type Route, type RouteResult, type SlopeSegment } from '../route.ts';
import { findNearestRestroom } from '../restroom.ts';
import { WALK_SPEED_MPS, gradeClass, isEscalator, isStepFreeUnknown, type Profile } from '../costs.ts';
import type { EdgeFeature, Position } from '../types.ts';
import { linkedPlazas, plazaAt, plazaDistance, plazaGeodesics, type PlazaPoint } from './plaza.ts';

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

/** One end of a route: a campus node, a snapped point, or a point on a plaza (평지). */
export type RouteEnd = { nodeId: string } | { snap: RouteSnap } | { plaza: PlazaPoint };

/** The straight walk across a plaza between a picked point and where the plaza meets the network. */
export interface PlazaLeg {
  /** The plaza the picked point is on. */
  plazaId: string;
  /**
   * Only when the walk crosses linked plazas (touching or overlapping, SPEC-v0.2 2.8): every plaza it crosses, in walking
   * order (start: from the picked point's plaza; destination: towards it, so the picked point's plaza is last). lengthM is
   * the whole walk over all of them.
   */
  plazaIds?: string[];
  /** Start: picked point → contact. Destination: contact → picked point. Bends around holes included. */
  path: Position[];
  lengthM: number;
  /** Where the walk meets the network. 'direct': both ends on one plaza, walked straight without the network. */
  contact: { kind: 'node'; nodeId: string } | { kind: 'edge'; edgeId: string; at: Position; along: number } | { kind: 'direct' };
}

/** A route between two ends; a snapped end adds its foot and the stretch of edge to the graph route, a plaza end its walk. */
export type PointRoute = Route & {
  /** Foot of the perpendicular at the start / end, when that end was a snapped point. */
  startFoot: Position | null;
  endFoot: Position | null;
  /** Only when that end is a plaza point. */
  startPlaza?: PlazaLeg;
  endPlaza?: PlazaLeg;
};

export type PointRouteResult = PointRoute | Exclude<RouteResult, Route>;

interface Leg {
  nodeId: string;
  cost: number;
  timeSec: number;
  distanceM: number;
  /** The part of a caution / steep edge walked between the foot and the edge's end (in travel direction). */
  slope?: SlopeSegment;
  plaza?: PlazaLeg;
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

function plazaSeconds(lengthM: number): number {
  return lengthM / WALK_SPEED_MPS;
}

function withPlaza(leg: Leg, plaza: PlazaLeg): Leg {
  const t = plazaSeconds(plaza.lengthM);
  return { ...leg, cost: leg.cost + t, timeSec: leg.timeSec + t, distanceM: leg.distanceM + plaza.lengthM, plaza };
}

/**
 * The ways an end joins the graph. A node is itself; a snapped point walks to either end of its edge; a plaza point
 * walks straight across the plaza to each contact (a node, or a point on an edge that then walks to either end of it).
 * The plaza walk is flat ground: cost = time = length / WALK_SPEED_MPS for every profile.
 */
function legsOfEnd(g: CampusGraph, end: RouteEnd, profile: Profile, leaving: boolean): Leg[] {
  if ('nodeId' in end) return [{ nodeId: end.nodeId, cost: 0, timeSec: 0, distanceM: 0 }];
  if ('snap' in end) return legsOf(g, end.snap, profile, leaving);
  const out: Leg[] = [];
  for (const { contact, geodesic } of plazaGeodesics(g, end.plaza)) {
    const path = leaving ? geodesic.path : [...geodesic.path].reverse();
    const ids = leaving ? geodesic.plazaIds : [...geodesic.plazaIds].reverse();
    const across = ids.length > 1 ? { plazaIds: ids } : {};
    if (contact.kind === 'node') {
      const leg: PlazaLeg = { plazaId: end.plaza.plazaId, ...across, path, lengthM: geodesic.lengthM, contact: { kind: 'node', nodeId: contact.nodeId } };
      out.push(withPlaza({ nodeId: contact.nodeId, cost: 0, timeSec: 0, distanceM: 0 }, leg));
      continue;
    }
    const leg: PlazaLeg = {
      plazaId: end.plaza.plazaId, ...across, path, lengthM: geodesic.lengthM,
      contact: { kind: 'edge', edgeId: contact.edgeId, at: contact.at, along: contact.along },
    };
    const snap: RouteSnap = { point: contact.at, edgeId: contact.edgeId, foot: contact.at, distanceM: 0, along: contact.along };
    for (const l of legsOf(g, snap, profile, leaving)) out.push(withPlaza(l, leg));
  }
  return out;
}

function noLegs(end: RouteEnd, profile: Profile): Exclude<RouteResult, Route> {
  return 'plaza' in end
    ? { found: false, profile, reason: 'no-route', message: '이 평지는 길과 닿는 곳이 없어 길을 찾을 수 없습니다.' }
    : { found: false, profile, reason: 'no-route', message: '고른 자리 옆 구간을 이 방식으로는 지날 수 없습니다.' };
}

function footOf(end: RouteEnd): Position | null {
  return 'snap' in end ? end.snap.foot : null;
}

/** The same plaza, or linked plazas, at both ends: the straight walk inside them, without the network. */
function directRoute(g: CampusGraph, from: { plaza: PlazaPoint }, to: { plaza: PlazaPoint }, profile: Profile): PointRoute | null {
  const d = plazaDistance(g, from.plaza.plazaId, from.plaza.point, to.plaza.point, to.plaza.plazaId);
  if (!d) return null;
  const t = round1(plazaSeconds(d.lengthM));
  const plazaId = from.plaza.plazaId;
  const across = d.plazaIds.length > 1 ? { plazaIds: d.plazaIds } : {};
  return {
    found: true, profile, nodes: [], edgeIds: [], cost: t, timeSec: t, distanceM: round1(d.lengthM),
    stairsCount: 0, escalatorCount: 0, steps: [], uncertainSegments: [], slopeSegments: [], fallback: null,
    startFoot: null, endFoot: null,
    startPlaza: { plazaId, ...across, path: d.path, lengthM: d.lengthM, contact: { kind: 'direct' } },
    endPlaza: { plazaId: to.plaza.plazaId, path: [d.path[d.path.length - 1]!], lengthM: 0, contact: { kind: 'direct' } },
  };
}

/**
 * The cheapest route between two ends for `profile`. A snapped end tries both ends of its edge (each a findRoute), so
 * the route may leave the foot either way; a plaza end tries every contact. A node end is findRoute itself. Both ends
 * on one plaza also try the straight walk inside it, and the cheaper one wins.
 */
export function findRouteBetween(g: CampusGraph, from: RouteEnd, to: RouteEnd, profile: Profile): PointRouteResult {
  const starts = legsOfEnd(g, from, profile, true);
  const ends = legsOfEnd(g, to, profile, false);
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
  const onEdge = 'snap' in from && 'snap' in to ? directOnEdge(g, from.snap, to.snap, profile) : null;
  // Both ends on one plaza, or on linked plazas: the straight walk inside them, around their holes.
  const onPlaza =
    'plaza' in from && 'plaza' in to && linkedPlazas(g, from.plaza.plazaId).includes(to.plaza.plazaId) ? directRoute(g, from, to, profile) : null;
  const direct = onEdge && onPlaza ? (onPlaza.cost < onEdge.cost ? onPlaza : onEdge) : (onEdge ?? onPlaza);
  if (direct && (!best || direct.cost <= round1(best.total))) return direct;
  if (!best) {
    return firstMiss ?? (starts.length === 0 ? noLegs(from, profile) : noLegs(to, profile));
  }
  const { route, s, e, total } = best;
  return {
    ...route,
    cost: round1(total),
    timeSec: round1(route.timeSec + s.timeSec + e.timeSec),
    distanceM: round1(route.distanceM + s.distanceM + e.distanceM),
    // The stretches between the feet and the graph route count too (a point picked on a steep edge).
    slopeSegments: [...(s.slope ? [s.slope] : []), ...route.slopeSegments, ...(e.slope ? [e.slope] : [])],
    startFoot: footOf(from),
    endFoot: footOf(to),
    ...(s.plaza ? { startPlaza: s.plaza } : {}),
    ...(e.plaza ? { endPlaza: e.plaza } : {}),
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

/** 가장 가까운 화장실 from an end that may be a snapped point or a plaza point (findNearestRestroom from each way in). */
export function findNearestRestroomFrom(g: CampusGraph, from: RouteEnd, kind: 'any' | 'wheelchair'): (PointRoute & { targetId: string }) | Exclude<RouteResult, Route> {
  const profile: Profile = kind === 'wheelchair' ? 'wheelchair' : 'shortest';
  const starts = legsOfEnd(g, from, profile, true);
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
  if (!best) return firstMiss ?? noLegs(from, profile);
  const { route, s, total } = best;
  return {
    ...route,
    cost: round1(total),
    timeSec: round1(route.timeSec + s.timeSec),
    distanceM: round1(route.distanceM + s.distanceM),
    slopeSegments: [...(s.slope ? [s.slope] : []), ...route.slopeSegments],
    startFoot: footOf(from),
    endFoot: null,
    ...(s.plaza ? { startPlaza: s.plaza } : {}),
  };
}

/**
 * The end a picked point makes: a point in a plaza's solid area is a plaza end, any other point (a plaza hole too) snaps
 * to the nearest walkable edge, and null when there is none. plazaAt tells a caller the point was in a hole.
 */
export function endAtPoint(g: CampusGraph, point: Position, accept?: (e: EdgeFeature) => boolean): RouteEnd | null {
  const on = plazaAt(g, point);
  if (on?.hit === 'solid') return { plaza: { plazaId: on.plaza.id, point: [point[0], point[1]] } };
  const snap = snapToRoutes(g, point, accept);
  return snap ? { snap } : null;
}

/** A route through every end in order (stops in between): one findRouteBetween per pair, joined. The first miss is returned. */
export function findRouteThrough(g: CampusGraph, ends: RouteEnd[], profile: Profile): PointRouteResult {
  if (ends.length < 2) return { found: false, profile, reason: 'no-route', message: '출발과 도착을 모두 골라 주세요.' };
  const parts: PointRoute[] = [];
  for (let i = 0; i + 1 < ends.length; i++) {
    const r = findRouteBetween(g, ends[i]!, ends[i + 1]!, profile);
    if (!r.found) return r;
    parts.push(r);
  }
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (parts.length === 1) return first;
  const nodes: string[] = [];
  for (const p of parts) for (const n of p.nodes) if (nodes[nodes.length - 1] !== n) nodes.push(n);
  const sum = (f: (p: PointRoute) => number) => round1(parts.reduce((s, p) => s + f(p), 0));
  return {
    found: true,
    profile,
    nodes,
    edgeIds: parts.flatMap((p) => p.edgeIds),
    cost: sum((p) => p.cost),
    timeSec: sum((p) => p.timeSec),
    distanceM: sum((p) => p.distanceM),
    stairsCount: parts.reduce((s, p) => s + p.stairsCount, 0),
    escalatorCount: parts.reduce((s, p) => s + p.escalatorCount, 0),
    steps: parts.flatMap((p) => p.steps),
    uncertainSegments: parts.flatMap((p) => p.uncertainSegments),
    slopeSegments: parts.flatMap((p) => p.slopeSegments),
    fallback: parts.find((p) => p.fallback !== null)?.fallback ?? null,
    startFoot: first.startFoot,
    endFoot: last.endFoot,
    ...(first.startPlaza ? { startPlaza: first.startPlaza } : {}),
    ...(last.endPlaza ? { endPlaza: last.endPlaza } : {}),
  };
}
