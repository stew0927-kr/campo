// 층 복사의 마그넷과 층 연동 (copy.ts, sync.ts): elevator stops and landings, joining a nearby corridor, mirrored edges, 층 연동 취소.
import { describe, expect, it } from 'vitest';
import { addEdge, addNode, checkInvariants, compose, metres, validateCampus, type EditState } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { MAGNET_M, planCopyToFloors } from '../src/model/copy.ts';
import { planElevatorEdit, stopsOf } from '../src/model/elevator.ts';
import { planDelete } from '../src/model/ops.ts';
import { isError, runPlan, type PlanResult } from '../src/model/plan.ts';
import { stateToCampus, type Session } from '../src/model/session.ts';
import { counterparts, planUnsync, syncedIn, withSyncMirror } from '../src/model/sync.ts';
import { planConnect } from '../src/model/tools.ts';

const run = (s: Session, plan: PlanResult): EditState => {
  if (isError(plan)) throw new Error(plan.error);
  const r = runPlan(s.history, plan);
  if (!r.ok) throw new Error(r.reason);
  return s.history.current();
};
const corridor = (level: number) => ({ kind: 'node' as const, node_type: 'corridor' as const, building_id: 'bldg_A', level, source: 'estimate' });
const hallway = (from: string, to: string) => ({ kind: 'edge' as const, highway: 'corridor' as const, edge_type: 'indoor' as const, from, to, bidirectional: true, step_free: null, source: 'estimate' });
const between = (s: EditState, a: string, b: string) => Object.values(s.edges).filter((e) => [e.props.from, e.props.to].includes(a) && [e.props.from, e.props.to].includes(b));
const errorsOf = (s: Session, state: EditState) => validateCampus(stateToCampus(state, s.meta, s.passthrough, s.extras)).errors;

describe('층 복사: 엘리베이터 정차 지점과 계단참', () => {
  it('makes the elevator stop on a floor the elevator passed by, keeps elevator_id and joins it into the ride', () => {
    const s = fixtureSession(11);
    run(s, planElevatorEdit(s.history.current(), s.ctx, 'A_elevA', [1, 3, 4])); // 2층 has no stop now: the ride goes 1 → 3
    const before = s.history.current();
    expect(stopsOf(before, 'A_elevA').map((n) => n.props.level)).toEqual([1, 3, 4]);
    expect(between(before, 'n_A_elevA_L1', 'n_A_elevA_L3')).toHaveLength(1);

    const plan = planCopyToFloors(before, s.ctx, ['n_A_3_hall', 'n_A_elevA_L3', 'e_A_3_hall__A_elevA_L3'], [2]);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.summary).toMatchObject({ nodesCreated: 1, nodesReused: 1, edgesCreated: 1, stopsCreated: 1 });
    const after = run(s, plan);
    const stop = stopsOf(after, 'A_elevA').find((n) => n.props.level === 2)!;
    expect(stop.props).toMatchObject({ node_type: 'elevator_stop', elevator_id: 'A_elevA', building_id: 'bldg_A', level: 2 });
    expect(stop.coord).toEqual(after.nodes['n_A_elevA_L1']!.coord);
    // 1 → 2 → 3 instead of 1 → 3, and the corridor of 2층 reaches the stop
    expect(between(after, 'n_A_elevA_L1', 'n_A_elevA_L3')).toHaveLength(0);
    expect(between(after, 'n_A_elevA_L1', stop.id)[0]!.props).toMatchObject({ highway: 'elevator', level_from: 1, level_to: 2 });
    expect(between(after, stop.id, 'n_A_elevA_L3')[0]!.props).toMatchObject({ highway: 'elevator', level_from: 2, level_to: 3 });
    expect(between(after, 'n_A_2_hall', stop.id)[0]!.props.highway).toBe('corridor');
    expect(checkInvariants(after)).toEqual([]);
    expect(errorsOf(s, after)).toEqual(errorsOf(s, before));
    expect(s.history.undo()).toEqual(before); // one entry
  });

  it('reuses a landing within the magnet and makes one where the floor has none there', () => {
    const s = fixtureSession(12);
    const before = s.history.current();
    // 3층's landing is 1.1m from 4층's and 2.2m from 1층's
    expect(metres(before.nodes['n_A_3_stair']!.coord, before.nodes['n_A_4_stair']!.coord)).toBeLessThan(MAGNET_M);
    expect(metres(before.nodes['n_A_3_stair']!.coord, before.nodes['n_A_1_stair']!.coord)).toBeGreaterThan(MAGNET_M);
    const plan = planCopyToFloors(before, s.ctx, ['n_A_3_hall', 'n_A_3_stair', 'e_A_3_hall__A_3_stair'], [4, 1]);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.summary).toMatchObject({ nodesCreated: 1, nodesReused: 3, edgesCreated: 1, edgesExisting: 1, landingsCreated: 1 });
    expect(plan.notices!.join(' ')).toContain('계단 도구로 이어 주세요');
    const after = run(s, plan);
    const made = Object.values(after.nodes).filter((n) => !(n.id in before.nodes));
    expect(made.map((n) => [n.props.node_type, n.props.level])).toEqual([['stair_landing', 1]]);
    expect(between(after, 'n_A_1_hall', made[0]!.id)).toHaveLength(1);
  });
});

