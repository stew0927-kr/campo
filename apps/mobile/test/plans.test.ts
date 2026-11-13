// The five record buttons as plans of core actions (docs/mobile/SPEC-mobile.md 2).
import { beforeAll, describe, expect, it } from 'vitest';
import { checkInvariants, createHistory, edgesAt, type EditState, type LoadedCampus, type Position } from '@campo/core';
import { OUTDOOR, type Scope } from '../src/model/scope.ts';
import {
  NOT_CONNECTED_NOTICE, planDoor, planFloorChange, planJunction, planPortal, planStart, type Plan, type PlanInput, type PlanOk,
} from '../src/survey/plans.ts';
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
function errorOf(plan: Plan): string {
  if (!('error' in plan)) throw new Error('expected the plan to be refused');
  return plan.error;
}
/** Run the plan and check the result is still a valid campus. */
function run(plan: PlanOk, state = start): EditState {
  if (!plan.action) return state;
  expect(plan.action.disabled(state)).toBe(false);
  const after = createHistory(state).perform(plan.action);
  expect(checkInvariants(after)).toEqual([]);
  expect(campusErrors(loaded, after)).toEqual([]);
  return after;
}
const added = (after: EditState, kind: 'nodes' | 'edges') => Object.keys(after[kind]).filter((id) => !(id in start[kind]));

describe('출발점 지정', () => {
  it('makes a point on empty ground and starts the walk there', () => {
    const plan = ok(planStart(input(OUTDOOR, [126.9999, 37.0002], null)));
    const after = run(plan);
    expect(added(after, 'nodes')).toEqual([plan.anchorId]);
    expect(after.nodes[plan.anchorId]!.props).toMatchObject({ node_type: 'outdoor', building_id: null, level: null, source: SOURCE, rev: 1 });
    expect(added(after, 'edges')).toEqual([]);
  });

  it('takes an existing point within two metres instead, and changes nothing', () => {
    const plan = ok(planStart(input(OUTDOOR, [127.00021, 37.0004], null)));
    expect(plan.action).toBeNull();
    expect(plan.anchorId).toBe('n_out_0002');
  });

  it('never takes a point of another floor at the same spot', () => {
    // n_A_1_hall, n_A_2_hall, n_A_3_hall and n_A_4_hall all sit at this coordinate.
    const plan = ok(planStart(input(floor('bldg_A', 3), [127.0006, 37.0005], null)));
    expect(plan.anchorId).toBe('n_A_3_hall');
  });
});

describe('갈림길 기록', () => {
  it('adds a point and joins it to the point recorded before', () => {
    const plan = ok(planJunction(input(OUTDOOR, [126.9997, 37.0006], 'n_out_0004'), { stepFree: true }));
    const after = run(plan);
    const [edgeId] = added(after, 'edges');
    expect(after.edges[edgeId!]!.props).toMatchObject({
      highway: 'footway', edge_type: 'outdoor', from: 'n_out_0004', to: plan.anchorId, bidirectional: true, step_free: true, source: SOURCE,
    });
  });

  it('indoors the stretch is a corridor of that floor, with step_free not known unless it was looked at', () => {
    const plan = ok(planJunction(input(floor('bldg_B', 2), [127.00135, 37.00055], 'n_B_2_hall')));
    const after = run(plan);
    expect(after.nodes[plan.anchorId]!.props).toMatchObject({ node_type: 'corridor', building_id: 'bldg_B', level: 2 });
    expect(after.edges[added(after, 'edges')[0]!]!.props).toMatchObject({ highway: 'corridor', edge_type: 'indoor', step_free: null });
  });

  it('joins onto an existing point, and adds no second edge where one is already there', () => {
    const joined = ok(planJunction(input(OUTDOOR, [127.0003, 37.0007], 'n_out_0004')));
    expect(joined.anchorId).toBe('n_out_0003');
    expect(added(run(joined), 'nodes')).toEqual([]);
    expect(added(run(joined), 'edges')).toHaveLength(1);

    const walked = ok(planJunction(input(OUTDOOR, [127.0002, 37.0004], 'n_out_0004')));
    expect(walked.action).toBeNull();
    expect(walked.anchorId).toBe('n_out_0002');
  });

  it('refuses the same spot twice, and a previous point on another floor', () => {
    expect(errorOf(planJunction(input(OUTDOOR, [127.0002, 37.0004], 'n_out_0002')))).toContain('같은 자리');
    expect(errorOf(planJunction(input(floor('bldg_A', 2), [127.0005, 37.0005], 'n_A_1_hall')))).toContain('다른 층');
    expect(errorOf(planJunction(input(OUTDOOR, [127.0003, 37.0004], 'n_A_1_main')))).toContain('포탈');
  });
});

