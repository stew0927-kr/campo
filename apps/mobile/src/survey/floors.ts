// 층 복사 and 층 연동 in the survey app, with the same rules and the same data as the editor (a copy and its source share a
// sync_group; flat edges and moves between synced points are repeated on the other floors; 연동 해제 takes a point out of
// its group), so what the app exports opens in the editor like anything drawn there. Everything is a core action, and
// every plan is one action: one 되돌리기.
// Nothing here compares floor numbers to decide what connects: a counterpart is a point of the same building with the same
// sync_group on another floor.
import {
  addEdge,
  addNode,
  buildingById,
  compose,
  freshId,
  metres,
  moveNode,
  setProps,
  type Action,
  type ComposeStep,
  type EditContext,
  type EditEdge,
  type EditNode,
  type EditState,
  type Position,
} from '@campo/core';
import { floorLabel } from '../model/scope.ts';
import { builder, type EdgeProps, type NodeProps } from './plans.ts';

/** A copy this close to a point of the same kind on the target floor joins it instead of lying beside it. */
export const MAGNET_M = 1.5;

/** An edge inside one floor of one building (no stairs, ride, belt, portal or bridge): the kind a copy repeats. */
export function isFlatIndoor(state: EditState, e: EditEdge): boolean {
  const p = e.props;
  if (p.edge_type !== 'indoor' || p.conveying !== undefined || (p.highway !== 'corridor' && p.highway !== 'ramp')) return false;
  const [a, b] = [state.nodes[p.from], state.nodes[p.to]];
  return a !== undefined && b !== undefined && a.props.building_id !== null && a.props.building_id === b.props.building_id && a.props.level === b.props.level;
}

/** The points of the node's sync group on the other floors of its building, by level. Empty without a group. */
export function counterparts(state: EditState, node: EditNode): Map<number, EditNode> {
  const out = new Map<number, EditNode>();
  const { sync_group: group, building_id, level } = node.props;
  if (group === undefined || building_id === null) return out;
  for (const n of Object.values(state.nodes)) {
    if (n.props.sync_group !== group || n.props.building_id !== building_id || n.props.level === level || n.props.level === null) continue;
    if (!out.has(n.props.level)) out.set(n.props.level, n);
  }
  return out;
}

const between = (state: EditState, a: string, b: string): EditEdge[] =>
  Object.values(state.edges).filter((e) => (e.props.from === a && e.props.to === b) || (e.props.from === b && e.props.to === a));

/** Whether anything in the state is synced (a quick exit for the common case). */
export const anySynced = (state: EditState): boolean => Object.values(state.nodes).some((n) => n.props.sync_group !== undefined);

/**
 * `action` with the flat edges it adds between two synced points repeated between their counterparts on the other floors
 * (the action is run once on `state` to see what it adds; an edge the other floor already has is not made twice).
 * Returns `action` itself when there is nothing to mirror.
 */
export function withSyncMirror(state: EditState, ctx: EditContext, action: Action): Action {
  if (!anySynced(state) || action.disabled(state) !== false) return action;
  const after = action.apply(state);
  const mirror: Action[] = [];
  let s = after;
  for (const e of Object.values(after.edges)) {
    if (e.id in state.edges || !isFlatIndoor(after, e)) continue;
    const [a, b] = [after.nodes[e.props.from]!, after.nodes[e.props.to]!];
    const bs = counterparts(after, b);
    for (const [level, from] of counterparts(after, a)) {
      const to = bs.get(level);
      if (!to || between(s, from.id, to.id).length > 0) continue;
      const { rev: _rev, ...rest } = e.props;
      const props: EdgeProps = {
        ...rest, from: from.id, to: to.id,
        ...(rest.level_from !== undefined ? { level_from: level } : {}),
        ...(rest.level_to !== undefined ? { level_to: level } : {}),
      };
      const made = addEdge({ props }, ctx);
      if (made.disabled(s) !== false) continue;
      s = made.apply(s);
      mirror.push(made);
    }
  }
  return mirror.length === 0 ? action : compose([action, ...mirror], typeof action.annotation === 'string' ? action.annotation : '구간 기록 (층 연동)');
}

/** Move a point; the points synced with it on the other floors go to the same coordinate. */
export function planMoveNode(state: EditState, nodeId: string, coord: Position): { action: Action; moved: number } | { error: string } {
  const node = state.nodes[nodeId];
  if (!node) return { error: '지점을 찾을 수 없습니다.' };
  const mates = [...counterparts(state, node).values()];
  const steps: ComposeStep[] = [moveNode(nodeId, coord), ...mates.map((m) => moveNode(m.id, coord))];
  return { action: compose(steps, mates.length > 0 ? '지점 이동 (층 연동)' : '지점 이동'), moved: 1 + mates.length };
}

/** 연동 해제: the points leave their sync group and are independent again. The other floors keep theirs. */
export function planUnsync(state: EditState, nodeIds: readonly string[]): { action: Action; count: number } | { error: string } {
  const synced = nodeIds.filter((id) => state.nodes[id]?.props.sync_group !== undefined);
  if (synced.length === 0) return { error: '층 연동된 지점이 아닙니다.' };
  return { action: setProps(synced, { sync_group: undefined }), count: synced.length };
}

/** The synced points of one floor. */
export function syncedOnFloor(state: EditState, buildingId: string, level: number): string[] {
  return Object.values(state.nodes).filter((n) => n.props.building_id === buildingId && n.props.level === level && n.props.sync_group !== undefined).map((n) => n.id);
}

// ---- 현재 층을 다른 층에 복사 ----