describe('층 복사: 마그넷', () => {
  /** 2층 gets a corridor running west → east 1m south of where 3층's bridge point is. */
  function withCorridorOn2(s: Session): EditState {
    const [x, y] = s.history.current().nodes['n_A_3_bridge']!.coord;
    const south = y - 1 / 111_320;
    s.history.perform(compose([
      addNode({ id: 'n_A_2_w', coord: [x - 0.0001, south], props: corridor(2) }),
      addNode({ id: 'n_A_2_e', coord: [x + 0.0001, south], props: corridor(2) }),
      addEdge({ id: 'e_A_2_w__A_2_e', props: hallway('n_A_2_w', 'n_A_2_e') }),
    ], '복도'));
    return s.history.current();
  }

  it('puts a copy that lands beside a corridor edge onto it (the edge is split there)', () => {
    const s = fixtureSession(13);
    const before = withCorridorOn2(s);
    const plan = planCopyToFloors(before, s.ctx, ['n_A_3_hall', 'n_A_3_bridge', 'e_A_3_hall__A_3_bridge'], [2]);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.summary).toMatchObject({ nodesCreated: 1, nodesReused: 1, edgesCreated: 1, snapped: 1 });
    const after = run(s, plan);
    const copy = Object.values(after.nodes).find((n) => !(n.id in before.nodes))!;
    // on the corridor: the same latitude as its ends, and the old edge is now two pieces through the copy
    expect(copy.coord[1]).toBeCloseTo(before.nodes['n_A_2_w']!.coord[1], 7);
    expect(metres(copy.coord, before.nodes['n_A_3_bridge']!.coord)).toBeLessThanOrEqual(MAGNET_M);
    expect(between(after, 'n_A_2_w', 'n_A_2_e')).toHaveLength(0);
    expect(between(after, 'n_A_2_w', copy.id)).toHaveLength(1);
    expect(between(after, copy.id, 'n_A_2_e')).toHaveLength(1);
    expect(between(after, 'n_A_2_hall', copy.id)).toHaveLength(1);
    expect(checkInvariants(after)).toEqual([]);
    expect(s.history.undo()).toEqual(before);
  });

  it('merges onto a point of the same kind within 1.5m, and not onto one farther away', () => {
    const s = fixtureSession(14);
    const [x, y] = s.history.current().nodes['n_A_3_bridge']!.coord;
    s.history.perform(compose([
      addNode({ id: 'n_A_2_near', coord: [x, y + 1.2 / 111_320], props: corridor(2) }),
      addNode({ id: 'n_A_1_far', coord: [x, y + 1.8 / 111_320], props: corridor(1) }),
    ], '지점'));
    const before = s.history.current();
    const plan = planCopyToFloors(before, s.ctx, ['n_A_3_bridge'], [2, 1]);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.summary).toMatchObject({ nodesCreated: 1, nodesReused: 1 });
    const after = run(s, plan);
    const group = after.nodes['n_A_3_bridge']!.props.sync_group;
    expect(after.nodes['n_A_2_near']!.props.sync_group).toBe(group);
    expect(after.nodes['n_A_1_far']!.props.sync_group).toBeUndefined();
  });

  it('joinSync: false reuses the point but leaves it out of the group', () => {
    const s = fixtureSession(15);
    const before = s.history.current();
    const plan = planCopyToFloors(before, s.ctx, ['n_A_3_hall', 'n_A_3_bridge', 'e_A_3_hall__A_3_bridge'], [4], { joinSync: false });
    const after = run(s, plan);
    expect(after.nodes['n_A_4_hall']!.props.sync_group).toBeUndefined();
    const copy = Object.values(after.nodes).find((n) => !(n.id in before.nodes))!;
    expect(copy.props.sync_group).toBe(after.nodes['n_A_3_bridge']!.props.sync_group);
  });
});

