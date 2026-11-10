// Route search (docs/SPEC.md §6). Follows graph links only — no floor numbers here.
import { aStar, type PathFinder } from 'ngraph.path';
import type { Link } from 'ngraph.graph';
import { ELEVATOR_FLOOR_S, ELEVATOR_WAIT_S, WALKING_SPEED_M_PER_S, type Profile } from './costs.ts';
import { straight, type CampusGraph, type GraphLinkData, type GraphNodeData } from './graph.ts';
import { describeLegs, type Leg } from './route-text.ts';

export interface Route {
  found: true;
  profile: Profile;
  /** Campus node ids from start to end. */
  nodeIds: string[];
  /** Campus edge ids walked or ridden, in order. */
  edgeIds: string[];
  /** Total routing cost (metre-equivalent, §6). */
  cost: number;
  /** Walked distance in metres (elevator rides add none). */
  distanceM: number;
  /** Walking at 1.2 m/s plus elevator waits and rides. */
  durationMin: number;
  /** Number of steps edges (indoor floors and outdoor flights). */
  stairCount: number;
  /** Human-readable Korean, e.g. "A동 1층 → 엘리베이터 → 3층". */
  floorChanges: string[];
}

export interface NoRoute {
  found: false;
  profile: Profile;
  reason: 'unknown-node' | 'no-route';
  message: string;
}

export type RouteResult = Route | NoRoute;

const finders = new WeakMap<CampusGraph, Map<Profile, PathFinder<GraphNodeData>>>();

function finderFor(g: CampusGraph, profile: Profile): PathFinder<GraphNodeData> {
  let byProfile = finders.get(g);
  if (!byProfile) finders.set(g, (byProfile = new Map()));
  let finder = byProfile.get(profile);
  if (!finder) {
    finder = aStar<GraphNodeData, GraphLinkData>(g.graph, {
      oriented: true,
      // ngraph.path passes (neighbour, current, link); the cost lives on the link, so only it is used.
      distance: (_a, _b, link) => link.data.cost[profile],
      blocked: (_a, _b, link) => link.data.cost[profile] === Infinity,
      heuristic: (a, b) => straight(a.data.position, b.data.position),
    });
    byProfile.set(profile, finder);
  }
  return finder;
}

export function findRoute(g: CampusGraph, fromId: string, toId: string, profile: Profile): RouteResult {
  for (const id of [fromId, toId]) {
    if (!g.nodes.has(id)) {
      return { found: false, profile, reason: 'unknown-node', message: `지점 "${id}"를 찾을 수 없습니다.` };
    }
  }

  const path = finderFor(g, profile).find(fromId, toId).reverse();
  // ngraph.path can return just [target] when the target was only touched through blocked links.
  if (path.length === 0 || path[0]!.id !== fromId) {
    return { found: false, profile, reason: 'no-route', message: noRouteMessage(g, fromId, toId, profile) };
  }

  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  const legs: Leg[] = [];
  let cost = 0;
  let distanceM = 0;
  let seconds = 0;
  let stairCount = 0;

  for (const node of path) {
    if (nodeIds[nodeIds.length - 1] !== node.data.nodeId) nodeIds.push(node.data.nodeId);
  }

  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const link = cheapestLink(g, String(a.id), String(b.id), profile);
    const data = link.data;
    cost += data.cost[profile];

    switch (data.kind) {
      case 'board':
        seconds += ELEVATOR_WAIT_S;
        break;
      case 'alight':
        break;
      case 'ride':
        seconds += data.floors * ELEVATOR_FLOOR_S;
        edgeIds.push(data.edge.id);
        legs.push({ edge: data.edge, from: a.data.nodeId, to: b.data.nodeId });
        break;
      case 'walk':
        distanceM += data.lengthM;
        seconds += data.lengthM / WALKING_SPEED_M_PER_S;
        if (data.edge.properties.highway === 'steps') stairCount++;
        edgeIds.push(data.edge.id);
        legs.push({ edge: data.edge, from: a.data.nodeId, to: b.data.nodeId });
        break;
    }
  }

  return {
    found: true,
    profile,
    nodeIds,
    edgeIds,
    cost: round(cost, 1),
    distanceM: round(distanceM, 1),
    durationMin: round(seconds / 60, 1),
    stairCount,
    floorChanges: describeLegs(g, legs),
  };
}

/** The link A* used between two consecutive path nodes (parallel edges are allowed). */
function cheapestLink(g: CampusGraph, a: string, b: string, profile: Profile): Link<GraphLinkData> {
  let best: Link<GraphLinkData> | undefined;
  for (const link of g.graph.getLinks(a) ?? []) {
    if (link.fromId !== a || link.toId !== b) continue;
    if (!best || link.data.cost[profile] < best.data.cost[profile]) best = link;
  }
  if (!best) throw new Error(`no link ${a} → ${b}`);
  return best;
}

function noRouteMessage(g: CampusGraph, fromId: string, toId: string, profile: Profile): string {
  const name = (id: string) => {
    const p = g.nodes.get(id)!.properties;
    return p.space_name ?? p.name ?? id;
  };
  const kind = profile === 'step_free' ? '계단 없는 경로' : '경로';
  return `"${name(fromId)}"에서 "${name(toId)}"까지 가는 ${kind}가 없습니다.`;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
