// 계단 · 엘리베이터 · 에스컬레이터 as points put down at the crosshair (the menu's quick records), what their sheet reads,
// and the trip that joins them to another floor started from the point itself.
import { beforeAll, describe, expect, it } from 'vitest';
import { checkInvariants, createHistory, type EditState, type LoadedCampus, type Position } from '@campo/core';
import { OUTDOOR, type Scope } from '../src/model/scope.ts';
import { planEscalator, planFloorChange, type Plan, type PlanInput, type PlanOk } from '../src/survey/plans.ts';
import { planElevatorPoint, planEscalatorPoint, planStairPoint, planStepCount, verticalInfo } from '../src/survey/vertical.ts';
import { SOURCE, campusErrors, ctx, fixture } from './helpers.ts';

let start: EditState;
let loaded: LoadedCampus;
beforeAll(async () => {
  ({ state: start, loaded } = await fixture());
});

const floor = (buildingId: string, level: number): Scope => ({ kind: 'building', buildingId, level });
const input = (scope: Scope, coord: Position, anchorId: string | null, state = start): PlanInput => ({ state, ctx: ctx(), scope, coord, anchorId, source: SOURCE });
function ok(plan: Plan): PlanOk {
  if ('error' in plan) throw new Error(plan.error);
  return plan;
}
function run(plan: PlanOk, state = start): EditState {
  if (!plan.action) return state;
  expect(plan.action.disabled(state)).toBe(false);
  const after = createHistory(state).perform(plan.action);
  expect(checkInvariants(after)).toEqual([]);
  expect(campusErrors(loaded, after)).toEqual([]);
  return after;
}
const added = (after: EditState, before: EditState, kind: 'nodes' | 'edges') => Object.keys(after[kind]).filter((id) => !(id in before[kind]));

describe('계단 지점', () => {
  it('puts a landing at the crosshair on this floor, joined to the corridor, with no trip and no other floor', () => {
    const plan = ok(planStairPoint(input(floor('bldg_B', 1), [127.00135, 37.00055], 'n_B_1_hall')));
    const after = run(plan);
    const landing = after.nodes[plan.featureId]!;
    expect(landing.props).toMatchObject({ node_type: 'stair_landing', building_id: 'bldg_B', level: 1, source: SOURCE });
    expect(added(after, start, 'nodes').every((id) => after.nodes[id]!.props.level === 1)).toBe(true);
    expect(added(after, start, 'edges').map((id) => after.edges[id]!.props.highway)).not.toContain('steps');
    // The walk does not move: the point is a record beside it, like a door.
    expect(plan.anchorId).toBe('n_B_1_hall');
    expect(plan.scope).toEqual(floor('bldg_B', 1));
    expect(verticalInfo(after, landing.id)).toMatchObject({ kind: 'stairs', linked: [], flights: [] });
  });

  it('is the existing landing when there is one within two metres, and needs a floor', () => {
    const plan = ok(planStairPoint(input(floor('bldg_B', 1), [127.0013, 37.0004], null)));
    expect(plan.action).toBeNull();
    expect(plan.featureId).toBe('n_B_1_stair');
    expect(plan.notices[0]).toContain('이미 있는 계단');
    expect(planStairPoint(input(OUTDOOR, [127, 37], null))).toMatchObject({ error: expect.stringContaining('건물 안') });
  });

  it('then 다른 층과 연결 from the landing walks the flight from it, and the step count goes on that flight', () => {
    const placed = ok(planStairPoint(input(floor('bldg_B', 1), [127.00135, 37.00055], 'n_B_1_hall')));
    const s1 = run(placed);
    const landing = s1.nodes[placed.featureId]!;
    // The trip starts at the point (its own spot and floor, and the point as the walk's anchor: no extra walk edge).
    const trip = ok(planFloorChange(input(floor('bldg_B', 1), landing.coord, landing.id, s1), { kind: 'stairs', toLevel: 2, incline: 'up' }));
    const s2 = run(trip, s1);
    expect(trip.featureId).toBe(landing.id);
    expect(added(s2, s1, 'edges').map((id) => s2.edges[id]!.props.highway)).toEqual(['steps']);
    const info = verticalInfo(s2, landing.id)!;
    expect(info).toMatchObject({ kind: 'stairs', linked: ['2층'], stepCount: undefined });

    const count = planStepCount(s2, info.flights, 24);
    if ('error' in count) throw new Error(count.error);
    const s3 = createHistory(s2).perform(count);
    expect(s3.edges[info.flights[0]!]!.props.step_count).toBe(24);
    expect(verticalInfo(s3, landing.id)!.stepCount).toBe(24);
    expect(planStepCount(s3, info.flights, 24)).toEqual({ error: '바뀐 내용이 없습니다.' });
    expect(planStepCount(s3, [], 24)).toMatchObject({ error: expect.stringContaining('먼저 다른 층과 연결') });
    expect(planStepCount(s3, info.flights, 0)).toMatchObject({ error: expect.stringContaining('1~200') });
    const cleared = planStepCount(s3, info.flights, null);
    if ('error' in cleared) throw new Error(cleared.error);
    expect(createHistory(s3).perform(cleared).edges[info.flights[0]!]!.props.step_count).toBeUndefined();
  });
});