describe('층 연동: 구간 자동 적용 (withSyncMirror)', () => {
  /** 3층's hall, bridge and north points copied to 2층 and 4층, without the edges between bridge and north. */
  function synced(seed: number) {
    const s = fixtureSession(seed);
    const start = run(s, planCopyToFloors(s.history.current(), s.ctx, ['n_A_3_hall', 'n_A_3_bridge', 'n_A_3_north'], [2, 4]));
    const twin = (id: string, level: number) => counterparts(start, start.nodes[id]!).get(level)!.id;
    return { s, start, twin };
  }

  it('an edge added between two synced points is added on every other floor in the same entry; one undo takes all back', () => {
    const { s, start, twin } = synced(21);
    const plan = withSyncMirror(start, s.ctx, planConnect(start, s.ctx, 'n_A_3_bridge', 'n_A_3_north'));
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.notices).toContain('연동된 다른 층에도 구간 2개를 만들었습니다.');
    const size = s.history.size();
    const after = run(s, plan);
    expect(s.history.size()).toBe(size + 1);
    expect(between(after, 'n_A_3_bridge', 'n_A_3_north')).toHaveLength(1);
    for (const level of [2, 4]) {
      const [e] = between(after, twin('n_A_3_bridge', level), twin('n_A_3_north', level));
      expect(e!.props).toMatchObject({ highway: 'corridor', edge_type: 'indoor', rev: 1 });
      expect(after.nodes[e!.props.from]!.props.level).toBe(level);
    }
    expect(Object.keys(after.edges)).toHaveLength(Object.keys(start.edges).length + 3);
    expect(checkInvariants(after)).toEqual([]);
    expect(s.history.undo()).toEqual(start);
  });

  it('does not make an edge the other floor already has', () => {
    const { s, start, twin } = synced(22);
    s.history.perform(addEdge({ id: 'e_A_4_own', props: hallway(twin('n_A_3_bridge', 4), twin('n_A_3_north', 4)) }));
    const before = s.history.current();
    const after = run(s, withSyncMirror(before, s.ctx, planConnect(before, s.ctx, 'n_A_3_bridge', 'n_A_3_north')));
    expect(between(after, twin('n_A_3_bridge', 4), twin('n_A_3_north', 4)).map((e) => e.id)).toEqual(['e_A_4_own']);
    expect(between(after, twin('n_A_3_bridge', 2), twin('n_A_3_north', 2))).toHaveLength(1);
  });

  it('deleting the edge deletes it on the other floors; deleting a point does not', () => {
    const { s, start, twin } = synced(23);
    const joined = run(s, withSyncMirror(start, s.ctx, planConnect(start, s.ctx, 'n_A_3_bridge', 'n_A_3_north')));
    const edge = between(joined, 'n_A_3_bridge', 'n_A_3_north')[0]!;
    const plan = withSyncMirror(joined, s.ctx, planDelete(joined, s.ctx, [edge.id], false), [edge.id]);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.notices).toContain('연동된 다른 층의 구간 2개도 지웠습니다.');
    const after = run(s, plan);
    for (const level of [2, 4]) expect(between(after, twin('n_A_3_bridge', level), twin('n_A_3_north', level))).toHaveLength(0);
    expect(s.history.undo()).toEqual(joined);

    // a deleted point takes its own edges along, but its counterparts and their edges stay
    const gone = run(s, withSyncMirror(joined, s.ctx, planDelete(joined, s.ctx, [twin('n_A_3_north', 2)], false)));
    expect(between(gone, twin('n_A_3_bridge', 4), twin('n_A_3_north', 4))).toHaveLength(1);
    expect(between(gone, 'n_A_3_bridge', 'n_A_3_north')).toHaveLength(1);
  });

  it('leaves a plan alone when its ends are not both synced, and a failing plan fails the same way', () => {
    const { s, start } = synced(24);
    const plain = planConnect(start, s.ctx, 'n_A_3_bridge', 'n_A_3_stair'); // the landing has no group
    expect(withSyncMirror(start, s.ctx, plain)).toBe(plain);
    const error = { error: '안 됩니다.' };
    expect(withSyncMirror(start, s.ctx, error)).toBe(error);
  });

  it('층 연동 취소 takes the point out: later edges are no longer mirrored to or from it', () => {
    const { s, start, twin } = synced(25);
    expect(syncedIn(start, ['n_A_3_bridge', 'n_A_3_stair', 'e_A_3_hall__A_3_bridge'])).toEqual(['n_A_3_bridge']);
    expect(planUnsync(start, ['n_A_3_stair'])).toEqual({ error: '층 연동된 지점이 아닙니다.' });
    const bridge2 = twin('n_A_3_bridge', 2);
    const apart = run(s, planUnsync(start, [bridge2]));
    expect('sync_group' in apart.nodes[bridge2]!.props).toBe(false);
    expect(apart.nodes['n_A_3_bridge']!.props.sync_group).toBeDefined(); // the other floors stay linked
    const after = run(s, withSyncMirror(apart, s.ctx, planConnect(apart, s.ctx, 'n_A_3_bridge', 'n_A_3_north')));
    expect(between(after, bridge2, twin('n_A_3_north', 2))).toHaveLength(0);
    expect(between(after, twin('n_A_3_bridge', 4), twin('n_A_3_north', 4))).toHaveLength(1);
    s.history.undo();
    expect(s.history.undo()).toEqual(start); // 층 연동 취소 is one entry too
  });
});
