// The drawing tools (SPEC §8) as Plans of core actions: 길 그리기, 지점 추가, 계단, 잇기, 포탈. (엘리베이터: elevator.ts, 연결통로: bridge.ts, 에스컬레이터: escalator.ts)
// New ids come from core (freshId with the session's generator), new Features start at rev 1 inside addNode / addEdge.
// step_free defaults follow SPEC-v0.2 §2.1: steps false, elevator true, everything else null (not known).
import {
  addEdge,
  addNode,
  buildingById,
  freshId,
  nodeIdPrefix,
  type EdgeProperties,
  type EditContext,
  type EditState,
  type NodeProperties,
  type Position,
} from '@campo/core';
import type { Plan, PlanResult, Step } from './plan.ts';
import { OUTDOOR, floorLabel, snappable, type Scope } from './scope.ts';

/** Default source for data drawn in the editor until someone checks it on site (SPEC §4.1). */
export const DRAWN_SOURCE = 'estimate';

export const OUTDOOR_KINDS = ['flat', 'steps', 'ramp'] as const;
export type OutdoorKind = (typeof OUTDOOR_KINDS)[number];

export const INDOOR_NODE_KINDS = ['entrance', 'door', 'classroom', 'corridor'] as const;
export type IndoorNodeKind = (typeof INDOOR_NODE_KINDS)[number];

export type NodeProps = Omit<NodeProperties, 'rev'>;
export type EdgeProps = Omit<EdgeProperties, 'rev'>;

/** Hands out new node ids that cannot clash with each other or with the state. */
export function idMaker(state: EditState, ctx: EditContext) {
  const reserved = new Set<string>();
  return (props: Pick<NodeProps, 'building_id' | 'level' | 'node_type'>): string => {
    const id = freshId(state, ctx.ids, nodeIdPrefix(state, props), reserved);
    reserved.add(id);
    return id;
  };
}

export const nodeStep = (id: string, coord: Position, props: NodeProps, ctx: EditContext): Step => () => addNode({ id, coord: [coord[0], coord[1]], props }, ctx);
export const edgeStep = (props: EdgeProps, ctx: EditContext): Step => () => addEdge({ props }, ctx);

// ---- 바깥 길 ----

const EDGE_BY_KIND: Record<OutdoorKind, Pick<EdgeProps, 'highway' | 'step_free'>> = {
  flat: { highway: 'footway', step_free: null },
  steps: { highway: 'steps', step_free: false },
  ramp: { highway: 'ramp', step_free: null },
};

/** A clicked point: either snapped onto an existing node, or a new position. */
export type PathVertex = { nodeId: string } | { position: Position };

/** The kinds of way the 길 그리기 tool draws. Elevators are not one of them: they come from the 엘리베이터 tool (SPEC-v0.2 6.5). */
export const ELEVATOR_NOT_DRAWN = '엘리베이터는 엘리베이터 도구로 만드세요';

/**
 * A drawn polyline in `scope` (SPEC-v0.2 5.2): new nodes for new positions (outdoor points, or corridor nodes on the floor),
 * one edge per consecutive pair. An outdoor path that reaches an entrance makes that edge a portal. Null when there is nothing to draw.
 */