describe('엘리베이터 지점', () => {
  it('a new shaft gets the next elevator_id and one stop on this floor', () => {
    const plan = ok(planElevatorPoint(input(floor('bldg_B', 1), [127.00125, 37.00035], null)));
    const after = run(plan);
    expect(after.nodes[plan.featureId]!.props).toMatchObject({ node_type: 'elevator_stop', elevator_id: 'B_elevA', level: 1 });
    expect(verticalInfo(after, plan.featureId)).toMatchObject({ kind: 'elevator', linked: [] });
  });

  it('near a stop of the same building on another floor it is that shaft: same spot and elevator_id', () => {
    const without: EditState = { ...start, nodes: { ...start.nodes }, edges: { ...start.edges } };
    delete without.nodes['n_A_elevA_L4'];
    delete without.edges['e_A_elevA_L3__A_elevA_L4'];
    delete without.edges['e_A_4_hall__A_elevA_L4'];
    const plan = ok(planElevatorPoint(input(floor('bldg_A', 4), [127.000805, 37.000505], null, without)));
    const after = createHistory(without).perform(plan.action!);
    expect(checkInvariants(after)).toEqual([]);
    // Not joined to the other stops until it is ridden from its sheet: the checks say so, and the notice asks for the ride.
    expect(campusErrors(loaded, after).map((e) => e.split(' ')[0])).toEqual(['elevator-group-split']);
    expect(plan.notices.at(-1)).toContain('[다른 층과 연결]');
    const ride = ok(planFloorChange(input(floor('bldg_A', 4), after.nodes[plan.featureId]!.coord, plan.featureId, after), { kind: 'elevator', toLevel: 3 }));
    expect(campusErrors(loaded, run(ride, after))).toEqual([]);
    const stop = after.nodes[plan.featureId]!;
    expect(stop.props).toMatchObject({ elevator_id: 'A_elevA', level: 4 });
    expect(stop.coord).toEqual(start.nodes['n_A_elevA_L3']!.coord);
    expect(verticalInfo(after, stop.id)!.linked).toEqual(['1층', '2층', '3층']);
    // On a floor the shaft already stops at, the button finds that stop.
    expect(ok(planElevatorPoint(input(floor('bldg_A', 2), [127.0008, 37.0005], null))).featureId).toBe('n_A_elevA_L2');
  });
});

describe('에스컬레이터 지점', () => {
  it('marks a walk point where the belt is boarded; once a belt is recorded from it the sheet lists it for the stopwatch', () => {
    const plan = ok(planEscalatorPoint(input(floor('bldg_A', 1), [127.0003, 37.0007], null)));
    const s1 = run(plan);
    const spot = s1.nodes[plan.featureId]!;
    expect(spot.props.node_type).toBe('corridor');
    // Not an escalator by its data yet: the screen remembers the spot.
    expect(verticalInfo(s1, spot.id)).toBeNull();
    expect(verticalInfo(s1, spot.id, new Set([spot.id]))).toMatchObject({ kind: 'escalator', linked: [], belts: [] });

    const ride = ok(planEscalator(input(floor('bldg_A', 1), spot.coord, spot.id, s1), { arrive: { coord: [127.0004, 37.0007], scope: floor('bldg_A', 2) }, rodeUp: true, belt: 'one' }));
    const s2 = run(ride, s1);
    const info = verticalInfo(s2, spot.id)!;
    expect(info).toMatchObject({ kind: 'escalator', linked: ['2층'] });
    expect(info.belts).toEqual([ride.edgeId]);
  });

  it('outdoors it is an outdoor point, and an existing walk point within two metres is taken as it is', () => {
    const plan = ok(planEscalatorPoint(input(OUTDOOR, [126.9999, 37.0002], null)));
    expect(run(plan).nodes[plan.featureId]!.props.node_type).toBe('outdoor');
    expect(plan.notices[0]).toContain('[잇기]');
    expect(ok(planEscalatorPoint(input(OUTDOOR, [127.00021, 37.0004], null)))).toMatchObject({ action: null, featureId: 'n_out_0002' });
  });
});
