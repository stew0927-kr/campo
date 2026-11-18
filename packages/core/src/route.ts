// Route search (SPEC-v0.2 3.3-3.5). Follows graph links only: no floor numbers here.
import { aStar, type PathFinder } from 'ngraph.path';
import type { Graph, Link, Node, NodeId } from 'ngraph.graph';
import { gradeClass, isEscalator, isProfile, isStepFreePassable, isStepFreeUnknown, perProfile, type GradeClass, type Profile } from './costs.ts';
import { straight, type CampusGraph, type GraphLinkData, type GraphNodeData, type PlazaCrossing } from './graph.ts';
import { buildSteps, type Leg, type RouteStep } from './route-text.ts';
import { computeStepBearings, type LngLat } from './route/bearing.ts';
import type { EdgeFeature, NodeFeature } from './types.ts';

/** An edge on the route whose step_free is not known yet (step_free requests only). */
export interface UncertainSegment {
  edgeId: string;
  /** Campus node ids in travel direction. */
  from: string;
  to: string;
}

/** A walked edge on the route whose known grade is not gentle (costs.ts gradeClass), every profile. */
export interface SlopeSegment {
  edgeId: string;
  /** Campus node ids in travel direction. */
  from: string;
  to: string;
  /** Percent in travel direction (positive = uphill), one decimal. */
  gradePct: number;
  gradeClass: Exclude<GradeClass, 'gentle'>;
}

/** step_free found nothing, so this is the fewest_steps route (SPEC-v0.2 3.4). */
export interface RouteFallback {
  profile: 'fewest_steps';
  /** Steps edges without conveying on the route: the stairs that cannot be avoided. */
  stairsCount: number;
  /** Escalators (steps edges with conveying) on the route, counted apart from stairsCount. */
  escalatorCount: number;
  /** Other edges marked step_free: false (a step or a sill) on the route. */
  barrierCount: number;
  /** Korean, e.g. "… 계단 1곳을 피할 수 없습니다." / "… 계단 1곳, 에스컬레이터 1곳을 피할 수 없습니다." */
  message: string;
}

export interface Route {
  found: true;
  /** The profile that was asked for (see fallback for the one actually used). */
  profile: Profile;
  /** Campus node ids from start to end (elevator cars collapsed into their stops). */
  nodes: string[];
  /** Campus edge ids walked or ridden, in order. */
  edgeIds: string[];
  /** Search cost in seconds: timeSec plus the profile's preference penalties. */
  cost: number;
  /** Expected travel time in seconds. Never includes penalties. */
  timeSec: number;
  /** Walked distance in metres (elevator rides add none). */
  distanceM: number;
  /** Steps edges on the route (indoor floors and outdoor flights), escalators not included. */
  stairsCount: number;
  /** Escalators (steps edges with conveying) on the route. */
  escalatorCount: number;
  steps: RouteStep[];
  uncertainSegments: UncertainSegment[];
  /** Caution and steep slopes on the route, in order. Empty when no edge on it has a grade. */
  slopeSegments: SlopeSegment[];
  fallback: RouteFallback | null;
  /**
   * Only when the route crosses a plaza (평지) between two of its nodes (길 A → 평지 → 길 B), in order. Its walk is in
   * distanceM, timeSec and cost; the crossing's fromNodeId / toNodeId are consecutive in `nodes`.
   */
  viaPlazas?: PlazaCrossing[];
}

export type NoRoute =
  | { found: false; profile: Profile; reason: 'unknown-node' | 'no-route'; message: string }
  /** `profile` is the value that was passed in. */
  | { found: false; profile: string; reason: 'unknown-profile'; message: string };

export type RouteResult = Route | NoRoute;

export interface NearestRoute extends Route {
  /** The matching node the route ends at. */
  targetId: string;
}

export type NearestResult = NearestRoute | NoRoute;

/** Receives every campus node (never a graph-only car or sink). */
export type NodePredicate = (node: NodeFeature) => boolean;

type Path = Node<GraphNodeData>[];

const finders = new WeakMap<CampusGraph, Map<Profile, PathFinder<GraphNodeData>>>();

