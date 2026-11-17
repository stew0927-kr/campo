// 끊긴 지점 찾기 (broken.ts): isolated points, islands, points left beside a way, and 가까운 길에 자동 연결.
import { describe, expect, it } from 'vitest';
import { addEdge, addNode, checkInvariants, compose, type EditState, type Position } from '@campo/core';
import { NEAR_M, brokenByLevel, brokenCountIn, brokenIds, findBroken, nextBroken, planConnectNear } from '../src/model/broken.ts';
import { isError, runPlan } from '../src/model/plan.ts';
import { OUTDOOR } from '../src/model/scope.ts';
import { fixtureSession } from './fixture.ts';

const north = (m: number) => m / 111_320;
const corridor = (id: string, coord: Position, level = 2, building = 'bldg_B') =>
  addNode({ id, coord, props: { kind: 'node', node_type: 'corridor', building_id: building, level, source: 'estimate' } });
const hallway = (id: string, from: string, to: string) =>
  addEdge({ id, props: { kind: 'edge', highway: 'corridor', edge_type: 'indoor', from, to, bidirectional: true, step_free: null, source: 'estimate' } });
const between = (s: EditState, a: string, b: string) => Object.values(s.edges).filter((e) => [e.props.from, e.props.to].includes(a) && [e.props.from, e.props.to].includes(b));

/** B동 2층's corridor runs west → east from n_B_2_bridge to n_B_2_hall (8.9m). */
function floor() {
  const s = fixtureSession(31);
  const base = s.history.current();
  const [w, e] = [base.nodes['n_B_2_bridge']!.coord, base.nodes['n_B_2_hall']!.coord];
  const mid: Position = [(w[0] + e[0]) / 2, w[1]];
  return { s, base, mid };
}