describe('문/강의실 번호', () => {
  it('adds the door with its room number and joins it to the nearest corridor of the floor', () => {
    const plan = ok(planDoor(input(floor('bldg_B', 2), [127.00127, 37.0005], 'n_B_2_hall'), { roomRef: ' 202 ', doorRole: 'front' }));
    const after = run(plan);
    expect(after.nodes[plan.featureId]!.props).toMatchObject({ node_type: 'door', room_ref: '202', door_role: 'front', building_id: 'bldg_B', level: 2, source: SOURCE });
    const links = edgesAt(after, plan.featureId);
    expect(links).toHaveLength(1);
    expect(links[0]!.props).toMatchObject({ highway: 'corridor', edge_type: 'indoor', source: SOURCE });
    expect(plan.notices).toEqual([]);
    expect(plan.anchorId).toBe('n_B_2_hall'); // the walk stays in the corridor
  });

  it('with no corridor near, keeps the door alone and says so', () => {
    const plan = ok(planDoor(input(floor('bldg_C', 5), [127.00095, 37.00118], null), { roomRef: '', doorRole: 'front' }));
    const after = run(plan);
    expect(edgesAt(after, plan.featureId)).toEqual([]);
    expect(after.nodes[plan.featureId]!.props.room_ref).toBeUndefined();
    expect(plan.notices).toEqual([NOT_CONNECTED_NOTICE]);
  });

  it('is refused outdoors', () => {
    expect(errorOf(planDoor(input(OUTDOOR, [127, 37], null), { roomRef: '101', doorRole: 'front' }))).toContain('건물 안');
  });
});

describe('계단/EV 층 변경', () => {
  it('new stairs: a landing on both floors at one spot, a steps edge between them, and the walk goes on upstairs', () => {
    const spot: Position = [127.00135, 37.00055];
    const plan = ok(planFloorChange(input(floor('bldg_B', 1), spot, 'n_B_1_hall'), { kind: 'stairs', toLevel: 2, incline: 'up' }));
    const after = run(plan);
    const [from, to] = [after.nodes[plan.featureId]!, after.nodes[plan.anchorId]!];
    expect(from.props).toMatchObject({ node_type: 'stair_landing', building_id: 'bldg_B', level: 1 });
    expect(to.props).toMatchObject({ node_type: 'stair_landing', building_id: 'bldg_B', level: 2 });
    expect(to.coord).toEqual(from.coord);
    expect(after.edges[plan.edgeId!]!.props).toMatchObject({
      highway: 'steps', edge_type: 'indoor', from: from.id, to: to.id, level_from: 1, level_to: 2, incline: 'up', step_free: false, bidirectional: true,
    });
    expect(plan.scope).toEqual(floor('bldg_B', 2));
    expect(plan.edgeReversed).toBe(false);
    // the landing is joined to the corridor point the surveyor came from
    expect(edgesAt(after, from.id).map((e) => e.props.highway).sort()).toEqual(['corridor', 'steps']);
  });

  it('existing stairs are walked, not drawn again; walked downwards the edge runs against the walk', () => {
    const up = ok(planFloorChange(input(floor('bldg_B', 1), [127.0013, 37.0004], 'n_B_1_stair'), { kind: 'stairs', toLevel: 2 }));
    expect(up).toMatchObject({ action: null, edgeId: 'e_B_1_stair__B_2_stair', edgeReversed: false, anchorId: 'n_B_2_stair', featureId: 'n_B_1_stair' });
    const down = ok(planFloorChange(input(floor('bldg_B', 2), [127.0013, 37.00041], 'n_B_2_stair'), { kind: 'stairs', toLevel: 1 }));
    expect(down).toMatchObject({ action: null, edgeId: 'e_B_1_stair__B_2_stair', edgeReversed: true, anchorId: 'n_B_1_stair' });
  });

  it('stairs are recorded one floor at a time', () => {
    expect(errorOf(planFloorChange(input(floor('bldg_A', 1), [127.0005, 37.0006], null), { kind: 'stairs', toLevel: 3 }))).toContain('한 층씩');
    expect(errorOf(planFloorChange(input(floor('bldg_A', 1), [127.0005, 37.0006], null), { kind: 'stairs', toLevel: 1 }))).toContain('도착한 층');
    expect(errorOf(planFloorChange(input(OUTDOOR, [127, 37], null), { kind: 'stairs', toLevel: 2 }))).toContain('건물 안');
  });

  it('a new elevator: two stops at one spot with one new elevator_id and an elevator edge', () => {
    const plan = ok(planFloorChange(input(floor('bldg_B', 1), [127.00125, 37.00035], 'n_B_1_hall'), { kind: 'elevator', toLevel: 2 }));
    const after = run(plan);
    const [from, to] = [after.nodes[plan.featureId]!, after.nodes[plan.anchorId]!];
    expect(from.props).toMatchObject({ node_type: 'elevator_stop', elevator_id: 'B_elevA', level: 1 });
    expect(to.props).toMatchObject({ node_type: 'elevator_stop', elevator_id: 'B_elevA', level: 2 });
    expect(to.coord).toEqual(from.coord);
    expect(after.edges[plan.edgeId!]!.props).toMatchObject({ highway: 'elevator', step_free: true, level_from: 1, level_to: 2 });
  });

  it('riding an existing elevator past a floor adds no direct edge between stops it already joins', () => {
    const plan = ok(planFloorChange(input(floor('bldg_A', 1), [127.00081, 37.0005], 'n_A_elevA_L1'), { kind: 'elevator', toLevel: 4 }));
    expect(plan.action).toBeNull();
    expect(plan.anchorId).toBe('n_A_elevA_L4');
    expect(plan.edgeId).toBeUndefined();
  });

  it('a new stop of an existing elevator takes the shaft\'s spot and elevator_id', () => {
    // Take the L4 stop away first, then ride from 3 to 4 a little off the shaft.
    const without: EditState = { ...start, nodes: { ...start.nodes }, edges: { ...start.edges } };
    delete without.nodes['n_A_elevA_L4'];
    delete without.edges['e_A_elevA_L3__A_elevA_L4'];
    delete without.edges['e_A_4_hall__A_elevA_L4'];
    const plan = ok(planFloorChange(input(floor('bldg_A', 3), [127.000805, 37.000505], 'n_A_3_hall', without), { kind: 'elevator', toLevel: 4 }));
    const after = createHistory(without).perform(plan.action!);
    expect(checkInvariants(after)).toEqual([]);
    expect(plan.featureId).toBe('n_A_elevA_L3');
    expect(after.nodes[plan.anchorId]!.props).toMatchObject({ elevator_id: 'A_elevA', level: 4 });
    expect(after.nodes[plan.anchorId]!.coord).toEqual(start.nodes['n_A_elevA_L3']!.coord);
  });
});