function finderFor(g: CampusGraph, profile: Profile): PathFinder<GraphNodeData> {
  let byProfile = finders.get(g);
  if (!byProfile) finders.set(g, (byProfile = new Map()));
  let finder = byProfile.get(profile);
  if (!finder) {
    finder = aStar<GraphNodeData, GraphLinkData>(g.graph, {
      oriented: true,
      ...searchRules(profile),
      heuristic: (a, b) => straight(a.data.position, b.data.position) / g.heuristicSpeedMps,
    });
    byProfile.set(profile, finder);
  }
  return finder;
}

/**
 * Cost and blocking come from the link alone. Every link is directed (one link
 * per direction, built from the edge's from / to), so the (a, b) arguments,
 * which ngraph's aStar passes as (next, current), are not needed (R14).
 */
function searchRules(profile: Profile) {
  return {
    distance: (_a: Node<GraphNodeData>, _b: Node<GraphNodeData>, link: Link<GraphLinkData>) => link.data.cost[profile],
    blocked: (_a: Node<GraphNodeData>, _b: Node<GraphNodeData>, link: Link<GraphLinkData>) => link.data.blocked[profile],
  };
}

/**
 * The one place an ngraph result is read. aStar returns target → source; when
 * the target was only touched through blocked links it returns [target] alone
 * (SPEC-v0.2 3.3, R13), so anything that does not start at `fromId` is no path.
 */
function pathFrom(raw: readonly Node<GraphNodeData>[], fromId: string): Path | null {
  const path = [...raw].reverse();
  return path.length > 0 && path[0]!.id === fromId ? path : null;
}

export function findRoute(g: CampusGraph, fromId: string, toId: string, profile: Profile): RouteResult {
  const rejected = checkProfile(profile) ?? checkNode(g, fromId, profile) ?? checkNode(g, toId, profile);
  if (rejected) return rejected;
  return solve(g, profile, (p) => pathFrom(finderFor(g, p).find(fromId, toId), fromId), () => ({
    found: false, profile, reason: 'no-route', message: `"${label(g, fromId)}"에서 "${label(g, toId)}"까지 가는 ${kindWord(profile)}가 없습니다.`,
  }));
}

/**
 * The cheapest route from `fromId` to any node matching `predicate`
 * (SPEC-v0.2 3.5). Every match gets a 0-cost link to a virtual `~sink` and one
 * search with heuristic 0 (Dijkstra) runs to it. The sink lives in an overlay
 * view of the graph, so the shared CampusGraph is never changed. Nodes closed
 * by an override are not targets.
 */
export function findNearest(g: CampusGraph, fromId: string, predicate: NodePredicate, profile: Profile): NearestResult {
  const rejected = checkProfile(profile) ?? checkNode(g, fromId, profile);
  if (rejected) return rejected;
  const targets = new Set<string>();
  for (const [id, node] of g.nodes) if (!g.closed.has(id) && predicate(node)) targets.add(id);
  const noRoute = (): NoRoute => ({
    found: false, profile, reason: 'no-route',
    message: targets.size === 0
      ? '조건에 맞는 곳이 없습니다.'
      : `"${label(g, fromId)}"에서 조건에 맞는 곳까지 가는 ${kindWord(profile)}가 없습니다.`,
  });
  if (targets.size === 0) return noRoute();

  const view = withSink(g.graph, targets);
  const result = solve(g, profile, (p) => {
    const finder = aStar<GraphNodeData, GraphLinkData>(view, { oriented: true, ...searchRules(p), heuristic: () => 0 });
    return pathFrom(finder.find(fromId, SINK), fromId)?.slice(0, -1) ?? null;
  }, noRoute);
  return result.found ? { ...result, targetId: result.nodes[result.nodes.length - 1]! } : result;
}

/** The requested profile, then for step_free the fewest_steps fallback (SPEC-v0.2 3.4, R15). */
function solve(g: CampusGraph, profile: Profile, search: (p: Profile) => Path | null, noRoute: () => NoRoute): RouteResult {
  const path = search(profile);
  if (path) return toRoute(g, path, profile, profile);
  if (profile === 'step_free') {
    const fallback = search('fewest_steps');
    if (fallback) return toRoute(g, fallback, profile, 'fewest_steps');
  }
  return noRoute();
}