export function planPath(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind, scope: Scope): PlanResult | null {
  const indoor = scope.kind === 'building';
  if (indoor && kind === 'steps') return { error: '같은 층 안의 계단 구간은 그리지 않습니다. 층 사이 계단은 지점 추가의 계단으로 만드세요.' };
  const building = indoor ? buildingById(state, scope.buildingId) : undefined;
  if (indoor && (!building || !building.props.levels.includes(scope.level))) return { error: '건물이나 층을 찾을 수 없습니다.' };
  const here = indoor ? { building_id: scope.buildingId, level: scope.level } : { building_id: null, level: null };
  const nodeType = indoor ? 'corridor' : 'outdoor';
  const newId = idMaker(state, ctx);
  const steps: Step[] = [];
  const path: string[] = [];
  const newAt = new Map<string, string>(); // "lng,lat" -> id, so closing a loop reuses the first new node
  for (const v of vertices) {
    let id: string;
    if ('nodeId' in v) {
      const node = state.nodes[v.nodeId];
      if (!node) throw new Error(`no node ${v.nodeId}`);
      if (!snappable(node, scope)) return { error: '다른 층이나 다른 범위의 지점에는 붙일 수 없습니다.' };
      id = v.nodeId;
    } else {
      const key = `${v.position[0]},${v.position[1]}`;
      const known = newAt.get(key);
      if (known !== undefined) id = known;
      else {
        id = newId({ ...here, node_type: nodeType });
        newAt.set(key, id);
        steps.push(nodeStep(id, v.position, { kind: 'node', node_type: nodeType, ...here, source: DRAWN_SOURCE }, ctx));
      }
    }
    if (path[path.length - 1] !== id) path.push(id); // clicking the same node twice is not a segment
  }
  if (path.length < 2) return null; // a lone click draws nothing
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i]!, path[i + 1]!];
    const outside = (id: string) => (state.nodes[id] ? state.nodes[id]!.props.building_id === null : true);
    if (!indoor && !outside(a) && !outside(b)) return { error: '출입구와 출입구는 바로 이을 수 없습니다. 사이에 바깥 지점을 두세요.' };
    const toEntrance = !indoor && (!outside(a) || !outside(b));
    steps.push(edgeStep(toEntrance ? {
      kind: 'edge', highway: 'footway', edge_type: 'portal', step_free: null, from: a, to: b, bidirectional: true, source: DRAWN_SOURCE,
    } : indoor ? {
      kind: 'edge', highway: kind === 'ramp' ? 'ramp' : 'corridor', edge_type: 'indoor', step_free: null, from: a, to: b, bidirectional: true, source: DRAWN_SOURCE,
    } : {
      kind: 'edge', ...EDGE_BY_KIND[kind], edge_type: 'outdoor', from: a, to: b, bidirectional: true, source: DRAWN_SOURCE,
    }, ctx));
  }
  const n = path.length - 1;
  return { annotation: indoor ? `${kind === 'ramp' ? '경사로' : '복도'} ${n}구간 그리기` : `바깥 길 ${n}구간 그리기`, steps };
}

/** 바깥 길 only (the scope-less form). */
export function planOutdoorPath(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind): PlanResult | null {
  return planPath(state, ctx, vertices, kind, OUTDOOR);
}

// ---- 지점 추가 ----

/** A plain outdoor point, or a departure / arrival candidate (poi) with a name. */
export function planOutdoorNode(state: EditState, ctx: EditContext, position: Position, poiName?: string): PlanResult {
  const name = poiName?.trim();
  if (poiName !== undefined && !name) return { error: '출발·도착 후보의 이름을 입력해 주세요. 예: 정문, 한양대역 2번 출구' };
  const type = name ? 'poi' : 'outdoor';
  const id = idMaker(state, ctx)({ building_id: null, level: null, node_type: type });
  return {
    annotation: name ? '출발·도착 후보 추가' : '지점 추가',
    steps: [nodeStep(id, position, { kind: 'node', node_type: type, building_id: null, level: null, ...(name ? { name } : {}), source: DRAWN_SOURCE }, ctx)],
  };
}

export interface NewIndoorNode {
  buildingId: string;
  level: number;
  kind: IndoorNodeKind;
  position: Position;
  /** Room number, for classroom doors ("408"). */
  ref?: string;
  /** Room name, for classroom doors ("408호 강의실"). */
  spaceName?: string;
}

