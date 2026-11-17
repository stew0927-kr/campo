// 계단 · 엘리베이터 · 에스컬레이터 as points (the editor's way, like 문 and 화장실): the menu button puts the point at the
// crosshair at once, and what joins it to another floor (a trip measured with the barometer, the escalator stopwatch, the
// number of steps) is in the sheet the point opens. Nothing here compares floor numbers to decide what connects: the
// floors a point reaches are read from its edges.
import {
  ELEVATOR_STOP_M,
  attachDoorAction,
  buildingById,
  compose,
  isEscalator,
  previewAttachDoor,
  setProps,
  type Action,
  type EditEdge,
  type EditState,
} from '@campo/core';
import { floorLabel, scopeOfNode } from '../model/scope.ts';
import {
  NOT_CONNECTED_NOTICE, SNAP_M, builder, isWalkPoint, nearestNode, nearestWhere, newElevatorId, walkNode, type Plan, type PlanInput,
} from './plans.ts';

export type VerticalPointKind = 'stairs' | 'elevator' | 'escalator';

const NEED_FLOOR = '건물 안의 층에서 찍습니다. 위쪽에서 건물과 층을 먼저 골라 주세요.';

/** A new point of a floor joins the nearest corridor when there is one, in the same history entry (the editor's attachPreview). */
function joinCorridor(b: ReturnType<typeof builder>, input: PlanInput, id: string, notices: string[]): void {
  const { state, ctx, scope, coord, source } = input;
  if (scope.kind !== 'building') return;
  if (previewAttachDoor(state, coord, { building_id: scope.buildingId, level: scope.level }).ok) b.steps.push(() => attachDoorAction(id, { source }, ctx));
  else notices.push(NOT_CONNECTED_NOTICE);
}

/** 계단: a landing on this floor at the crosshair. The flight to the next floor is recorded from its sheet. */
export function planStairPoint(input: PlanInput): Plan {
  const { state, ctx, scope, coord, source } = input;
  if (scope.kind !== 'building') return { error: `계단은 ${NEED_FLOOR}` };
  const near = nearestNode(state, scope, coord, SNAP_M, (n) => n.props.node_type === 'stair_landing');
  if (near) return { action: null, anchorId: input.anchorId ?? near.id, scope, featureId: near.id, notices: ['이미 있는 계단 지점입니다. 지점을 누르면 다른 층과 연결할 수 있습니다.'] };
  const b = builder(state, ctx);
  const id = b.node(coord, { kind: 'node', node_type: 'stair_landing', building_id: scope.buildingId, level: scope.level, source });
  const notices: string[] = [];
  joinCorridor(b, input, id, notices);
  notices.push('계단 지점을 찍었습니다. 지점을 누르면 다른 층과 연결하고 칸 수를 적을 수 있습니다.');
  return { action: b.action(`계단 지점 기록(${floorLabel(scope.level)})`), anchorId: input.anchorId ?? id, scope, featureId: id, notices };
}

/**
 * 엘리베이터: a stop on this floor. Near a stop of the same building (any floor) it is that shaft — same spot, same
 * elevator_id (I5); otherwise a new shaft. The other floors are joined by riding, from the stop's sheet.
 */
export function planElevatorPoint(input: PlanInput): Plan {
  const { state, ctx, scope, coord, source } = input;
  if (scope.kind !== 'building') return { error: `엘리베이터는 ${NEED_FLOOR}` };
  const building = buildingById(state, scope.buildingId);
  if (!building) return { error: '건물을 찾을 수 없습니다.' };
  const shaft = nearestWhere(state, coord, SNAP_M, (n) =>
    n.props.building_id === scope.buildingId && n.props.node_type === 'elevator_stop' && n.props.elevator_id !== undefined);
  const elevatorId = shaft?.props.elevator_id ?? newElevatorId(state, building.props.code);
  if (elevatorId === undefined) return { error: '이 건물에는 엘리베이터를 더 만들 수 없습니다(A~Z 모두 사용 중).' };
  const spot = shaft?.coord ?? coord;
  const here = nearestNode(state, scope, spot, ELEVATOR_STOP_M, (n) => n.props.node_type === 'elevator_stop' && n.props.elevator_id === elevatorId);
  if (here) return { action: null, anchorId: input.anchorId ?? here.id, scope, featureId: here.id, notices: ['이미 있는 엘리베이터 지점입니다. 지점을 누르면 다른 층과 연결할 수 있습니다.'] };
  const b = builder(state, ctx);
  const id = b.node(spot, { kind: 'node', node_type: 'elevator_stop', building_id: scope.buildingId, level: scope.level, elevator_id: elevatorId, source });
  const notices: string[] = [];
  joinCorridor(b, { ...input, coord: spot }, id, notices);
  // A stop of an existing shaft is not joined to the others here (that would compare floor numbers): riding it from the
  // stop's sheet joins it, and until then the editor's checks list the shaft as split (E11).
  notices.push(shaft ? '같은 엘리베이터의 이 층 정차 지점을 찍었습니다. 지점을 누르고 [다른 층과 연결]로 타고 이동해 이어 주세요.' : '엘리베이터 지점을 찍었습니다. 지점을 누르면 다른 층과 연결할 수 있습니다.');
  return { action: b.action(`엘리베이터 지점 기록(${floorLabel(scope.level)})`), anchorId: input.anchorId ?? id, scope, featureId: id, notices };
}