function toRoute(g: CampusGraph, path: Path, requested: Profile, used: Profile): Route {
  const nodes: string[] = [];
  const edgeIds: string[] = [];
  const legs: Leg[] = [];
  const uncertainSegments: UncertainSegment[] = [];
  const slopeSegments: SlopeSegment[] = [];
  let cost = 0;
  let timeSec = 0;
  let distanceM = 0;
  let stairsCount = 0;
  let escalatorCount = 0;
  let barrierCount = 0;

  for (const node of path) {
    if (nodes[nodes.length - 1] !== node.data.nodeId) nodes.push(node.data.nodeId);
  }
  const viaPlazas: PlazaCrossing[] = [];
  /** An edge walked (`share` of it, a plaza crossing walks parts of edges) or ridden, from → to in travel direction. */
  const onEdge = (edge: EdgeFeature, from: string, to: string, gradePct: number | null, walked: boolean) => {
    edgeIds.push(edge.id);
    const p = edge.properties;
    if (walked) {
      const cls = gradePct === null ? 'gentle' : gradeClass(gradePct);
      if (gradePct !== null && cls !== 'gentle') {
        slopeSegments.push({ edgeId: edge.id, from, to, gradePct: round1(gradePct), gradeClass: cls });
      }
    }
    if (isEscalator(p)) escalatorCount++;
    else if (p.highway === 'steps') stairsCount++;
    else if (!isStepFreePassable(p)) barrierCount++;
    if ((requested === 'step_free' || requested === 'wheelchair') && isStepFreeUnknown(p)) {
      uncertainSegments.push({ edgeId: edge.id, from, to });
    }
  };
  for (let i = 0; i + 1 < path.length; i++) {
    const from = path[i]!;
    const to = path[i + 1]!;
    const data = linkUsed(g, from.id, to.id, used).data;
    const leg: Leg = { data, from: from.data.nodeId, to: to.data.nodeId };
    legs.push(leg);
    cost += data.cost[used];
    timeSec += data.timeSec;
    if (data.kind === 'plaza') {
      distanceM += data.lengthM;
      viaPlazas.push(data.crossing());
      for (const w of data.partials) if (w.share > 0) onEdge(w.edge, w.from, w.to, w.gradePct, true);
      continue;
    }
    if (data.kind !== 'walk' && data.kind !== 'hop') continue;
    if (data.kind === 'walk') distanceM += data.lengthM;
    onEdge(data.edge, leg.from, leg.to, data.kind === 'walk' ? data.gradePct : null, data.kind === 'walk');
  }

  return {
    found: true,
    profile: requested,
    nodes,
    edgeIds,
    cost: round1(cost),
    timeSec: round1(timeSec),
    distanceM: round1(distanceM),
    stairsCount,
    escalatorCount,
    steps: withBearings(g, buildSteps(g, legs), nodes),
    uncertainSegments,
    slopeSegments,
    fallback: used === requested ? null : fallbackInfo(stairsCount, escalatorCount, barrierCount),
    ...(viaPlazas.length > 0 ? { viaPlazas } : {}),
  };
}

/** The steps with their walking directions (route/bearing.ts), unrounded; a direction that cannot be told is left out. */
function withBearings(g: CampusGraph, steps: RouteStep[], nodes: readonly string[]): RouteStep[] {
  const line: LngLat[] = [];
  for (const id of nodes) {
    const node = g.nodes.get(id);
    if (!node) return steps;
    line.push(node.geometry.coordinates);
  }
  const bearings = computeStepBearings(steps, line);
  if (bearings.length !== steps.length + 1) return steps;
  return steps.map((step, i) => {
    const b = bearings[i]!;
    const arrive = bearings[i + 1]!.inDeg;
    return {
      ...step,
      ...(b.outDeg !== null ? { bearing_deg: b.outDeg } : {}),
      ...(b.inDeg !== null ? { bearing_in_deg: b.inDeg } : {}),
      ...(b.turnDeg !== null ? { bearing_turn_deg: b.turnDeg } : {}),
      ...(b.floorChange ? { bearing_floor_change: b.floorChange } : {}),
      ...(arrive !== null ? { bearing_arrive_deg: arrive } : {}),
    };
  });
}

