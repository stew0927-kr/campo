// "다른 층에 복사": the selected points and corridor edges of one floor, copied to other floors of the same building.
// Pure planning only: the result is a Plan of core actions (addNode, addEdge), run as one history entry (one Ctrl+Z).
// Copies of different floors are never joined or connected: every new edge lies inside one target floor. Links between floors
// (elevator, stairs, escalator, bridge) are made with their own tools.
import { addEdge, buildingById, metres, type EditContext, type EditEdge, type EditNode, type EditState } from '@campo/core';
import { classify } from './ops.ts';
import type { Plan, Step } from './plan.ts';
import { floorLabel } from './scope.ts';
import { idMaker, nodeStep, type NodeProps } from './tools.ts';

/** A point of the target floor this close to the copy, of the same node_type, is reused instead of a new one. */
export const REUSE_M = 0.5;

export const NOT_IN_BUILDING = '건물 안의 층에서만 복사할 수 있습니다. 바깥 지점이나 건물에 속하지 않은 지점은 복사하지 않습니다.';
export const USE_OWN_TOOLS = '층 사이 연결은 엘리베이터·계단·에스컬레이터·연결통로 도구로 만들어 주세요.';

export interface SkippedItem {
  /** What was left out ("엘리베이터 정차 지점"), counted per kind. */
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

const NODE_SKIPPED: Record<string, string> = {
  elevator_stop: '엘리베이터 정차 지점',
  stair_landing: '계단참',
  entrance: '출입구',
};

const bump = (m: Map<string, number>, label: string) => m.set(label, (m.get(label) ?? 0) + 1);

/** Label of an edge that is never copied (a link between floors, or a belt), or undefined for an ordinary flat edge. */
function linkKind(e: EditEdge): string | undefined {
  const p = e.props;
  if (p.conveying !== undefined) return '에스컬레이터·무빙워크 구간';
  if (p.highway === 'steps') return '계단 구간';
  if (p.highway === 'elevator') return '엘리베이터 구간';
  if (p.edge_type === 'bridge') return '연결통로 구간';
  if (p.edge_type === 'portal') return '포탈 구간';
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
        : `복사할 수 있는 지점이 없습니다. 엘리베이터 정차 지점, 계단, 에스컬레이터, 연결통로, 출입구는 복사하지 않습니다. ${USE_OWN_TOOLS}`,
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
  floors: number;
  skipped: SkippedItem[];
}

export type CopyPlan = Plan & { summary: CopySummary };

/** The text the person reads afterwards: counts first, then what was left out and why. */
export function copyNotices(s: CopySummary): string[] {
  const out = [`지점 ${s.nodesCreated}개 만듦, ${s.nodesReused}개 재사용, 구간 ${s.edgesCreated}개 만듦.`];
  if (s.edgesExisting > 0) out.push(`이미 있는 구간 ${s.edgesExisting}개는 새로 만들지 않았습니다.`);
  if (s.skipped.length > 0) {
    out.push(`복사하지 않은 것: ${s.skipped.map((k) => `${k.label} ${k.count}개`).join(', ')}.`);
    out.push(USE_OWN_TOOLS);
  }
  return out;
}

/**
 * Copy the selection to each floor of `levels` (other floors of the same building): new ids, same coordinates, same properties but the
 * floor. An edge is copied only when both ends are. A point of the target floor within REUSE_M of the same node_type is reused.
 * All of it is one Plan, so one Ctrl+Z takes every copy back.
 */
export function planCopyToFloors(state: EditState, ctx: EditContext, ids: readonly string[], levels: readonly number[]): CopyPlan | { error: string } {
  const src = copySource(state, ids);
  if ('error' in src) return src;
  const building = buildingById(state, src.buildingId);
  if (!building) return { error: NOT_IN_BUILDING };
  if (levels.length === 0) return { error: '복사할 층을 하나 이상 골라 주세요.' };
  const valid = copyTargets(state, src.buildingId, src.level);
  const bad = levels.filter((l) => !valid.includes(l));
  if (bad.length > 0) return { error: `복사할 수 없는 층입니다: ${bad.map(floorLabel).join(', ')}` };

  const newId = idMaker(state, ctx);
  const steps: Step[] = [];
  const summary: CopySummary = { nodesCreated: 0, nodesReused: 0, edgesCreated: 0, edgesExisting: 0, floors: levels.length, skipped: src.skipped };
  const allNodes = Object.values(state.nodes);

  for (const level of [...new Set(levels)].sort((a, b) => b - a)) {
    const there = allNodes.filter((n) => n.props.building_id === src.buildingId && n.props.level === level);
    const taken = new Set<string>(); // a target point is reused by one copy only
    const made = new Map<string, string>(); // source id -> target id
    for (const n of src.nodes) {
      let reuse: EditNode | undefined;
      let best = REUSE_M;
      for (const t of there) {
        if (taken.has(t.id) || t.props.node_type !== n.props.node_type) continue;
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
        continue;
      }
      // room_ref is dropped: rooms differ from floor to floor (a copied front door would also trip W6)
      const { rev: _rev, room_ref: _roomRef, ...rest } = n.props;
      const props: NodeProps = { ...rest, building_id: src.buildingId, level };
      const id = newId(props);
      made.set(n.id, id);
      steps.push(nodeStep(id, n.coord, props, ctx));
      summary.nodesCreated++;
    }
    for (const e of src.edges) {
      const [from, to] = [made.get(e.props.from)!, made.get(e.props.to)!];
      const existing = Object.values(state.edges).some((x) =>
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
      steps.push(() => addEdge({ vertices: e.vertices.map(([x, y]): [number, number] => [x, y]), props }, ctx));
      summary.edgesCreated++;
    }
  }
  if (steps.length === 0) return { error: '고른 층에 같은 지점과 구간이 이미 모두 있습니다. 새로 만들 것이 없습니다.' };
  const label = levels.length === 1 ? floorLabel(levels[0]!) : `${levels.length}개 층`;
  return { annotation: `${label}에 복사`, steps, notices: copyNotices(summary), summary };
}
