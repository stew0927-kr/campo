// "끊긴 지점 찾기": points a route can never use, found in the edit state as it is now.
//   isolated  a point with no edge at all
//   island    a group of joined points that is not joined to the main network (the largest group)
//   near      a point within NEAR_M of another point or way of its own floor (or of the outdoors) that it is neither
//             joined to directly nor reaches by a short walk: the two were drawn side by side and never joined
// Reading only; the one fix offered ("가까운 길에 자동 연결") is a Plan of core actions. Floors are told apart by scope
// (building + level) only to decide what lies side by side; nothing here compares floor numbers.
import { addedKeys, edgeCoords, scopeOfNode, splitEdgeAt, type EditContext, type EditEdge, type EditNode, type EditState, type Position } from '@campo/core';
import type { PlanResult, Step } from './plan.ts';
import { nodeInScope, type Scope } from './scope.ts';
import { planConnect } from './tools.ts';

/** A point this close to another point or way of its floor, with no way between them nearby, is reported. */
export const NEAR_M = 1.5;
/** "Nearby": the two count as joined when a walk of at most this many metres leads from one to the other. */
export const LOCAL_WALK_M = 10;

export type BrokenKind = 'isolated' | 'island' | 'near';

/** The closest point or way the node is not joined to. */
export interface NearTarget {
  kind: 'node' | 'edge';
  id: string;
  /** Metres between the node and the target. */
  dist: number;
}

export interface BrokenItem {
  kind: BrokenKind;
  /** The point to show and select (an island: its first point by id). */
  nodeId: string;
  /** Every point of the item (an island has several). */
  nodeIds: string[];
  /** Set when a way or point of the same floor is within NEAR_M: "가까운 길에 자동 연결" joins `nearFrom` to it. */
  near?: NearTarget;
  nearFrom?: string;
  /** Korean, polite form. */
  message: string;
}

const M_PER_DEG = 111_320;

/** Flat metres around the first point looked at: a campus is small enough for centimetre accuracy. */
function flat(origin: Position) {
  const kx = M_PER_DEG * Math.cos((origin[1] * Math.PI) / 180);
  return (p: Position): [number, number] => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * M_PER_DEG];
}

function toSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

interface Net {
  xy: Map<string, [number, number]>;
  /** Every edge at a node, with its length. */
  links: Map<string, { to: string; len: number }[]>;
  /** Nodes and same-scope edges by scope. */
  scopes: Map<string, { nodes: EditNode[]; edges: { edge: EditEdge; line: [number, number][] }[] }>;
}

function network(state: EditState): Net {
  const nodes = Object.values(state.nodes);
  const project = flat(nodes[0]?.coord ?? [0, 0]);
  const xy = new Map(nodes.map((n) => [n.id, project(n.coord)]));
  const links = new Map<string, { to: string; len: number }[]>(nodes.map((n) => [n.id, []]));
  const scopes: Net['scopes'] = new Map();
  const bucket = (key: string) => {
    let b = scopes.get(key);
    if (!b) scopes.set(key, (b = { nodes: [], edges: [] }));
    return b;
  };
  for (const n of nodes) bucket(scopeOfNode(n)).nodes.push(n);
  for (const e of Object.values(state.edges)) {
    const [a, b] = [state.nodes[e.props.from], state.nodes[e.props.to]];
    if (!a || !b) continue;
    const [pa, pb] = [xy.get(a.id)!, xy.get(b.id)!];
    const len = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    links.get(a.id)!.push({ to: b.id, len });
    links.get(b.id)!.push({ to: a.id, len });
    if (scopeOfNode(a) === scopeOfNode(b)) bucket(scopeOfNode(a)).edges.push({ edge: e, line: edgeCoords(state, e).map(project) });
  }
  return { xy, links, scopes };
}

