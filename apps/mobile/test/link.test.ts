// 잇기 · 외부 길 and 에스컬레이터 as plans of core actions.
import { beforeAll, describe, expect, it } from 'vitest';
import { addNode, checkInvariants, createHistory, isEscalator, type EditState, type LoadedCampus, type Position } from '@campo/core';
import { OUTDOOR, type Scope } from '../src/model/scope.ts';
import { planEscalator, planLink, unattachedOnFloor, type Plan, type PlanInput, type PlanOk } from '../src/survey/plans.ts';
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

describe('잇기', () => {
  it('with no point yet only puts down the first one, then links the next', () => {
    const first = ok(planLink(input(OUTDOOR, [126.9995, 37.0008], null)));
    expect(first.edgeId).toBeUndefined();
    expect(first.notices[0]).toContain('시작 지점');
    const s1 = run(first);
    const second = ok(planLink(input(OUTDOOR, [126.9994, 37.0009], first.anchorId, s1), { stepFree: null }));
    const s2 = run(second, s1);
    expect(s2.edges[second.edgeId!]!.props).toMatchObject({ highway: 'footway', edge_type: 'outdoor', from: first.anchorId, to: second.anchorId });
  });

  it('외부 길 records outdoor steps and ramps', () => {
    const steps = ok(planLink(input(OUTDOOR, [126.9997, 37.0006], 'n_out_0004'), { stepFree: true, kind: 'steps' }));
    expect(run(steps).edges[steps.edgeId!]!.props).toMatchObject({ highway: 'steps', edge_type: 'outdoor', step_free: false });
    const ramp = ok(planLink(input(OUTDOOR, [126.9997, 37.0006], 'n_out_0004'), { stepFree: true, kind: 'ramp' }));
    expect(run(ramp).edges[ramp.edgeId!]!.props).toMatchObject({ highway: 'ramp', edge_type: 'outdoor', step_free: true });
  });

  it('indoors refuses steps (those are floor changes) and links ramps as indoor ramps', () => {
    expect('error' in planLink(input(floor('bldg_B', 2), [127.00135, 37.00055], 'n_B_2_hall'), { stepFree: null, kind: 'steps' })).toBe(true);
    const ramp = ok(planLink(input(floor('bldg_B', 2), [127.00135, 37.00055], 'n_B_2_hall'), { stepFree: null, kind: 'ramp' }));
    expect(run(ramp).edges[ramp.edgeId!]!.props).toMatchObject({ highway: 'ramp', edge_type: 'indoor' });
  });

  it('a new corridor picks up a door that was waiting for one, in the same history entry', () => {
    // A door on B 2F far from every corridor: it waits.
    const door = addNode({ id: 'n_B_2_lonely', coord: [127.00138, 37.00035], props: { kind: 'node', node_type: 'door', building_id: 'bldg_B', level: 2, room_ref: '209', source: SOURCE } });
    const withDoor = createHistory(start).perform(door);
    expect(unattachedOnFloor(withDoor, 'bldg_B', 2).map((n) => n.id)).toContain('n_B_2_lonely');
    // Walk a corridor from the stair landing past the door.
    const plan = ok(planLink(input(floor('bldg_B', 2), [127.00138, 37.00032], 'n_B_2_stair', withDoor)));
    expect(plan.notices.join(' ')).toContain('1개를 이 복도에 이었습니다');
    const after = run(plan, withDoor);
    expect(unattachedOnFloor(after, 'bldg_B', 2).map((n) => n.id)).not.toContain('n_B_2_lonely');
    // One undo takes both the corridor and the door's link back.
    const h = createHistory(withDoor);
    h.perform(plan.action!);
    h.undo();
    expect(h.current()).toStrictEqual(withDoor);
  });
});

describe('에스컬레이터', () => {
  it('rides up from 1F to 2F: one belt drawn lower → upper, conveying forward, one way', () => {
    const plan = ok(planEscalator(input(floor('bldg_A', 1), [127.00075, 37.00062], null), {
      arrive: { coord: [127.00075, 37.00068], scope: floor('bldg_A', 2) }, rodeUp: true, belt: 'one',
    }));
    const after = run(plan);
    const belts = added(after, start, 'edges').map((id) => after.edges[id]!).filter((e) => isEscalator(e.props));
    expect(belts).toHaveLength(1);
    expect(belts[0]!.props).toMatchObject({ highway: 'steps', conveying: 'forward', bidirectional: false, step_free: false, level_from: 1, level_to: 2, from: plan.featureId, to: plan.anchorId });
    expect(plan.scope).toEqual(floor('bldg_A', 2));
    expect(plan.edgeId).toBe(belts[0]!.id);
    expect(plan.edgeReversed).toBe(false);
  });

  it('riding down still draws lower → upper, with the belt running backward; the pair makes both', () => {
    const down = ok(planEscalator(input(floor('bldg_A', 2), [127.00075, 37.00068], null), {
      arrive: { coord: [127.00075, 37.00062], scope: floor('bldg_A', 1) }, rodeUp: false, belt: 'pair',
    }));
    const after = run(down);
    const belts = added(after, start, 'edges').map((id) => after.edges[id]!);
    expect(belts.map((e) => e.props.conveying).sort()).toEqual(['backward', 'forward']);
    for (const e of belts) expect(e.props).toMatchObject({ from: down.anchorId, to: down.featureId, level_from: 1, level_to: 2 });
    expect(after.edges[down.edgeId!]!.props.conveying).toBe('backward');
    expect(down.edgeReversed).toBe(true);
  });

  it('follows an escalator that is already there instead of drawing another', () => {
    const plan = ok(planEscalator(input(floor('bldg_A', 1), [127.0006, 37.00056], null), {
      arrive: { coord: [127.0006, 37.00062], scope: floor('bldg_A', 2) }, rodeUp: true, belt: 'pair',
    }));
    expect(plan.action).toBeNull();
    expect(plan.edgeId).toBe('e_A_1_esc__A_2_esc_up');
    expect(plan.notices[0]).toContain('이미 있는');
  });

  it('refuses a ride that ends on the same floor or in another building', () => {
    const same = planEscalator(input(floor('bldg_A', 1), [127.00075, 37.00062], null), { arrive: { coord: [127.0007, 37.0006], scope: floor('bldg_A', 1) }, rodeUp: true, belt: 'one' });
    expect('error' in same).toBe(true);
    const other = planEscalator(input(floor('bldg_A', 1), [127.00075, 37.00062], null), { arrive: { coord: [127.0012, 37.0005], scope: floor('bldg_B', 2) }, rodeUp: true, belt: 'one' });
    expect('error' in other).toBe(true);
  });
});