export interface FloorCopySummary {
  nodesCreated: number;
  nodesReused: number;
  edgesCreated: number;
  floors: number;
  /** Stair landings made on a floor that had none there: the flight to them is still to be drawn. */
  landingsCreated: number;
  /** Elevator stops made on a floor the elevator did not stop at: the ride to them is still to be made. */
  stopsCreated: number;
  /** Links between floors, entrances and belts left out. */
  edgesSkipped: number;
}

export interface FloorCopyPlan {
  action: Action;
  summary: FloorCopySummary;
  notices: string[];
}

export function floorCopyTargets(state: EditState, buildingId: string, level: number): number[] {
  const b = buildingById(state, buildingId);
  return b ? b.props.levels.filter((l) => l !== level).sort((x, y) => y - x) : [];
}

/**
 * Copy the points and flat corridors of one floor (stair landings and elevator stops included) onto other floors of the
 * building, same coordinates. A point of the same kind within MAGNET_M on the target floor is reused (an elevator stop: the
 * elevator's own stop there), and a reused or new copy joins the source's sync group (a new group is made for a source that
 * has none). Entrances and the links between floors (stairs, rides, belts, bridges, portals) are not copied.
 */
export function planCopyFloor(state: EditState, ctx: EditContext, buildingId: string, level: number, targets: readonly number[]): FloorCopyPlan | { error: string } {
  const b = buildingById(state, buildingId);
  if (!b) return { error: '건물 안의 층에서만 복사할 수 있습니다.' };
  const tos = [...new Set(targets)].filter((t) => t !== level && b.props.levels.includes(t));
  if (tos.length === 0) return { error: '복사할 다른 층을 골라 주세요.' };
  const source = Object.values(state.nodes).filter((n) => n.props.building_id === buildingId && n.props.level === level && n.props.node_type !== 'entrance');
  if (source.length === 0) return { error: `${floorLabel(level)}에 복사할 지점이 없습니다.` };
  const ids = new Set(source.map((n) => n.id));
  const flat = Object.values(state.edges).filter((e) => ids.has(e.props.from) && ids.has(e.props.to) && isFlatIndoor(state, e));
  const edgesSkipped = Object.values(state.edges).filter((e) => (ids.has(e.props.from) || ids.has(e.props.to)) && !flat.includes(e)).length;

  const bld = builder(state, ctx);
  const reservedGroups = new Set<string>(Object.values(state.nodes).flatMap((n) => (n.props.sync_group !== undefined ? [n.props.sync_group] : [])));
  const groupOf = new Map<string, string>();
  const steps: ComposeStep[] = [];
  const group = (n: EditNode): string => {
    let g = n.props.sync_group ?? groupOf.get(n.id);
    if (g === undefined) {
      g = freshId(state, ctx.ids, 'sg_', reservedGroups);
      reservedGroups.add(g);
      groupOf.set(n.id, g);
      steps.push(setProps([n.id], { sync_group: g }));
    }
    return g;
  };
  const summary: FloorCopySummary = { nodesCreated: 0, nodesReused: 0, edgesCreated: 0, floors: tos.length, landingsCreated: 0, stopsCreated: 0, edgesSkipped };

  for (const to of tos) {
    const map = new Map<string, string>();
    for (const n of source) {
      const g = group(n);
      const there = Object.values(state.nodes).find((m) => {
        if (m.props.building_id !== buildingId || m.props.level !== to || m.props.node_type !== n.props.node_type) return false;
        if (n.props.node_type === 'elevator_stop') return m.props.elevator_id === n.props.elevator_id;
        return metres(m.coord, n.coord) <= MAGNET_M;
      });
      if (there) {
        map.set(n.id, there.id);
        summary.nodesReused++;
        if (there.props.sync_group === undefined) steps.push(setProps([there.id], { sync_group: g }));
        continue;
      }
      const { rev: _rev, ...rest } = n.props;
      const props: NodeProps = { ...rest, level: to, sync_group: g };
      map.set(n.id, bld.node(n.coord, props));
      summary.nodesCreated++;
      if (n.props.node_type === 'stair_landing') summary.landingsCreated++;
      if (n.props.node_type === 'elevator_stop') summary.stopsCreated++;
    }
    for (const e of flat) {
      const [from, to2] = [map.get(e.props.from)!, map.get(e.props.to)!];
      const existing = Object.values(state.edges).some((x) => (x.props.from === from && x.props.to === to2) || (x.props.from === to2 && x.props.to === from));
      if (existing || from === to2) continue;
      const { rev: _rev, ...rest } = e.props;
      bld.edge({ ...rest, from, to: to2, ...(rest.level_from !== undefined ? { level_from: to } : {}), ...(rest.level_to !== undefined ? { level_to: to } : {}) });
      summary.edgesCreated++;
    }
  }
  // The nodes were added by the builder's steps; keep the group setProps before them, then the additions in order.
  const action = compose([...steps, ...bld.steps], `${floorLabel(level)}을(를) ${tos.length}개 층에 복사`);
  const notices = [`지점 ${summary.nodesCreated}개 만듦, ${summary.nodesReused}개 재사용, 구간 ${summary.edgesCreated}개 만듦.`];
  if (summary.landingsCreated > 0) notices.push(`계단참 ${summary.landingsCreated}개를 새로 만들었습니다. 계단 구간은 [계단/EV 층 변경]으로 이어 주세요.`);
  if (summary.stopsCreated > 0) notices.push(`엘리베이터 정차 지점 ${summary.stopsCreated}개를 새로 만들었습니다. 엘리베이터 구간은 [계단/EV 층 변경]으로 이어 주세요.`);
  if (edgesSkipped > 0) notices.push(`출입구·층 사이 구간 ${edgesSkipped}개는 복사하지 않았습니다.`);
  return { action, summary, notices };
}
