// The 엘리베이터 tool (SPEC-v0.2 6.5): one elevator_stop per checked floor at one spot with one new elevator_id,
// highway=elevator edges between neighbouring stops, and each stop joined to the corridor of its floor when there is one.
// Everything is one Plan (compose), so one Ctrl+Z takes the whole elevator back.
import { buildingById, deleteEdges, deleteNodes, type EditContext, type EditNode, type EditState, type Position } from '@campo/core';
import { NOT_CONNECTED_NOTICE, attachSteps } from './connect.ts';
import type { PlanResult, Step } from './plan.ts';
import { DRAWN_SOURCE, edgeStep, idMaker, nodeStep } from './tools.ts';

/** The next free "{code}_elev{A-Z}" of the building. */
function newElevatorId(state: EditState, code: string): string | undefined {
  const used = new Set(Object.values(state.nodes).map((n) => n.props.elevator_id));
  for (let c = 65; c <= 90; c++) {
    const id = `${code}_elev${String.fromCharCode(c)}`;
    if (!used.has(id)) return id;
  }
  return undefined;
}

/** Stops of elevator `elevatorId`, lowest level first. */
export function stopsOf(state: EditState, elevatorId: string): EditNode[] {
  return Object.values(state.nodes)
    .filter((n) => n.props.node_type === 'elevator_stop' && n.props.elevator_id === elevatorId)
    .sort((a, b) => (a.props.level ?? 0) - (b.props.level ?? 0));
}

const rideEdge = (ctx: EditContext, from: string, to: string, lo: number, hi: number): Step => edgeStep({
  kind: 'edge', highway: 'elevator', edge_type: 'indoor', step_free: true, from, to, bidirectional: true, level_from: lo, level_to: hi, source: DRAWN_SOURCE,
}, ctx);

/** A new elevator at `position` stopping at `levels`. */
export function planElevator(state: EditState, ctx: EditContext, e: { buildingId: string; position: Position; levels: number[] }): PlanResult {
  const building = buildingById(state, e.buildingId);
  if (!building) return { error: '건물 안을 눌러 주세요.' };
  const stops = building.props.levels.filter((l) => e.levels.includes(l)).sort((a, b) => a - b);
  if (stops.length < 2) return { error: '정차 층을 두 개 이상 골라 주세요.' };
  const elevatorId = newElevatorId(state, building.props.code);
  if (!elevatorId) return { error: '이 건물에는 엘리베이터를 더 만들 수 없습니다(A~Z 모두 사용 중).' };

  const newId = idMaker(state, ctx);
  const ids = stops.map((level) => newId({ building_id: building.id, level, node_type: 'elevator_stop' }));
  const steps: Step[] = stops.map((level, i) => nodeStep(ids[i]!, e.position, {
    kind: 'node', node_type: 'elevator_stop', building_id: building.id, level, elevator_id: elevatorId, source: DRAWN_SOURCE,
  }, ctx));
  for (let i = 0; i + 1 < stops.length; i++) steps.push(rideEdge(ctx, ids[i]!, ids[i + 1]!, stops[i]!, stops[i + 1]!));
  let unconnected = 0;
  for (let i = 0; i < stops.length; i++) {
    const a = attachSteps(state, ctx, ids[i]!, { building_id: building.id, level: stops[i]!, coord: e.position });
    if ('error' in a) return { error: a.error };
    steps.push(...a.steps);
    if (!a.connected) unconnected++;
  }
  return {
    annotation: `엘리베이터 추가(정차 ${stops.length}개 층)`,
    steps,
    ...(unconnected > 0 ? { notices: [NOT_CONNECTED_NOTICE] } : {}),
  };
}

/**
 * Change the floors an existing elevator stops at. Stops of unchecked floors go (with their edges), new floors get a stop at the same
 * spot, and neighbouring stops are joined again. deleteNodes' heal does not join elevator edges, so the new ride edges are made here.
 */
export function planElevatorEdit(state: EditState, ctx: EditContext, elevatorId: string, levels: number[]): PlanResult {
  const stops = stopsOf(state, elevatorId);
  const first = stops[0];
  if (!first || first.props.building_id === null) return { error: '엘리베이터를 찾을 수 없습니다.' };
  const building = buildingById(state, first.props.building_id);
  if (!building) return { error: '건물을 찾을 수 없습니다.' };
  const want = building.props.levels.filter((l) => levels.includes(l)).sort((a, b) => a - b);
  if (want.length < 2) return { error: '정차 층을 두 개 이상 골라 주세요.' };

  const byLevel = new Map(stops.map((n) => [n.props.level!, n]));
  const removed = stops.filter((n) => !want.includes(n.props.level!)).map((n) => n.id);
  const newId = idMaker(state, ctx);
  const idAt = new Map<number, string>();
  const steps: Step[] = [];
  const added: number[] = [];
  for (const level of want) {
    const kept = byLevel.get(level);
    if (kept) idAt.set(level, kept.id);
    else {
      const id = newId({ building_id: building.id, level, node_type: 'elevator_stop' });
      idAt.set(level, id);
      added.push(level);
      steps.push(nodeStep(id, first.coord, {
        kind: 'node', node_type: 'elevator_stop', building_id: building.id, level, elevator_id: elevatorId, source: DRAWN_SOURCE,
      }, ctx));
    }
  }
  if (removed.length === 0 && added.length === 0) return { error: '정차 층이 그대로입니다.' };
  if (removed.length > 0) steps.push(() => deleteNodes(removed, { heal: false }, ctx));

  // Ride edges between stops of this elevator: keep the ones that join neighbours in the new list, drop the rest, add the missing.
  const stopIds = new Set(stops.map((n) => n.id));
  const levelOf = new Map(stops.map((n) => [n.id, n.props.level!]));
  const rides = Object.values(state.edges).filter((e) => e.props.highway === 'elevator' && stopIds.has(e.props.from) && stopIds.has(e.props.to));
  const wantPair = (a: number, b: number) => want.some((l, i) => i + 1 < want.length && ((l === a && want[i + 1] === b) || (l === b && want[i + 1] === a)));
  const stale = rides.filter((e) => !wantPair(levelOf.get(e.props.from)!, levelOf.get(e.props.to)!)).map((e) => e.id);
  if (stale.length > 0) {
    steps.push((s) => {
      const left = stale.filter((id) => id in s.edges);
      return left.length > 0 ? deleteEdges(left, ctx) : null;
    });
  }
  const keptPairs = new Set(rides.filter((e) => !stale.includes(e.id)).map((e) => [levelOf.get(e.props.from)!, levelOf.get(e.props.to)!].sort((a, b) => a - b).join(',')));
  for (let i = 0; i + 1 < want.length; i++) {
    const [lo, hi] = [want[i]!, want[i + 1]!];
    if (!keptPairs.has(`${lo},${hi}`)) steps.push(rideEdge(ctx, idAt.get(lo)!, idAt.get(hi)!, lo, hi));
  }

  let unconnected = 0;
  for (const level of added) {
    const a = attachSteps(state, ctx, idAt.get(level)!, { building_id: building.id, level, coord: first.coord });
    if ('error' in a) return { error: a.error };
    steps.push(...a.steps);
    if (!a.connected) unconnected++;
  }
  return {
    annotation: `엘리베이터 정차 층 바꾸기(${want.length}개 층)`,
    steps,
    ...(unconnected > 0 ? { notices: [NOT_CONNECTED_NOTICE] } : {}),
  };
}
