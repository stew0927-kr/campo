// 층 복사 and 층 연동 in the app (survey/floors.ts): the same sync_group data as the editor, so the exported survey opens there.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyChangeset, createIdGen, metres, validateSurvey, type EditState } from '@campo/core';
import { MAGNET_M, counterparts, floorCopyTargets, isFlatIndoor, planCopyFloor, planMoveNode, planUnsync, syncedOnFloor } from '../src/survey/floors.ts';
import { planJunction } from '../src/survey/plans.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, SOURCE, campusErrors, fixture } from './helpers.ts';

let base: EditState;
let loaded: Awaited<ReturnType<typeof fixture>>['loaded'];
beforeAll(async () => {
  ({ state: base, loaded } = await fixture());
});

const newSession = () => new SurveySession({ campus: CAMPUS, base, ids: createIdGen(9), startedAt: AT });

/** Copy floor 3 of building A onto floor 4 and return the session. */
function copied() {
  const s = newSession();
  const plan = planCopyFloor(s.state, s.ctx, 'bldg_A', 3, [4]);
  if ('error' in plan) throw new Error(plan.error);
  expect(s.edit(plan.action)).toMatchObject({ warnings: expect.any(Array) });
  return { s, plan };
}

describe('planCopyFloor', () => {
  it('copies the points of the floor (corridor points, stair landing, elevator stop) and its flat corridors; the copies share the sources\' sync_group', () => {
    const before = newSession().state;
    const { s, plan } = copied();
    const after = s.state;
    const src = Object.values(before.nodes).filter((n) => n.props.building_id === 'bldg_A' && n.props.level === 3 && n.props.node_type !== 'entrance');
    expect(src.length).toBeGreaterThan(3);
    expect(plan.summary.nodesCreated + plan.summary.nodesReused).toBe(src.length);
    for (const n of src) {
      const mates = counterparts(after, after.nodes[n.id]!);
      expect(after.nodes[n.id]!.props.sync_group).toMatch(/^sg_[0-9a-z]{6}$/);
      expect(mates.get(4)?.props.sync_group).toBe(after.nodes[n.id]!.props.sync_group);
      expect(metres(mates.get(4)!.coord, n.coord)).toBeLessThanOrEqual(MAGNET_M); // a reused point keeps its own place (within the magnet)
    }
    // elevator stop of the same elevator on 4 is reused (not duplicated), and no extra stop appears
    expect(after.nodes['n_A_elevA_L4']!.props.sync_group).toBe(after.nodes['n_A_elevA_L3']!.props.sync_group);
    // flat corridors of floor 3 now also exist between the copies on floor 4
    for (const e of Object.values(before.edges).filter((e) => isFlatIndoor(before, e) && src.some((n) => n.id === e.props.from) && src.some((n) => n.id === e.props.to))) {
      const [a, b] = [counterparts(after, after.nodes[e.props.from]!).get(4)!, counterparts(after, after.nodes[e.props.to]!).get(4)!];
      expect(Object.values(after.edges).some((x) => (x.props.from === a.id && x.props.to === b.id) || (x.props.from === b.id && x.props.to === a.id))).toBe(true);
    }
    // nothing of the walk's floor changed except the sync_group property
    expect(campusErrors(loaded, after)).toEqual([]);
    expect(plan.notices[0]).toMatch(/^지점 \d+개 만듦, \d+개 재사용, 구간 \d+개 만듦\.$/);
  });

  it('is one history entry (one 되돌리기), and lists the other floors of the building as targets', () => {
    const { s } = copied();
    expect(s.canUndo).toBe(true);
    expect(s.undo()).toBe(true);
    expect(syncedOnFloor(s.state, 'bldg_A', 3)).toEqual([]);
    expect(s.state).toEqual(newSession().state);
    expect(floorCopyTargets(base, 'bldg_A', 3)).toEqual([4, 2, 1]);
  });

  it('refuses a floor with nothing to copy and no chosen target', () => {
    const s = newSession();
    expect(planCopyFloor(s.state, s.ctx, 'bldg_A', 3, [])).toEqual({ error: expect.stringContaining('다른 층') });
    expect(planCopyFloor(s.state, s.ctx, 'bldg_A', 3, [3])).toEqual({ error: expect.stringContaining('다른 층') });
    expect(planCopyFloor(s.state, s.ctx, 'bldg_NOPE', 3, [4])).toEqual({ error: expect.stringContaining('건물') });
  });

  it('copying again onto the same floor adds nothing', () => {
    const { s } = copied();
    const again = planCopyFloor(s.state, s.ctx, 'bldg_A', 3, [4]);
    if ('error' in again) throw new Error(again.error);
    expect(again.summary).toMatchObject({ nodesCreated: 0, edgesCreated: 0 });
  });
});

