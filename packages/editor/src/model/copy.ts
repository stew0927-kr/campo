// "다른 층에 복사": the selected points and flat edges of one floor, copied to other floors of the same building.
// Pure planning only: the result is a Plan of core actions (addNode, addEdge, splitEdgeAt, setProps), run as one history entry
// (one Ctrl+Z). A copy and its source share a sync_group (sync.ts keeps the flat edges between such points alike afterwards).
//
// What a copy does on the target floor, point by point:
//   - a point of the same kind within MAGNET_M is reused (and, when asked, joins the sync group);
//   - a stair landing or an elevator stop is reused when the floor has one there, else made (an elevator stop keeps its
//     elevator_id and is joined into the ride between the stops next to it);
//   - a corridor point within MAGNET_M of a corridor edge is put onto that edge (splitEdgeAt), so the copy is never left
//     lying beside the corridor it belongs to.
// Flat edges are copied when both ends were. Stairs, elevator rides, escalators and bridges are links between floors and
// are made with their own tools.
import {
  addEdge, addNode, buildingById, deleteEdges, edgeCoords, footOnLine, freshId, metres, setProps, splitEdgeAt,
  type Action, type EditContext, type EditEdge, type EditNode, type EditState,
} from '@campo/core';
import { rideEdge, stopsOf } from './elevator.ts';
import { classify } from './ops.ts';
import type { Plan } from './plan.ts';
import { floorLabel } from './scope.ts';
import { DRAWN_SOURCE, idMaker, type EdgeProps, type NodeProps } from './tools.ts';

/** The magnet: a copy this close to a point of the same kind, or to a corridor edge, joins it instead of lying beside it. */
export const MAGNET_M = 1.5;

export const NOT_IN_BUILDING = '건물 안의 층에서만 복사할 수 있습니다. 바깥 지점이나 건물에 속하지 않은 지점은 복사하지 않습니다.';
export const USE_OWN_TOOLS = '층 사이 연결은 엘리베이터·계단·에스컬레이터·연결통로 도구로 만들어 주세요.';

export interface SkippedItem {
  /** What was left out ("출입구"), counted per kind. */
  label: string;
  count: number;
}

export interface CopySource {
  buildingId: string;
  level: number;
  nodes: EditNode[];
  edges: EditEdge[];
  skipped: SkippedItem[];
}

/** An entrance belongs to the ground outside its own floor: it is never copied. */
const NODE_SKIPPED: Record<string, string> = { entrance: '출입구' };

const bump = (m: Map<string, number>, label: string) => m.set(label, (m.get(label) ?? 0) + 1);

/** Label of an edge that is never copied (a link between floors, or a belt), or undefined for an ordinary flat edge. */
function linkKind(e: EditEdge): string | undefined {
  const p = e.props;
  if (p.conveying !== undefined) return '에스컬레이터·무빙워크 구간';
  if (p.highway === 'steps') return '계단 구간';
  if (p.highway === 'elevator') return '엘리베이터 구간';
  if (p.edge_type === 'bridge') return '연결통로 구간';
  if (p.edge_type === 'portal') return '출입구 연결 구간';
  if (p.level_from !== undefined && p.level_to !== undefined && p.level_from !== p.level_to) return '층 사이 구간';
  return undefined;
}

