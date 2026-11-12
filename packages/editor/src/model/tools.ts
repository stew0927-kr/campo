// The drawing tools (SPEC §8) as Plans of core actions: 바깥 길, 지점 추가, 엘리베이터, 계단, 잇기, 포탈, 연결통로.
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
import { floorLabel } from './scope.ts';

/** Default source for data drawn in the editor until someone checks it on site (SPEC §4.1). */
export const DRAWN_SOURCE = 'estimate';

export const OUTDOOR_KINDS = ['flat', 'steps', 'ramp'] as const;
export type OutdoorKind = (typeof OUTDOOR_KINDS)[number];

export const INDOOR_NODE_KINDS = ['entrance', 'door', 'classroom', 'corridor'] as const;
export type IndoorNodeKind = (typeof INDOOR_NODE_KINDS)[number];

type NodeProps = Omit<NodeProperties, 'rev'>;
type EdgeProps = Omit<EdgeProperties, 'rev'>;

/** Hands out new node ids that cannot clash with each other or with the state. */
function idMaker(state: EditState, ctx: EditContext) {
  const reserved = new Set<string>();
  return (props: Pick<NodeProps, 'building_id' | 'level' | 'node_type'>): string => {
    const id = freshId(state, ctx.ids, nodeIdPrefix(state, props), reserved);
    reserved.add(id);
    return id;
  };
}

const nodeStep = (id: string, coord: Position, props: NodeProps, ctx: EditContext): Step => () => addNode({ id, coord: [coord[0], coord[1]], props }, ctx);
const edgeStep = (props: EdgeProps, ctx: EditContext): Step => () => addEdge({ props }, ctx);

// ---- 바깥 길 ----

const EDGE_BY_KIND: Record<OutdoorKind, Pick<EdgeProps, 'highway' | 'step_free'>> = {
  flat: { highway: 'footway', step_free: null },
  steps: { highway: 'steps', step_free: false },
  ramp: { highway: 'ramp', step_free: null },
};

/** A clicked point: either snapped onto an existing node, or a new position. */
export type PathVertex = { nodeId: string } | { position: Position };

/** A drawn polyline: new outdoor nodes for new positions, one edge per consecutive pair. null when there is nothing to draw. */
export function planOutdoorPath(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind): Plan | null {
  const newId = idMaker(state, ctx);
  const steps: Step[] = [];
  const path: string[] = [];
  const newAt = new Map<string, string>(); // "lng,lat" -> id, so closing a loop reuses the first new node
  for (const v of vertices) {
    let id: string;
    if ('nodeId' in v) {
      if (!(v.nodeId in state.nodes)) throw new Error(`no node ${v.nodeId}`);
      id = v.nodeId;
    } else {
      const key = `${v.position[0]},${v.position[1]}`;
      const known = newAt.get(key);
      if (known !== undefined) id = known;
      else {
        id = newId({ building_id: null, level: null, node_type: 'outdoor' });
        newAt.set(key, id);
        steps.push(nodeStep(id, v.position, { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: DRAWN_SOURCE }, ctx));
      }
    }
    if (path[path.length - 1] !== id) path.push(id); // clicking the same node twice is not a segment
  }
  if (path.length < 2) return null; // a lone click draws nothing
  for (let i = 0; i + 1 < path.length; i++) {
    steps.push(edgeStep({
      kind: 'edge', ...EDGE_BY_KIND[kind], edge_type: 'outdoor', from: path[i]!, to: path[i + 1]!, bidirectional: true, source: DRAWN_SOURCE,
    }, ctx));
  }
  return { annotation: `바깥 길 ${path.length - 1}구간 그리기`, steps };
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

/** One stop per checked level, all at the same spot, and an elevator edge between each pair of neighbouring stops (SPEC §3). */
export function planElevator(state: EditState, ctx: EditContext, e: { buildingId: string; position: Position; levels: number[] }): PlanResult {
  const building = buildingById(state, e.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  const stops = building.props.levels.filter((l) => e.levels.includes(l)).sort((a, b) => a - b);
  if (stops.length < 2) return { error: '정차 층을 두 개 이상 골라 주세요.' };
  const used = new Set(Object.values(state.nodes).map((n) => n.props.elevator_id));
  let letter: string | undefined;
  for (let c = 65; c <= 90 && !letter; c++) if (!used.has(`${building.props.code}_elev${String.fromCharCode(c)}`)) letter = String.fromCharCode(c);
  if (!letter) return { error: '이 건물에는 엘리베이터를 더 만들 수 없습니다(A~Z 모두 사용 중).' };
  const elevatorId = `${building.props.code}_elev${letter}`;

  const newId = idMaker(state, ctx);
  const ids = stops.map((level) => newId({ building_id: building.id, level, node_type: 'elevator_stop' }));
  const steps: Step[] = stops.map((level, i) => nodeStep(ids[i]!, e.position, {
    kind: 'node', node_type: 'elevator_stop', building_id: building.id, level, elevator_id: elevatorId, source: DRAWN_SOURCE,
  }, ctx));
  for (let i = 0; i + 1 < stops.length; i++) {
    steps.push(edgeStep({
      kind: 'edge', highway: 'elevator', edge_type: 'indoor', step_free: true, from: ids[i]!, to: ids[i + 1]!, bidirectional: true,
      level_from: stops[i]!, level_to: stops[i + 1]!, source: DRAWN_SOURCE,
    }, ctx));
  }
  return { annotation: `엘리베이터 추가(정차 ${stops.length}개 층)`, steps };
}

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

// ---- 잇기, 포탈, 연결통로 ----

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

/** Corridor between two buildings (SPEC §4.2 bridge: building_from/to and level_from/to required). */
export function planBridge(state: EditState, ctx: EditContext, fromId: string, toId: string): PlanResult {
  const a = state.nodes[fromId];
  const b = state.nodes[toId];
  if (!a || !b) return { error: '이을 지점을 찾을 수 없습니다.' };
  const [pa, pb] = [a.props, b.props];
  if (pa.building_id === null || pb.building_id === null) return { error: '연결통로는 두 건물 안의 지점을 잇습니다.' };
  if (pa.building_id === pb.building_id) return { error: '같은 건물 안은 잇기 도구로 이어 주세요.' };
  if (!buildingById(state, pa.building_id) || !buildingById(state, pb.building_id)) return { error: '건물 정보를 찾을 수 없습니다.' };
  return {
    annotation: '연결통로 추가',
    steps: [edgeStep({
      kind: 'edge', highway: 'corridor', edge_type: 'bridge', step_free: null, from: fromId, to: toId, bidirectional: true,
      building_from: pa.building_id, building_to: pb.building_id, level_from: pa.level!, level_to: pb.level!, source: DRAWN_SOURCE,
    }, ctx)],
  };
}