/**
 * 에스컬레이터: the spot where the belt is boarded, as a walk point (an existing one within SNAP_M, else a new one; indoors
 * joined to the nearest corridor). The schema has no escalator point type: the belt itself is the escalator, recorded
 * from this point's sheet; until then the screen remembers the spot (escalatorSpots) to give it the escalator badge.
 */
export function planEscalatorPoint(input: PlanInput): Plan {
  const { state, ctx, scope, coord, source } = input;
  const near = nearestNode(state, scope, coord, SNAP_M, isWalkPoint);
  if (near) return { action: null, anchorId: input.anchorId ?? near.id, scope, featureId: near.id, notices: ['이 지점을 에스컬레이터 타는 곳으로 표시했습니다. 지점을 누르면 다른 층과 연결할 수 있습니다.'] };
  const b = builder(state, ctx);
  const id = b.node(coord, walkNode(scope, source));
  const notices: string[] = [];
  if (scope.kind === 'building') joinCorridor(b, input, id, notices);
  else notices.push('아직 바깥 길과 이어지지 않았습니다. [잇기]로 이어 주세요.');
  notices.push('에스컬레이터 타는 곳을 찍었습니다. 지점을 누르면 다른 층과 연결하고 시간을 잴 수 있습니다.');
  return { action: b.action('에스컬레이터 지점 기록'), anchorId: input.anchorId ?? id, scope, featureId: id, notices };
}

// ---- what the point's sheet shows ----

const other = (e: EditEdge, nodeId: string): string => (e.props.from === nodeId ? e.props.to : e.props.from);
const at = (state: EditState, nodeId: string, keep: (e: EditEdge) => boolean): EditEdge[] =>
  Object.values(state.edges).filter((e) => (e.props.from === nodeId || e.props.to === nodeId) && keep(e));

/** Where an edge from the point leads: a floor label, or 바깥. */
function placeOf(state: EditState, nodeId: string): string | null {
  const n = state.nodes[nodeId];
  if (!n) return null;
  const s = scopeOfNode(n);
  return s.kind === 'building' ? floorLabel(s.level) : '바깥';
}

export interface VerticalInfo {
  kind: VerticalPointKind;
  /** Where the point already leads (floor labels or 바깥), in the order of the edges; empty when it is not joined yet. */
  linked: string[];
  /** Stairs: the flights at the landing (step_count goes on them) and their step count when they all agree. */
  flights: string[];
  stepCount: number | undefined;
  /**
   * Stairs: each flight on its own — where it leads and its own step count. A landing between two floors has a flight up
   * and a flight down, and they seldom have the same number of steps, so the count is saved per flight.
   */
  flightList: { id: string; to: string; stepCount: number | undefined }[];
  /** Escalator: the belts at the point, for the stopwatch. */
  belts: string[];
}

/** What the sheet of a point says about its way to other floors, or null for a point that is none of the three. */
export function verticalInfo(state: EditState, nodeId: string, escalatorSpots: ReadonlySet<string> = new Set()): VerticalInfo | null {
  const node = state.nodes[nodeId];
  if (!node) return null;
  const type = node.props.node_type;
  if (type === 'stair_landing') {
    const flights = at(state, nodeId, (e) => e.props.highway === 'steps' && !isEscalator(e.props));
    const counts = flights.map((e) => e.props.step_count);
    return {
      kind: 'stairs',
      linked: flights.flatMap((e) => placeOf(state, other(e, nodeId)) ?? []),
      flights: flights.map((e) => e.id),
      stepCount: counts.length > 0 && counts.every((c) => c === counts[0]) ? counts[0] : undefined,
      flightList: flights.map((e) => ({ id: e.id, to: placeOf(state, other(e, nodeId)) ?? '?', stepCount: e.props.step_count })),
      belts: [],
    };
  }
  if (type === 'elevator_stop') {
    // The other stops of the same shaft (they share elevator_id), whatever joins them.
    const stops = Object.values(state.nodes).filter((n) => n.id !== nodeId && n.props.node_type === 'elevator_stop'
      && n.props.building_id === node.props.building_id && n.props.elevator_id !== undefined && n.props.elevator_id === node.props.elevator_id);
    const linked = [...new Set(stops.flatMap((n) => (n.props.level === null ? [] : [n.props.level])))].sort((a, b) => a - b).map(floorLabel);
    return { kind: 'elevator', linked, flights: [], stepCount: undefined, flightList: [], belts: [] };
  }
  const belts = at(state, nodeId, (e) => isEscalator(e.props));
  if (isWalkPoint(node) && (belts.length > 0 || escalatorSpots.has(nodeId))) {
    return { kind: 'escalator', linked: belts.flatMap((e) => placeOf(state, other(e, nodeId)) ?? []), flights: [], stepCount: undefined, flightList: [], belts: belts.map((e) => e.id) };
  }
  return null;
}

/** 계단 칸 수 on the flights at a landing (null clears it), as one action; an error when there is nothing to change. */
export function planStepCount(state: EditState, flights: readonly string[], count: number | null): Action | { error: string } {
  if (flights.length === 0) return { error: '먼저 다른 층과 연결해 주세요. 칸 수는 층 사이 계단에 적습니다.' };
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 200)) return { error: '칸 수는 1~200 사이의 정수로 적어 주세요.' };
  const change = flights.filter((id) => (state.edges[id]?.props.step_count ?? null) !== count);
  if (change.length === 0) return { error: '바뀐 내용이 없습니다.' };
  const action = compose([setProps(change, { step_count: count ?? undefined })], count === null ? '계단 칸 수 지우기' : `계단 칸 수 ${count}칸`);
  const reason = action.disabled(state);
  return reason === false ? action : { error: reason };
}