export function planIndoorNode(state: EditState, ctx: EditContext, n: NewIndoorNode): PlanResult {
  const building = buildingById(state, n.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  if (!building.props.levels.includes(n.level)) return { error: `${floorLabel(n.level)}은 이 건물의 층 목록에 없습니다.` };
  let extra: Pick<NodeProps, 'ref' | 'space_name'> = {};
  if (n.kind === 'classroom') {
    const ref = n.ref?.trim() ?? '';
    if (!/^[A-Za-z0-9-]+$/.test(ref)) return { error: '호수는 영문, 숫자, - 만 쓸 수 있습니다. 예: 408, B102' };
    extra = { ref, space_name: n.spaceName?.trim() || `${ref}호 강의실` };
  }
  const props: NodeProps = {
    kind: 'node', node_type: n.kind === 'classroom' ? 'door' : n.kind, building_id: building.id, level: n.level, ...extra, source: DRAWN_SOURCE,
  };
  const id = idMaker(state, ctx)(props);
  return { annotation: n.kind === 'classroom' ? '강의실 문 추가' : '지점 추가', steps: [nodeStep(id, n.position, props, ctx)] };
}

// ---- 엘리베이터, 계단 ----

/** One landing per level from `from` to `to`, and one steps edge per floor in between (SPEC §3 계단). */
export function planStairs(state: EditState, ctx: EditContext, s: { buildingId: string; position: Position; from: number; to: number }): PlanResult {
  const building = buildingById(state, s.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  const { levels } = building.props;
  if (!levels.includes(s.from) || !levels.includes(s.to)) return { error: '시작 층과 끝 층은 이 건물의 층 목록에서 골라 주세요.' };
  if (s.from === s.to) return { error: '시작 층과 끝 층이 같습니다.' };
  const [lo, hi] = [Math.min(s.from, s.to), Math.max(s.from, s.to)];
  const flights = levels.filter((l) => l >= lo && l <= hi).sort((a, b) => a - b);

  const newId = idMaker(state, ctx);
  const ids = flights.map((level) => newId({ building_id: building.id, level, node_type: 'stair_landing' }));
  const steps: Step[] = flights.map((level, i) => nodeStep(ids[i]!, s.position, {
    kind: 'node', node_type: 'stair_landing', building_id: building.id, level, source: DRAWN_SOURCE,
  }, ctx));
  for (let i = 0; i + 1 < flights.length; i++) {
    steps.push(edgeStep({
      kind: 'edge', highway: 'steps', edge_type: 'indoor', step_free: false, from: ids[i]!, to: ids[i + 1]!, bidirectional: true,
      level_from: flights[i]!, level_to: flights[i + 1]!, source: DRAWN_SOURCE,
    }, ctx));
  }
  return { annotation: `계단 추가(${flights.length}개 층)`, steps };
}

// ---- 잇기, 포탈 ----

const joined = (state: EditState, a: string, b: string, match?: (e: EditState['edges'][string]) => boolean) =>
  Object.values(state.edges).some((e) => ((e.props.from === a && e.props.to === b) || (e.props.from === b && e.props.to === a)) && (!match || match(e)));

/**
 * "잇기": an edge between two nodes on the same floor of one building (corridor), or between two outdoor nodes (footway).
 * Floors, buildings and the outside are joined by the stairs / elevator / portal / bridge tools instead.
 */
export function planConnect(state: EditState, ctx: EditContext, fromId: string, toId: string): PlanResult {
  const from = state.nodes[fromId];
  const to = state.nodes[toId];
  if (!from || !to) return { error: '이을 지점을 찾을 수 없습니다.' };
  if (from.id === to.id) return { error: '같은 지점입니다. 다른 지점을 골라 주세요.' };
  const [a, b] = [from.props, to.props];
  let props: Pick<EdgeProps, 'highway' | 'edge_type' | 'step_free'>;
  if (a.building_id === null && b.building_id === null) props = { highway: 'footway', edge_type: 'outdoor', step_free: null };
  else if (a.building_id === null || b.building_id === null) return { error: '건물 안과 바깥은 포탈 도구로 이어 주세요.' };
  else if (a.building_id !== b.building_id) return { error: '다른 건물끼리는 연결통로 도구로 이어 주세요.' };
  else if (a.level !== b.level) return { error: '다른 층끼리는 계단이나 엘리베이터 도구로 이어 주세요.' };
  else props = { highway: 'corridor', edge_type: 'indoor', step_free: null };
  if (joined(state, fromId, toId)) return { error: '두 지점은 이미 이어져 있습니다.' };
  return {
    annotation: '구간 추가',
    steps: [edgeStep({ kind: 'edge', ...props, from: fromId, to: toId, bidirectional: true, source: DRAWN_SOURCE }, ctx)],
  };
}

/** Entrance <-> outdoor point. step_free is null (not known) until checked on site (SPEC-v0.2 §2.1). */
export function planPortal(state: EditState, ctx: EditContext, entranceId: string, outdoorId: string): PlanResult {
  const entrance = state.nodes[entranceId];
  const outside = state.nodes[outdoorId];
  if (!entrance || entrance.props.node_type !== 'entrance') return { error: '포탈은 건물 출입구에서 시작합니다. 출입구 지점을 먼저 골라 주세요.' };
  if (!outside || outside.props.building_id !== null) return { error: '이어질 바깥 지점을 골라 주세요.' };
  if (joined(state, entranceId, outdoorId, (e) => e.props.edge_type === 'portal')) return { error: '이 출입구와 바깥 지점은 이미 포탈로 이어져 있습니다.' };
  return {
    annotation: '포탈 추가',
    steps: [edgeStep({
      kind: 'edge', highway: 'footway', edge_type: 'portal', step_free: null, from: entranceId, to: outdoorId, bidirectional: true, source: DRAWN_SOURCE,
    }, ctx)],
  };
}