/** Points `start` counts as joined to: its direct neighbours, and whatever a walk of at most LOCAL_WALK_M reaches. */
function nearbyReach(net: Net, start: string): Set<string> {
  const best = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = best.get(id)!;
    for (const { to, len } of net.links.get(id) ?? []) {
      const next = d + len;
      if (next > LOCAL_WALK_M || next >= (best.get(to) ?? Infinity)) continue;
      best.set(to, next);
      queue.push(to);
    }
  }
  // A long edge still joins its two ends (an elevator stop 18m down the hall from the corridor point it hangs on).
  return new Set([...best.keys(), ...(net.links.get(start) ?? []).map((l) => l.to)]);
}

/** The closest point or way of the node's own scope within NEAR_M that it cannot reach nearby. */
function nearOf(net: Net, node: EditNode): NearTarget | undefined {
  const scope = net.scopes.get(scopeOfNode(node));
  if (!scope) return undefined;
  const p = net.xy.get(node.id)!;
  const found: NearTarget[] = [];
  for (const m of scope.nodes) {
    if (m.id === node.id) continue;
    const q = net.xy.get(m.id)!;
    const dist = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (dist <= NEAR_M) found.push({ kind: 'node', id: m.id, dist });
  }
  for (const { edge, line } of scope.edges) {
    if (edge.props.from === node.id || edge.props.to === node.id) continue;
    let dist = Infinity;
    for (let i = 0; i + 1 < line.length; i++) dist = Math.min(dist, toSegment(p, line[i]!, line[i + 1]!));
    if (dist <= NEAR_M) found.push({ kind: 'edge', id: edge.id, dist });
  }
  if (found.length === 0) return undefined;
  const reach = nearbyReach(net, node.id);
  const ends = new Map(scope.edges.map(({ edge }) => [edge.id, [edge.props.from, edge.props.to]]));
  return found
    .filter((t) => (t.kind === 'node' ? !reach.has(t.id) : !ends.get(t.id)!.some((id) => reach.has(id))))
    // The nearest; a point before a way at the same distance (the way's end is that point).
    .sort((a, b) => a.dist - b.dist || (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === 'node' ? -1 : 1))[0];
}

const metresText = (m: number) => `${m.toFixed(1)}m`;

/** Every broken point of the campus, in id order of the point shown. */
export function findBroken(state: EditState): BrokenItem[] {
  const net = network(state);
  // Groups of joined points; the largest is the main network.
  const group = new Map<string, number>();
  const groups: string[][] = [];
  for (const id of Object.keys(state.nodes).sort()) {
    if (group.has(id)) continue;
    const members: string[] = [];
    const stack = [id];
    group.set(id, groups.length);
    while (stack.length > 0) {
      const at = stack.pop()!;
      members.push(at);
      for (const { to } of net.links.get(at)!) {
        if (group.has(to)) continue;
        group.set(to, groups.length);
        stack.push(to);
      }
    }
    groups.push(members.sort());
  }
  const main = groups.reduce((best, g, i) => (g.length > groups[best]!.length ? i : best), 0);

  const items: BrokenItem[] = [];
  groups.forEach((members, i) => {
    const nears = members.flatMap((id) => {
      const near = nearOf(net, state.nodes[id]!);
      return near ? [{ id, near }] : [];
    });
    if (members.length === 1 && net.links.get(members[0]!)!.length === 0) {
      const near = nears[0]?.near;
      items.push({
        kind: 'isolated', nodeId: members[0]!, nodeIds: members,
        ...(near ? { near, nearFrom: members[0]! } : {}),
        message: near ? `어떤 구간에도 이어지지 않은 지점입니다. ${metresText(near.dist)} 옆에 길이 있습니다.` : '어떤 구간에도 이어지지 않은 지점입니다.',
      });
    } else if (i !== main) {
      const closest = [...nears].sort((a, b) => a.near.dist - b.near.dist)[0];
      items.push({
        kind: 'island', nodeId: members[0]!, nodeIds: members,
        ...(closest ? { near: closest.near, nearFrom: closest.id } : {}),
        message: `지점 ${members.length}개가 서로만 이어져 있고 다른 길과 끊겨 있습니다.${closest ? ` ${metresText(closest.near.dist)} 옆에 다른 길이 있습니다.` : ''}`,
      });
    } else {
      for (const { id, near } of nears) {
        items.push({
          kind: 'near', nodeId: id, nodeIds: [id], near, nearFrom: id,
          message: `${metresText(near.dist)} 옆에 ${near.kind === 'node' ? '다른 지점' : '다른 길'}이 있는데 이어져 있지 않습니다.`,
        });
      }
    }
  });
  return items.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
}