function fallbackInfo(stairsCount: number, escalatorCount: number, barrierCount: number): RouteFallback {
  let message: string;
  if (stairsCount > 0 || escalatorCount > 0) {
    const lead = stairsCount > 0 ? '계단이 가장 적은 경로를' : '에스컬레이터를 타는 경로를';
    const what = [stairsCount > 0 ? `계단 ${stairsCount}곳` : '', escalatorCount > 0 ? `에스컬레이터 ${escalatorCount}곳` : '']
      .filter(Boolean).join(', ');
    message = `계단 없는 경로가 없어 ${lead} 안내합니다. ${what}을 피할 수 없습니다.`;
    if (barrierCount > 0) message += ` 턱이 있는 구간 ${barrierCount}곳도 지나야 합니다.`;
  } else {
    message = `계단 없는 경로가 없어 턱이 있는 구간을 지나는 경로를 안내합니다. 턱이 있는 구간 ${barrierCount}곳을 피할 수 없습니다.`;
  }
  return { profile: 'fewest_steps', stairsCount, escalatorCount, barrierCount, message };
}

/**
 * The link aStar took between two consecutive path nodes. Parallel links are
 * allowed (multigraph); aStar keeps the first cheapest open link it meets, and
 * this walks the same links in the same order.
 */
function linkUsed(g: CampusGraph, from: NodeId, to: NodeId, profile: Profile): Link<GraphLinkData> {
  let best: Link<GraphLinkData> | undefined;
  for (const link of g.graph.getLinks(from) ?? []) {
    if (link.fromId !== from || link.toId !== to || link.data.blocked[profile]) continue;
    if (!best || link.data.cost[profile] < best.data.cost[profile]) best = link;
  }
  if (!best) throw new Error(`no open link ${String(from)} → ${String(to)}`);
  return best;
}

// ---- findNearest's virtual target ----

const SINK = '~sink';

/**
 * A read-only view of `base` with one extra node, `~sink`, and a 0-cost link
 * from every target to it. Nothing is added to `base`. ngraph.path's aStar
 * (1.6.1, a-star.js) only calls getNode and forEachLinkedNode(id, cb, oriented
 * = true) on the graph; those are the two methods this view extends.
 */
function withSink(base: Graph<GraphNodeData, GraphLinkData>, targets: ReadonlySet<string>): Graph<GraphNodeData, GraphLinkData> {
  const sink: Node<GraphNodeData> = { id: SINK, links: null, data: { nodeId: SINK, position: [0, 0] } };
  const data: GraphLinkData = { kind: 'sink', timeSec: 0, cost: perProfile(() => 0), blocked: perProfile(() => false) };
  return {
    ...base,
    getNode: (id) => (id === SINK ? sink : base.getNode(id)),
    hasNode: (id) => (id === SINK ? sink : base.hasNode(id)),
    forEachLinkedNode: (id, callback, oriented) => {
      base.forEachLinkedNode(id, callback, oriented);
      if (typeof id === 'string' && targets.has(id)) callback(sink, { id: `${id}→${SINK}`, fromId: id, toId: SINK, data });
    },
  };
}

// ---- results that are not routes ----

function checkProfile(profile: unknown): NoRoute | null {
  if (isProfile(profile)) return null;
  const name = String(profile);
  return { found: false, profile: name, reason: 'unknown-profile', message: `알 수 없는 길찾기 방식입니다: "${name}"` };
}

function checkNode(g: CampusGraph, id: string, profile: Profile): NoRoute | null {
  if (g.nodes.has(id)) return null;
  return { found: false, profile, reason: 'unknown-node', message: `지점 "${id}"를 찾을 수 없습니다.` };
}

function label(g: CampusGraph, id: string): string {
  const p = g.nodes.get(id)!.properties;
  return p.space_name ?? p.name ?? id;
}

function kindWord(profile: Profile): string {
  if (profile === 'step_free') return '계단 없는 경로';
  if (profile === 'wheelchair') return '휠체어 경로';
  if (profile === 'elevator_first') return '엘리베이터 우선 경로';
  return '경로';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
