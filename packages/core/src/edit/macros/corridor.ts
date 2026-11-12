// Finding corridors for the macros: the corridor edges of one scope, the foot of a door on the nearest one,
// and a chain of corridor edges read as one line (SPEC-v0.2 6.1, 6.2, 6.4). Only corridors: steps are never split.
import type { Position } from '../../types.ts';
import { splitPlan } from '../actions/splitEdgeAt.ts';
import { footOnLine } from '../geo.ts';
import { copy, edgeCoords, scopeOfNode, sortedValues, type EditEdge, type EditState, type Scope } from '../state.ts';
import { lineLength, metres } from './geo.ts';
import { SNAP_VERTEX_M } from '../tolerances.ts';

/** A corridor edge inside one scope that a macro may split. */
export function isSplittableCorridor(state: EditState, edge: EditEdge, scope?: Scope): boolean {
  const p = edge.props;
  if (p.highway !== 'corridor' || p.conveying !== undefined) return false;
  if (p.edge_type !== undefined && p.edge_type !== 'indoor') return false;
  const a = state.nodes[p.from];
  const b = state.nodes[p.to];
  if (!a || !b || p.from === p.to) return false;
  const s = scopeOfNode(a);
  return s === scopeOfNode(b) && (scope === undefined || s === scope);
}

export interface CandidateOptions {
  /** Only these edge ids. */
  allowed?: ReadonlySet<string> | undefined;
  /** Leave out edges at this node (the door being attached). */
  skipNode?: string | undefined;
}

/**
 * Corridor edges of `scope` a door can attach to, in id order. Leaves out the door's own edges and stubs:
 * edges whose end is a non-corridor node with no other edge (another door's or a restroom's link).
 */
export function corridorCandidates(state: EditState, scope: Scope, opts: CandidateOptions = {}): EditEdge[] {
  const degree = new Map<string, number>();
  for (const e of Object.values(state.edges)) {
    degree.set(e.props.from, (degree.get(e.props.from) ?? 0) + 1);
    degree.set(e.props.to, (degree.get(e.props.to) ?? 0) + 1);
  }
  const stubEnd = (id: string) => degree.get(id) === 1 && state.nodes[id]?.props.node_type !== 'corridor';
  return sortedValues(state.edges).filter((e) =>
    isSplittableCorridor(state, e, scope) &&
    (opts.allowed === undefined || opts.allowed.has(e.id)) &&
    e.props.from !== opts.skipNode && e.props.to !== opts.skipNode &&
    !stubEnd(e.props.from) && !stubEnd(e.props.to));
}

export interface Nearest {
  edge: EditEdge;
  /** Foot of the perpendicular on the edge. */
  foot: Position;
  /** Metres from the point to the foot. */
  d: number;
}

/** The nearest of `edges` to `coord` within `maxDist` metres (ties: the first in the list). */
export function nearestOf(state: EditState, edges: readonly EditEdge[], coord: Position, maxDist = Infinity): Nearest | undefined {
  let best: Nearest | undefined;
  for (const edge of edges) {
    const foot = footOnLine(edgeCoords(state, edge), coord);
    if (foot.pointDistance <= maxDist && (!best || foot.pointDistance < best.d)) best = { edge, foot: foot.coord, d: foot.pointDistance };
  }
  return best;
}

export interface FootPlan {
  /** The corridor edge the door attaches to. */
  edgeId: string;
  /** Where the link ends: the reused node's coordinate, or the split point (an existing bend point within 1.0m). */
  at: Position;
  /** Metres from the door to the foot of the perpendicular. */
  pointDistance: number;
  /** An existing corridor node within 1.0m of the foot, used instead of splitting. */
  nodeId?: string;
}

/** Nearest corridor of `scope` within `maxDist` metres and where a door at `coord` joins it, or the Korean reason. */
export function findFoot(state: EditState, coord: Position, scope: Scope, maxDist: number, opts: CandidateOptions = {}): FootPlan | string {
  const candidates = corridorCandidates(state, scope, opts);
  const best = nearestOf(state, candidates, coord, maxDist);
  if (!best) return `${maxDist}m 안에 같은 층 복도 구간이 없습니다.`;

  // Reuse an existing node of the corridor network within 1.0m of the foot.
  const ends = new Set<string>();
  for (const e of candidates) ends.add(e.props.from).add(e.props.to);
  ends.delete(opts.skipNode ?? '');
  let reuse: { id: string; d: number } | undefined;
  for (const id of [...ends].sort()) {
    const d = metres(state.nodes[id]!.coord, best.foot);
    if (d <= SNAP_VERTEX_M && (!reuse || d < reuse.d)) reuse = { id, d };
  }
  if (reuse) return { edgeId: best.edge.id, at: copy(state.nodes[reuse.id]!.coord), pointDistance: best.d, nodeId: reuse.id };

  const plan = splitPlan(state, best.edge.id, best.foot);
  if (typeof plan === 'string') return plan;
  return { edgeId: best.edge.id, at: plan.at, pointDistance: best.d };
}