/** What a selection holds for copying, or the Korean reason it cannot be copied. */
export function copySource(state: EditState, ids: readonly string[]): CopySource | { error: string } {
  const sel = classify(state, ids);
  if (sel.buildings.length > 0 || sel.rooms.length > 0) return { error: '건물이나 강의실 영역은 복사하지 않습니다. 지점과 구간만 골라 주세요.' };
  if (sel.nodes.length + sel.edges.length === 0) return { error: '복사할 지점이나 구간을 먼저 골라 주세요.' };
  const nodes = sel.nodes.map((id) => state.nodes[id]!);
  const edges = sel.edges.map((id) => state.edges[id]!);
  if (nodes.some((n) => n.props.building_id === null || n.props.level === null)) return { error: NOT_IN_BUILDING };

  // Edges between two outdoor points are outdoors: no floor to copy from. Edges across scopes are links, skipped below.
  const ends = (e: EditEdge) => [state.nodes[e.props.from], state.nodes[e.props.to]];
  const outdoorEdge = (e: EditEdge) => ends(e).every((n) => n !== undefined && n.props.building_id === null);
  if (edges.some(outdoorEdge)) return { error: NOT_IN_BUILDING };

  const skip = new Map<string, number>();
  const flatEdges: EditEdge[] = [];
  for (const e of edges) {
    const kind = linkKind(e);
    const [a, b] = ends(e);
    const sameFloor = a !== undefined && b !== undefined && a.props.building_id === b.props.building_id && a.props.level === b.props.level;
    if (kind !== undefined) bump(skip, kind);
    else if (!sameFloor) bump(skip, '층이나 건물 사이 구간');
    else flatEdges.push(e);
  }

  const copyNodes: EditNode[] = [];
  for (const n of nodes) {
    const label = NODE_SKIPPED[n.props.node_type];
    if (label !== undefined) bump(skip, label);
    else copyNodes.push(n);
  }
  const scopes = new Set([
    ...copyNodes.map((n) => `${n.props.building_id}\u0000${n.props.level}`),
    ...flatEdges.map((e) => { const a = state.nodes[e.props.from]!; return `${a.props.building_id}\u0000${a.props.level}`; }),
  ]);
  if (scopes.size > 1) return { error: '여러 층(또는 여러 건물)의 지점이 섞여 있습니다. 한 층의 지점과 구간만 골라 주세요.' };

  const inCopy = new Set(copyNodes.map((n) => n.id));
  const copyEdges = flatEdges.filter((e) => {
    if (inCopy.has(e.props.from) && inCopy.has(e.props.to)) return true;
    bump(skip, '양 끝 지점이 함께 복사되지 않는 구간');
    return false;
  });
  if (copyNodes.length === 0) {
    const only = edges.length > 0 && nodes.length === 0;
    return {
      error: only
        ? '구간만 골라서는 복사할 수 없습니다. 구간의 양 끝 지점도 함께 골라 주세요. (상자로 고르면 함께 고릅니다)'
        : `복사할 수 있는 지점이 없습니다. 출입구와 층 사이 구간(계단·엘리베이터·에스컬레이터·연결통로)은 복사하지 않습니다. ${USE_OWN_TOOLS}`,
    };
  }
  const first = state.nodes[copyNodes[0]!.id]!;
  return { buildingId: first.props.building_id!, level: first.props.level!, nodes: copyNodes, edges: copyEdges, skipped: [...skip].map(([label, count]) => ({ label, count })) };
}

/** Why "다른 층에 복사" cannot run for this selection, or false. Includes a building with one floor only. */
export function copyBlocked(state: EditState, ids: readonly string[]): string | false {
  const src = copySource(state, ids);
  if ('error' in src) return src.error;
  const b = buildingById(state, src.buildingId);
  if (!b) return NOT_IN_BUILDING;
  if (copyTargets(state, src.buildingId, src.level).length === 0) return '이 건물에는 복사할 다른 층이 없습니다.';
  return false;
}

/** The floors of the building a copy can go to: every level but `level`, top floor first. */
export function copyTargets(state: EditState, buildingId: string, level: number): number[] {
  const b = buildingById(state, buildingId);
  return b ? b.props.levels.filter((l) => l !== level).sort((x, y) => y - x) : [];
}

export interface CopySummary {
  nodesCreated: number;
  nodesReused: number;
  edgesCreated: number;
  /** Edges that were already there between the reused points. */
  edgesExisting: number;
  /** Copies put onto a corridor edge of the target floor (the edge was split there). */
  snapped: number;
  /** Elevator stops made on a floor the elevator did not stop at. */
  stopsCreated: number;
  /** Stair landings made on a floor that had none there: the flight to them is still to be drawn. */
  landingsCreated: number;
  /** Reused points left out of the sync group because they already belong to another one. */
  notJoined: number;
  floors: number;
  skipped: SkippedItem[];
}

export interface CopyOptions {
  /** A reused point of the target floor joins the sync group of the point copied onto it. Default true. */
  joinSync?: boolean;
}

export type CopyPlan = Plan & { summary: CopySummary };

/** The text the person reads afterwards: counts first, then what was left out and why. */
export function copyNotices(s: CopySummary): string[] {
  const out = [`지점 ${s.nodesCreated}개 만듦, ${s.nodesReused}개 재사용, 구간 ${s.edgesCreated}개 만듦.`];
  if (s.edgesExisting > 0) out.push(`이미 있는 구간 ${s.edgesExisting}개는 새로 만들지 않았습니다.`);
  if (s.snapped > 0) out.push(`기존 복도 가까이(${MAGNET_M}m 안)에 놓인 지점 ${s.snapped}개는 그 복도 위에 이었습니다.`);
  if (s.stopsCreated > 0) out.push(`엘리베이터 정차 지점 ${s.stopsCreated}개를 만들고 위아래 정차 층과 이었습니다.`);
  if (s.landingsCreated > 0) out.push(`계단참 ${s.landingsCreated}개를 만들었습니다. 층 사이 계단 구간은 계단 도구로 이어 주세요.`);
  if (s.notJoined > 0) out.push(`이미 다른 연동에 속한 지점 ${s.notJoined}개는 연동에 넣지 않았습니다.`);
  if (s.skipped.length > 0) {
    out.push(`복사하지 않은 것: ${s.skipped.map((k) => `${k.label} ${k.count}개`).join(', ')}.`);
    out.push(USE_OWN_TOOLS);
  }
  return out;
}