/** Ids of every point of the items, for the rings on the map. */
export function brokenIds(items: readonly BrokenItem[]): Set<string> {
  return new Set(items.flatMap((i) => i.nodeIds));
}

/** How many broken points `scope` has. */
export function brokenCountIn(state: EditState, ids: ReadonlySet<string>, scope: Scope): number {
  let n = 0;
  for (const id of ids) if (state.nodes[id] && nodeInScope(state.nodes[id]!, scope)) n++;
  return n;
}

/** Broken points of one building by level, for the floor picker. */
export function brokenByLevel(state: EditState, ids: ReadonlySet<string>, buildingId: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const id of ids) {
    const p = state.nodes[id]?.props;
    if (p && p.building_id === buildingId && p.level !== null) out.set(p.level, (out.get(p.level) ?? 0) + 1);
  }
  return out;
}

/** The item after `current` in the list (the first when there is none or it is the last): the 다음 button. */
export function nextBroken(items: readonly BrokenItem[], current: string | null): BrokenItem | undefined {
  if (items.length === 0) return undefined;
  const at = items.findIndex((i) => i.nodeId === current || (current !== null && i.nodeIds.includes(current)));
  return items[(at + 1) % items.length];
}

/**
 * "가까운 길에 자동 연결": join the item's point to the point or way beside it. A way is cut at the spot nearest to the
 * point and a short edge joins the two; where the way cannot be cut (too close to an end, a kind that is never cut) the
 * edge goes to its nearer end. One Plan, one Ctrl+Z.
 */
export function planConnectNear(state: EditState, ctx: EditContext, item: Pick<BrokenItem, 'near' | 'nearFrom'>): PlanResult {
  const { near, nearFrom } = item;
  const node = nearFrom ? state.nodes[nearFrom] : undefined;
  if (!near || !node) return { error: '가까이에 이을 길이 없습니다.' };
  const named = (plan: PlanResult): PlanResult => ('error' in plan ? plan : { ...plan, annotation: '가까운 길에 연결' });
  if (near.kind === 'node') return named(planConnect(state, ctx, node.id, near.id));
  const edge = state.edges[near.id];
  if (!edge) return { error: '가까이에 이을 길이 없습니다.' };
  const split = splitEdgeAt(edge.id, node.coord, {}, ctx);
  if (split.disabled(state) !== false) {
    const net = network(state);
    const p = net.xy.get(node.id)!;
    const end = [edge.props.from, edge.props.to].sort((a, b) => {
      const [qa, qb] = [net.xy.get(a)!, net.xy.get(b)!];
      return Math.hypot(p[0] - qa[0], p[1] - qa[1]) - Math.hypot(p[0] - qb[0], p[1] - qb[1]);
    })[0]!;
    return named(planConnect(state, ctx, node.id, end));
  }
  const cut = split.apply(state);
  const made = addedKeys(state, cut, 'nodes')[0];
  if (made === undefined) return { error: '구간을 나누지 못했습니다.' };
  const link = planConnect(cut, ctx, node.id, made);
  if ('error' in link) return link;
  const steps: Step[] = [() => split, ...link.steps];
  return { annotation: '가까운 길에 연결', steps };
}