export interface Chain {
  /** The edges in walking order. */
  edgeIds: string[];
  /** Whether each edge is walked against its drawn direction. */
  reversed: boolean[];
  /** The whole line, start to end. */
  coords: Position[];
  /** Nodes in walking order (edges + 1). */
  nodeIds: string[];
  /** Metres along the line at each node. */
  nodeDistances: number[];
  length: number;
  scope: Scope;
  building_id: string;
  level: number;
}

/**
 * Corridor edges joined end to end into one line (a simple path, no branches or loops). It runs in the drawn
 * direction of the first edge given.
 */
export function chainOf(state: EditState, edgeIds: readonly string[]): Chain | string {
  if (edgeIds.length === 0) return '복도 구간을 하나 이상 골라 주세요.';
  if (new Set(edgeIds).size !== edgeIds.length) return '같은 복도 구간이 두 번 들어 있습니다.';
  const edges: EditEdge[] = [];
  for (const id of edgeIds) {
    const e = state.edges[id];
    if (!e) return `구간 "${id}"이(가) 없습니다.`;
    if (!isSplittableCorridor(state, e)) return `구간 "${id}"은(는) 한 층 안의 복도(corridor) 구간이 아닙니다. 매크로는 복도 구간만 나눕니다.`;
    edges.push(e);
  }
  const first = state.nodes[edges[0]!.props.from]!;
  const scope = scopeOfNode(first);
  if (first.props.building_id === null || first.props.level === null) return '건물 안 복도만 쓸 수 있습니다.';
  if (edges.some((e) => scopeOfNode(state.nodes[e.props.from]!) !== scope)) return '복도 구간이 모두 같은 건물, 같은 층에 있어야 합니다.';

  const at = new Map<string, EditEdge[]>();
  for (const e of edges) for (const n of [e.props.from, e.props.to]) at.set(n, [...(at.get(n) ?? []), e]);
  if ([...at.values()].some((list) => list.length > 2)) return '복도 구간이 갈라지지 않고 한 줄로 이어져야 합니다.';
  const ends = [...at.keys()].filter((n) => at.get(n)!.length === 1).sort();
  if (ends.length !== 2) return '복도 구간이 고리가 아닌 한 줄로 이어져야 합니다.';

  const order: string[] = [];
  const reversed: boolean[] = [];
  const nodeIds = [ends[0]!];
  let coords: Position[] = [];
  const used = new Set<string>();
  let cur = ends[0]!;
  for (;;) {
    const next = at.get(cur)!.find((e) => !used.has(e.id));
    if (!next) break;
    used.add(next.id);
    const back = next.props.to === cur;
    const line = edgeCoords(state, next);
    if (back) line.reverse();
    coords = coords.length === 0 ? line : [...coords, ...line.slice(1)];
    order.push(next.id);
    reversed.push(back);
    cur = back ? next.props.from : next.props.to;
    nodeIds.push(cur);
  }
  if (used.size !== edges.length) return '복도 구간이 한 줄로 이어져 있지 않습니다.';

  const chain = { edgeIds: order, reversed, coords, nodeIds };
  const firstAt = order.indexOf(edgeIds[0]!);
  if (reversed[firstAt]) {
    chain.edgeIds = [...order].reverse();
    chain.reversed = [...reversed].reverse().map((r) => !r);
    chain.coords = [...coords].reverse();
    chain.nodeIds = [...nodeIds].reverse();
  }
  const nodeDistances = [0];
  let walked = 0;
  for (const id of chain.edgeIds) {
    walked += lineLength(edgeCoords(state, state.edges[id]!));
    nodeDistances.push(walked);
  }
  return {
    ...chain,
    nodeDistances,
    length: walked,
    scope,
    building_id: first.props.building_id,
    level: first.props.level,
  };
}