describe('포탈', () => {
  it('going in: an entrance on the chosen floor, a portal edge to the point walked from, and the walk continues inside', () => {
    const plan = ok(planPortal(input(OUTDOOR, [127.0011, 37.00055], 'n_out_0006'), { buildingId: 'bldg_B', level: 2, stepFree: true }));
    const after = run(plan);
    expect(after.nodes[plan.featureId]!.props).toMatchObject({ node_type: 'entrance', building_id: 'bldg_B', level: 2 });
    expect(after.edges[added(after, 'edges')[0]!]!.props).toMatchObject({
      highway: 'footway', edge_type: 'portal', from: plan.featureId, to: 'n_out_0006', step_free: true,
    });
    expect(plan.scope).toEqual(floor('bldg_B', 2));
    expect(plan.anchorId).toBe(plan.featureId);
  });

  it('going out: the entrance is joined to the corridor walked along and to the nearest outdoor point', () => {
    const plan = ok(planPortal(input(floor('bldg_A', 3), [127.00038, 37.0007], 'n_A_3_hall'), { buildingId: 'ignored', level: 99, stepFree: null }));
    const after = run(plan);
    expect(after.nodes[plan.featureId]!.props).toMatchObject({ node_type: 'entrance', building_id: 'bldg_A', level: 3 });
    expect(plan.scope).toEqual(OUTDOOR);
    expect(plan.anchorId).toBe('n_out_0003');
    expect(edgesAt(after, plan.featureId).map((e) => e.props.edge_type).sort()).toEqual(['indoor', 'portal']);
  });

  it('going out with no outdoor point near makes one at the door', () => {
    const plan = ok(planPortal(input(floor('bldg_C', 5), [127.001, 37.0012], 'n_C_5_east'), { buildingId: 'bldg_C', level: 5, stepFree: null }));
    const after = run(plan);
    expect(after.nodes[plan.anchorId]!.props).toMatchObject({ node_type: 'outdoor', building_id: null, level: null });
    expect(added(after, 'nodes')).toHaveLength(2);
  });

  it('an entrance that is already joined is only walked through', () => {
    const plan = ok(planPortal(input(OUTDOOR, [127.0004, 37.0004], 'n_out_0002'), { buildingId: 'bldg_A', level: 1, stepFree: null }));
    expect(plan.action).toBeNull();
    expect(plan.anchorId).toBe('n_A_1_main');
  });

  it('needs a real building and floor', () => {
    expect(errorOf(planPortal(input(OUTDOOR, [127, 37], null), { buildingId: 'bldg_B', level: 7, stepFree: null }))).toContain('건물과 층');
  });
});