describe('findBroken', () => {
  it('finds nothing in the fixture: every point is joined, also the elevator stop 18m down the hall from its corridor point', () => {
    expect(findBroken(fixtureSession().history.current())).toEqual([]);
  });

  it('an isolated point beside a way says so; a point 1.6m away is only isolated', () => {
    const { s, mid } = floor();
    s.history.perform(compose([corridor('n_B_2_lone', [mid[0], mid[1] - north(1.2)]), corridor('n_B_2_far', [mid[0], mid[1] - north(4)])], '지점'));
    const items = findBroken(s.history.current());
    const lone = items.find((i) => i.nodeId === 'n_B_2_lone')!;
    expect(lone).toMatchObject({ kind: 'isolated', near: { kind: 'edge', id: 'e_B_2_bridge__B_2_hall' }, nearFrom: 'n_B_2_lone' });
    expect(lone.near!.dist).toBeCloseTo(1.2, 1);
    expect(lone.near!.dist).toBeLessThanOrEqual(NEAR_M);
    expect(items.find((i) => i.nodeId === 'n_B_2_far')).toMatchObject({ kind: 'isolated', message: '어떤 구간에도 이어지지 않은 지점입니다.' });
    expect(items.find((i) => i.nodeId === 'n_B_2_far')!.near).toBeUndefined();
  });

  it('a group joined only to itself is an island, reported once with all of its points', () => {
    const { s, mid } = floor();
    s.history.perform(compose([
      corridor('n_B_2_i1', [mid[0], mid[1] - north(6)]), corridor('n_B_2_i2', [mid[0], mid[1] - north(9)]), hallway('e_B_2_i', 'n_B_2_i1', 'n_B_2_i2'),
      addNode({ id: 'n_out_lone', coord: [126.999, 36.999], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate' } }),
    ], '섬'));
    const state = s.history.current();
    const island = findBroken(state).filter((i) => i.kind === 'island');
    expect(island).toHaveLength(1);
    expect(island[0]).toMatchObject({ nodeId: 'n_B_2_i1', nodeIds: ['n_B_2_i1', 'n_B_2_i2'] });
    expect(island[0]!.message).toContain('지점 2개가 서로만 이어져 있고');
    const ids = brokenIds(findBroken(state));
    expect(brokenByLevel(state, ids, 'bldg_B')).toEqual(new Map([[2, 2]]));
    expect(brokenCountIn(state, ids, OUTDOOR)).toBe(1);
    expect(brokenCountIn(state, ids, { kind: 'building', buildingId: 'bldg_B', level: 2 })).toBe(2);
  });

  it('a point of the main network beside a way it is not joined to is "near"; a door on its own stub is not', () => {
    const { s, mid } = floor();
    // a spur from the hall that comes back to 1m beside the corridor without joining it: 14m away along the edges
    s.history.perform(compose([
      corridor('n_B_2_s1', [mid[0] + 0.00004, mid[1] - north(7)]), corridor('n_B_2_s2', [mid[0], mid[1] - north(1)]),
      hallway('e_B_2_s1', 'n_B_2_hall', 'n_B_2_s1'), hallway('e_B_2_s2', 'n_B_2_s1', 'n_B_2_s2'),
    ], '곁길'));
    const items = findBroken(s.history.current());
    expect(items.filter((i) => i.kind === 'near').map((i) => i.nodeId)).toEqual(['n_B_2_s2']);
    expect(items.find((i) => i.nodeId === 'n_B_2_s2')!.message).toContain('옆에 다른 길이 있는데 이어져 있지 않습니다');
    // n_B_2_201door stands beside the hall and is joined to it by its own short edge: not reported
    expect(items.some((i) => i.nodeIds.includes('n_B_2_201door'))).toBe(false);
  });

  it('only the same floor counts: a point right above a corridor of another floor is not near it', () => {
    const { s, mid } = floor();
    s.history.perform(corridor('n_B_1_above', [mid[0] - 0.00003, mid[1]], 1));
    const item = findBroken(s.history.current()).find((i) => i.nodeId === 'n_B_1_above')!;
    expect(item.kind).toBe('isolated');
    expect(item.near).toBeUndefined();
  });

  it('nextBroken walks the list round', () => {
    const { s, mid } = floor();
    s.history.perform(compose([corridor('n_B_2_a', [mid[0], mid[1] - north(5)]), corridor('n_B_2_b', [mid[0], mid[1] - north(9)])], '지점'));
    const items = findBroken(s.history.current());
    expect(nextBroken(items, null)!.nodeId).toBe('n_B_2_a');
    expect(nextBroken(items, 'n_B_2_a')!.nodeId).toBe('n_B_2_b');
    expect(nextBroken(items, 'n_B_2_b')!.nodeId).toBe('n_B_2_a');
    expect(nextBroken([], null)).toBeUndefined();
  });
});

describe('planConnectNear: 가까운 길에 자동 연결', () => {
  it('cuts the way at the nearest spot and joins the point to it in one entry; the item is gone afterwards', () => {
    const { s, mid } = floor();
    s.history.perform(corridor('n_B_2_lone', [mid[0], mid[1] - north(1.2)]));
    const before = s.history.current();
    const item = findBroken(before).find((i) => i.nodeId === 'n_B_2_lone')!;
    const plan = planConnectNear(before, s.ctx, item);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.annotation).toBe('가까운 길에 연결');
    expect(runPlan(s.history, plan)).toMatchObject({ ok: true });
    const after = s.history.current();
    const cut = Object.values(after.nodes).find((n) => !(n.id in before.nodes))!;
    expect(cut.coord[1]).toBeCloseTo(mid[1], 7);
    expect(between(after, 'n_B_2_lone', cut.id)[0]!.props).toMatchObject({ highway: 'corridor', edge_type: 'indoor' });
    expect(between(after, 'n_B_2_bridge', cut.id)).toHaveLength(1);
    expect(between(after, cut.id, 'n_B_2_hall')).toHaveLength(1);
    expect(checkInvariants(after)).toEqual([]);
    expect(findBroken(after).some((i) => i.nodeIds.includes('n_B_2_lone'))).toBe(false);
    expect(s.history.undo()).toEqual(before);
  });

  it('joins to the end of the way when the spot is too close to it to cut: no new point', () => {
    const { s, base } = floor();
    const west = base.nodes['n_B_2_bridge']!.coord;
    s.history.perform(corridor('n_B_2_end', [west[0] + 0.000003, west[1] - north(1)])); // 0.3m along from the corridor's west end
    const before = s.history.current();
    const item = findBroken(before).find((i) => i.nodeId === 'n_B_2_end')!;
    expect(item.near).toMatchObject({ kind: 'edge', id: 'e_B_2_bridge__B_2_hall' });
    const plan = planConnectNear(before, s.ctx, item);
    if (isError(plan)) throw new Error(plan.error);
    runPlan(s.history, plan);
    const after = s.history.current();
    expect(Object.keys(after.nodes)).toHaveLength(Object.keys(before.nodes).length);
    expect(between(after, 'n_B_2_end', 'n_B_2_bridge')).toHaveLength(1);
    expect(findBroken(after).some((i) => i.nodeIds.includes('n_B_2_end'))).toBe(false);
  });

  it('joins two points left side by side directly', () => {
    const { s, mid } = floor();
    s.history.perform(compose([corridor('n_B_2_p', [mid[0], mid[1] - north(5)]), corridor('n_B_2_q', [mid[0], mid[1] - north(6)])], '지점'));
    const before = s.history.current();
    const item = findBroken(before).find((i) => i.nodeId === 'n_B_2_p')!;
    expect(item.near).toMatchObject({ kind: 'node', id: 'n_B_2_q' });
    const plan = planConnectNear(before, s.ctx, item);
    if (isError(plan)) throw new Error(plan.error);
    runPlan(s.history, plan);
    expect(between(s.history.current(), 'n_B_2_p', 'n_B_2_q')).toHaveLength(1);
  });

  it('says so when there is nothing near', () => {
    const { s, mid } = floor();
    s.history.perform(corridor('n_B_2_far', [mid[0], mid[1] - north(4)]));
    const state = s.history.current();
    expect(planConnectNear(state, s.ctx, findBroken(state)[0]!)).toEqual({ error: '가까이에 이을 길이 없습니다.' });
  });
});