describe('층 연동', () => {
  it('a corridor stretch recorded between two synced points is repeated between their counterparts, in the same entry', () => {
    const { s } = copied();
    const before = s.state;
    const [bridge, north] = [before.nodes['n_A_3_bridge']!, before.nodes['n_A_3_north']!];
    const joined = (st: EditState, x: string, y: string) => Object.values(st.edges).filter((e) => (e.props.from === x && e.props.to === y) || (e.props.from === y && e.props.to === x));
    const [bridge4, north4] = [counterparts(before, bridge).get(4)!, counterparts(before, north).get(4)!];
    expect(joined(before, bridge.id, north.id)).toHaveLength(0);
    expect(joined(before, bridge4.id, north4.id)).toHaveLength(0);
    const scope3 = { kind: 'building' as const, buildingId: 'bldg_A', level: 3 };
    const plan = planJunction({ state: before, ctx: s.ctx, scope: scope3, coord: north.coord, anchorId: bridge.id, source: SOURCE }, { stepFree: true });
    if ('error' in plan) throw new Error(plan.error);
    s.run(plan);
    expect(joined(s.state, bridge.id, north.id)).toHaveLength(1);
    const twin = joined(s.state, bridge4.id, north4.id);
    expect(twin).toHaveLength(1);
    expect(twin[0]!.props).toMatchObject({ highway: 'corridor', edge_type: 'indoor', step_free: true });
    expect(campusErrors(loaded, s.state)).toEqual([]);
    s.undo();
    expect(s.state).toEqual(before);
  });

  it('moving a synced point moves its counterparts to the same coordinate; one 되돌리기 puts all back', () => {
    const { s } = copied();
    const before = s.state;
    const to: [number, number] = [before.nodes['n_A_3_north']!.coord[0] + 0.00002, before.nodes['n_A_3_north']!.coord[1]];
    const moved = planMoveNode(s.state, 'n_A_3_north', to);
    if ('error' in moved) throw new Error(moved.error);
    expect(moved.moved).toBe(2);
    s.edit(moved.action);
    const mate = counterparts(s.state, s.state.nodes['n_A_3_north']!).get(4)!;
    expect(s.state.nodes['n_A_3_north']!.coord).toEqual(to);
    expect(mate.coord).toEqual(to);
    s.undo();
    expect(s.state).toEqual(before);
    expect(planMoveNode(s.state, 'nope', to)).toEqual({ error: expect.any(String) });
  });

  it('a point that is not synced moves alone', () => {
    const s = newSession();
    const moved = planMoveNode(s.state, 'n_A_3_north', [127.0001, 37.0001]);
    if ('error' in moved) throw new Error(moved.error);
    expect(moved.moved).toBe(1);
  });

  it('연동 해제 takes the point out of its group; the other floors keep theirs; refuses a point that is not synced', () => {
    const { s } = copied();
    const group = s.state.nodes['n_A_3_north']!.props.sync_group;
    const un = planUnsync(s.state, ['n_A_3_north', 'n_out_0001']);
    if ('error' in un) throw new Error(un.error);
    expect(un.count).toBe(1);
    s.edit(un.action);
    expect(s.state.nodes['n_A_3_north']!.props.sync_group).toBeUndefined();
    expect(counterparts(s.state, s.state.nodes['n_A_3_north']!).size).toBe(0);
    expect([...Object.values(s.state.nodes)].some((n) => n.props.sync_group === group && n.props.level === 4)).toBe(true);
    // after it a corridor drawn on 3층 at that point is not mirrored (no group)
    expect(planUnsync(s.state, ['n_out_0001'])).toEqual({ error: expect.any(String) });
  });
});

describe('export compatibility', () => {
  it('the survey of a walk with a floor copy validates and applies on the base campus; the sync_group travels with the points', () => {
    const { s } = copied();
    const survey = s.toSurvey('copy-test', AT);
    expect(validateSurvey(survey)).toMatchObject({ ok: true });
    const applied = applyChangeset(survey.changeset!);
    expect(applied.disabled(base)).toBe(false);
    const result = applied.apply(base);
    expect(result.nodes['n_A_3_north']!.props.sync_group).toBe(s.state.nodes['n_A_3_north']!.props.sync_group);
    expect(Object.keys(result.nodes).sort()).toEqual(Object.keys(s.state.nodes).sort());
  });
});