const isFlatCorridor = (e: EditEdge): boolean =>
  e.props.edge_type === 'indoor' && (e.props.highway === 'corridor' || e.props.highway === 'ramp') && e.props.conveying === undefined;

/**
 * Copy the selection to each floor of `levels` (other floors of the same building): same coordinates and properties but the floor,
 * with the magnet rules at the top of this file. Source and copies share a sync_group. All of it is one Plan, so one Ctrl+Z
 * takes every copy back.
 */
export function planCopyToFloors(state: EditState, ctx: EditContext, ids: readonly string[], levels: readonly number[], options: CopyOptions = {}): CopyPlan | { error: string } {
  const src = copySource(state, ids);
  if ('error' in src) return src;
  const building = buildingById(state, src.buildingId);
  if (!building) return { error: NOT_IN_BUILDING };
  if (levels.length === 0) return { error: '복사할 층을 하나 이상 골라 주세요.' };
  const valid = copyTargets(state, src.buildingId, src.level);
  const bad = levels.filter((l) => !valid.includes(l));
  if (bad.length > 0) return { error: `복사할 수 없는 층입니다: ${bad.map(floorLabel).join(', ')}` };
  const joinSync = options.joinSync ?? true;

  const summary: CopySummary = {
    nodesCreated: 0, nodesReused: 0, edgesCreated: 0, edgesExisting: 0, snapped: 0, stopsCreated: 0, landingsCreated: 0, notJoined: 0,
    floors: levels.length, skipped: src.skipped,
  };
  // The plan is built against the state each action leaves behind (a split changes the edges the next copy looks at).
  // The same action objects go into the plan: an action keeps the ids it drew.
  let s = state;
  const actions: Action[] = [];
  const run = (action: Action): boolean => {
    if (action.disabled(s) !== false) return false;
    s = action.apply(s);
    actions.push(action);
    return true;
  };
  const newId = idMaker(state, ctx);

  // ---- sync groups: one per source point, given to the source the first time a copy needs it ----
  const groups = new Map<string, string>(src.nodes.flatMap((n) => (n.props.sync_group !== undefined ? [[n.id, n.props.sync_group] as const] : [])));
  const usedGroups = new Set(Object.values(state.nodes).flatMap((n) => (n.props.sync_group !== undefined ? [n.props.sync_group] : [])));
  const reservedGroups = new Set<string>();
  const giveGroup = (n: EditNode, group?: string): string => {
    let g = groups.get(n.id);
    if (g !== undefined) return g;
    g = group;
    while (g === undefined || (group === undefined && usedGroups.has(g))) {
      g = freshId(state, ctx.ids, 'sg_', reservedGroups);
      reservedGroups.add(g);
    }
    usedGroups.add(g);
    groups.set(n.id, g);
    run(setProps([n.id], { sync_group: g }));
    return g;
  };

  for (const level of [...new Set(levels)].sort((a, b) => b - a)) {
    const onFloor = (n: EditNode) => n.props.building_id === src.buildingId && n.props.level === level;
    const there = Object.values(s.nodes).filter(onFloor);
    const taken = new Set<string>(); // a target point is reused by one copy only
    const made = new Map<string, string>(); // source id -> target id

    for (const n of src.nodes) {
      const type = n.props.node_type;
      // 1. A point of the same kind already there (for an elevator stop: of the same elevator).
      let reuse: EditNode | undefined;
      let best = MAGNET_M;
      for (const t of there) {
        if (taken.has(t.id) || t.props.node_type !== type) continue;
        if (type === 'elevator_stop' && n.props.elevator_id !== undefined && t.props.elevator_id !== n.props.elevator_id) continue;
        const d = metres(t.coord, n.coord);
        if (d <= best) {
          best = d;
          reuse = t;
        }
      }
      if (reuse) {
        taken.add(reuse.id);
        made.set(n.id, reuse.id);
        summary.nodesReused++;
        if (joinSync) {
          const theirs = s.nodes[reuse.id]!.props.sync_group;
          const ours = groups.get(n.id);
          if (theirs === undefined) run(setProps([reuse.id], { sync_group: giveGroup(n) }));
          else if (ours === undefined) giveGroup(n, theirs);
          else if (ours !== theirs) summary.notJoined++;
        }
        continue;
      }

      // 2. A new point: same properties but the floor. room_ref is dropped: rooms differ from floor to floor (a copied front door would also trip W6).
      const { rev: _rev, room_ref: _roomRef, ...rest } = n.props;
      const props: NodeProps = { ...rest, building_id: src.buildingId, level, sync_group: giveGroup(n) };
      const id = newId(props);
      made.set(n.id, id);
      const stops = type === 'elevator_stop' && n.props.elevator_id !== undefined ? stopsOf(s, n.props.elevator_id) : [];
      // Stops of one elevator stand at one coordinate (I5).
      run(addNode({ id, coord: [...(stops[0]?.coord ?? n.coord)] as [number, number], props }, ctx));
      summary.nodesCreated++;

      if (type === 'stair_landing') summary.landingsCreated++;
      else if (stops.length > 0) {
        // Into the ride: between the stops next below and next above, replacing the edge that passed this floor by.
        const below = stops.filter((x) => x.props.level! < level).at(-1);
        const above = stops.find((x) => x.props.level! > level);
        if (below && above) {
          const through = Object.values(s.edges).filter((e) => e.props.highway === 'elevator' && [e.props.from, e.props.to].includes(below.id) && [e.props.from, e.props.to].includes(above.id));
          if (through.length > 0) run(deleteEdges(through.map((e) => e.id), ctx));
        }
        const join = (from: string, to: string, lo: number, hi: number) => {
          const action = rideEdge(ctx, from, to, lo, hi)(s);
          if (action) run(action);
        };
        if (below) join(below.id, id, below.props.level!, level);
        if (above) join(id, above.id, level, above.props.level!);
        summary.stopsCreated++;
      } else if (type === 'corridor') {
        // 3. The magnet: onto the nearest corridor edge of the floor, or joined to its nearer end when the edge cannot be cut there.
        let near: { edge: EditEdge; dist: number } | undefined;
        for (const e of Object.values(s.edges)) {
          if (!isFlatCorridor(e) || e.props.from === id || e.props.to === id) continue;
          const [a, b] = [s.nodes[e.props.from], s.nodes[e.props.to]];
          if (!a || !b || !onFloor(a) || !onFloor(b)) continue;
          const dist = footOnLine(edgeCoords(s, e), n.coord).pointDistance;
          if (dist <= MAGNET_M && (!near || dist < near.dist)) near = { edge: e, dist };
        }
        if (near) {
          const { edge } = near;
          if (!run(splitEdgeAt(edge.id, n.coord, { nodeId: id }, ctx))) {
            const ends = [s.nodes[edge.props.from]!, s.nodes[edge.props.to]!].sort((a, b) => metres(a.coord, n.coord) - metres(b.coord, n.coord));
            const link: EdgeProps = { kind: 'edge', highway: 'corridor', edge_type: 'indoor', step_free: null, from: id, to: ends[0]!.id, bidirectional: true, source: DRAWN_SOURCE };
            run(addEdge({ props: link }, ctx));
          }
          summary.snapped++;
        }
      }
    }

    for (const e of src.edges) {
      const [from, to] = [made.get(e.props.from)!, made.get(e.props.to)!];
      if (from === to) continue; // both ends landed on one point of the floor
      const existing = Object.values(s.edges).some((x) =>
        ((x.props.from === from && x.props.to === to) || (x.props.from === to && x.props.to === from)) &&
        x.props.highway === e.props.highway && x.props.edge_type === e.props.edge_type);
      if (existing) {
        summary.edgesExisting++;
        continue;
      }
      const { rev: _r, ...rest } = e.props;
      const props = {
        ...rest,
        from,
        to,
        ...(rest.level_from !== undefined ? { level_from: level } : {}),
        ...(rest.level_to !== undefined ? { level_to: level } : {}),
      };
      if (run(addEdge({ vertices: e.vertices.map(([x, y]): [number, number] => [x, y]), props }, ctx))) summary.edgesCreated++;
    }
  }
  if (summary.nodesCreated + summary.edgesCreated === 0 && actions.length === 0) return { error: '고른 층에 같은 지점과 구간이 이미 모두 있습니다. 새로 만들 것이 없습니다.' };
  const label = levels.length === 1 ? floorLabel(levels[0]!) : `${levels.length}개 층`;
  return { annotation: `${label}에 복사`, steps: actions.map((a) => () => a), notices: copyNotices(summary), summary };
}
