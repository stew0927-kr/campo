// 연결통로 (SPEC-v0.2 5.2.1) and 에스컬레이터 (2.7, 3.8) tools: Plans of core actions, one history entry each.
import { describe, expect, it } from 'vitest';
import { buildGraph, checkInvariants, findRoute, validateCampus, type EditState, type Position } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { planBridge } from '../src/model/bridge.ts';
import { planAddBuilding } from '../src/model/building.ts';
import { planDrawnPath } from '../src/model/connect.ts';
import { bridgeTargets } from '../src/model/cross.ts';
import { planElevator } from '../src/model/elevator.ts';
import { ESCALATOR_MODES, planEscalator, type EscalatorMode } from '../src/model/escalator.ts';
import { pairOffsets } from '../src/model/pairs.ts';
import { isError, runPlan, type Plan, type PlanResult } from '../src/model/plan.ts';
import type { Scope } from '../src/model/scope.ts';
import { createSession, defaultMeta, stateToCampus, type Session } from '../src/model/session.ts';

const ok = (r: PlanResult | null): Plan => {
  if (!r || isError(r)) throw new Error(r ? r.error : 'no plan');
  return r;
};
const errorOf = (r: PlanResult): string => {
  if (!isError(r)) throw new Error('expected an error');
  return r.error;
};
const checks = (s: Session, st: EditState) => validateCampus(stateToCampus(st, s.meta, s.passthrough, s.extras));
const added = (before: EditState, after: EditState) => ({
  nodes: Object.values(after.nodes).filter((n) => !(n.id in before.nodes)),
  edges: Object.values(after.edges).filter((e) => !(e.id in before.edges)),
});

describe('연결통로 (planBridge)', () => {
  it('joins floors with different numbers (A동 3층 <-> C동 5층) and fills the buildings and levels from the nodes', () => {
    const s = fixtureSession();
    const before = s.history.current();
    expect(runPlan(s.history, ok(planBridge(before, s.ctx, 'n_A_3_hall', 'n_C_5_hall')))).toEqual({ ok: true, warnings: [] });
    const { nodes, edges } = added(before, s.history.current());
    expect(nodes).toEqual([]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.props).toMatchObject({
      highway: 'corridor', edge_type: 'bridge', step_free: null, from: 'n_A_3_hall', to: 'n_C_5_hall',
      building_from: 'bldg_A', building_to: 'bldg_C', level_from: 3, level_to: 5, bidirectional: true,
    });
    expect('covered' in edges[0]!.props).toBe(false);
    expect(checks(s, s.history.current()).errors).toEqual(checks(s, before).errors);
  });

  it('an empty spot makes a corridor node of that floor and the bridge in one history entry; one Ctrl+Z takes both', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const size = s.history.size();
    const spot: Position = [127.0012, 37.00035];
    const plan = ok(planBridge(before, s.ctx, 'n_A_3_hall', { position: spot, buildingId: 'bldg_B', level: 2 }));
    expect(runPlan(s.history, plan).ok).toBe(true);
    expect(s.history.size()).toBe(size + 1);
    const { nodes, edges } = added(before, s.history.current());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.props).toMatchObject({ node_type: 'corridor', building_id: 'bldg_B', level: 2 });
    expect(nodes[0]!.coord).toEqual(spot);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.props).toMatchObject({ edge_type: 'bridge', from: 'n_A_3_hall', to: nodes[0]!.id, building_to: 'bldg_B', level_to: 2 });
    expect(checkInvariants(s.history.current())).toEqual([]);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('refuses the same building, a point outdoors, a floor the building does not have, and the point itself', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(errorOf(planBridge(st, s.ctx, 'n_A_3_hall', 'n_A_1_main'))).toMatch(/같은 건물/);
    expect(errorOf(planBridge(st, s.ctx, 'n_A_3_hall', { position: [127.0006, 37.0004], buildingId: 'bldg_A', level: 1 }))).toMatch(/같은 건물/);
    expect(errorOf(planBridge(st, s.ctx, 'n_A_3_hall', 'n_out_0001'))).toMatch(/건물 안/);
    expect(errorOf(planBridge(st, s.ctx, 'n_out_0001', 'n_B_2_hall'))).toMatch(/건물 안/);
    expect(errorOf(planBridge(st, s.ctx, 'n_A_3_hall', { position: [127.0012, 37.0004], buildingId: 'bldg_B', level: 7 }))).toMatch(/층 목록/);
    expect(errorOf(planBridge(st, s.ctx, 'n_A_3_hall', { position: [127.0012, 37.0004], buildingId: null, level: null }))).toMatch(/건물 안/);
    expect(errorOf(planBridge(st, s.ctx, 'n_A_3_hall', 'n_A_3_hall'))).toBeTruthy();
  });

  it('covered: false is written when there is no roof; true or not known leaves the property out', () => {
    const s = fixtureSession();
    const st = s.history.current();
    runPlan(s.history, ok(planBridge(st, s.ctx, 'n_A_3_hall', 'n_B_2_hall', { covered: false })));
    const bare = added(st, s.history.current()).edges[0]!;
    expect(bare.props.covered).toBe(false);
    const s2 = fixtureSession(2);
    for (const covered of [true, null, undefined]) {
      const before = s2.history.current();
      runPlan(s2.history, ok(planBridge(before, s2.ctx, 'n_A_3_hall', 'n_B_2_hall', { covered })));
      expect('covered' in added(before, s2.history.current()).edges[0]!.props).toBe(false);
    }
  });

  it('lists the other buildings nearest first, each with its floors and the floor to show first', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const fromBridge = bridgeTargets(st, 'n_A_3_bridge'); // east edge of A동 3층: B동 is nearer than C동
    expect(fromBridge.map((t) => t.building.props.name)).toEqual(['B동', 'C동']);
    expect(fromBridge[0]!.distanceM).toBeLessThan(fromBridge[1]!.distanceM);
    expect(fromBridge[0]!.levels).toEqual([1, 2]);
    expect(fromBridge[0]!.level).toBe(1); // B동 has no 3층: its ground floor
    expect(fromBridge[1]!.level).toBe(5); // C동 has only 5층
    expect(bridgeTargets(st, 'n_A_1_main').find((t) => t.building.id === 'bldg_B')!.level).toBe(1); // same floor number when it exists
    expect(bridgeTargets(st, 'n_A_2_hall').find((t) => t.building.id === 'bldg_B')!.level).toBe(2);
    expect(bridgeTargets(st, 'n_out_0001')).toEqual([]); // an outdoor point has no building to leave
  });
});

describe('에스컬레이터 (planEscalator)', () => {
  const MODES: [EscalatorMode, { conveying: string; bidirectional: boolean }[]][] = [
    ['up', [{ conveying: 'forward', bidirectional: false }]],
    ['down', [{ conveying: 'backward', bidirectional: false }]],
    ['reversible', [{ conveying: 'reversible', bidirectional: true }]],
    ['pair', [{ conveying: 'forward', bidirectional: false }, { conveying: 'backward', bidirectional: false }]],
  ];

  for (const [mode, expected] of MODES) {
    it(`${ESCALATOR_MODES.find((m) => m.id === mode)!.label}: conveying and bidirectional agree, step_free is false, and the data passes the checks`, () => {
      const s = fixtureSession();
      const before = s.history.current();
      const size = s.history.size();
      expect(runPlan(s.history, ok(planEscalator(before, s.ctx, 'n_A_2_hall', 'n_A_3_hall', mode))).ok).toBe(true);
      expect(s.history.size()).toBe(size + 1);
      const { nodes, edges } = added(before, s.history.current());
      expect(nodes).toEqual([]);
      expect(edges.map((e) => ({ conveying: e.props.conveying, bidirectional: e.props.bidirectional }))).toEqual(expected);
      for (const e of edges) {
        expect(e.props).toMatchObject({ highway: 'steps', edge_type: 'indoor', step_free: false, from: 'n_A_2_hall', to: 'n_A_3_hall', level_from: 2, level_to: 3 });
      }
      // the same checks as before, plus nothing new: E12 and the schema's conveying / bidirectional pairing hold
      const after = checks(s, s.history.current());
      const base = checks(s, before);
      expect(after.errors).toEqual(base.errors);
      expect(after.warnings).toEqual(base.warnings);
      expect(checkInvariants(s.history.current())).toEqual([]);
      s.history.undo();
      expect(s.history.current()).toEqual(before);
    });
  }

  it('a pair is two parallel edges between the same two points, each on its own side for the map', () => {
    const s = fixtureSession();
    const before = s.history.current();
    runPlan(s.history, ok(planEscalator(before, s.ctx, 'n_A_2_hall', 'n_A_3_hall', 'pair')));
    const [up, down] = added(before, s.history.current()).edges;
    expect([up!.props.from, up!.props.to]).toEqual([down!.props.from, down!.props.to]);
    expect(up!.id).not.toBe(down!.id);
    const offsets = pairOffsets(s.history.current());
    expect(offsets.get(up!.id)).toBe(-1); // 상행 on the left of the drawn direction
    expect(offsets.get(down!.id)).toBe(1);
    // the fixture's own pair (A동 1층 <-> 2층) is a pair too; a lone escalator is not
    expect(offsets.get('e_A_1_esc__A_2_esc_up')).toBe(-1);
    expect(offsets.get('e_A_1_esc__A_2_esc_down')).toBe(1);
    expect(offsets.has('e_out_0002__out_0003_esc')).toBe(false);
  });

  it('draws from the lower floor: a second click on a lower floor swaps the ends, so 상행 still goes up', () => {
    const s = fixtureSession();
    const before = s.history.current();
    runPlan(s.history, ok(planEscalator(before, s.ctx, 'n_A_3_hall', 'n_A_2_hall', 'up')));
    const e = added(before, s.history.current()).edges[0]!;
    expect(e.props).toMatchObject({ from: 'n_A_2_hall', to: 'n_A_3_hall', level_from: 2, level_to: 3, conveying: 'forward' });
  });

  it('an empty spot on the upper floor makes a corridor node there, in the same history entry', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const size = s.history.size();
    const spot: Position = [127.0005, 37.0006];
    expect(runPlan(s.history, ok(planEscalator(before, s.ctx, 'n_A_2_hall', { position: spot, buildingId: 'bldg_A', level: 3 }, 'pair'))).ok).toBe(true);
    expect(s.history.size()).toBe(size + 1);
    const { nodes, edges } = added(before, s.history.current());
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.props).toMatchObject({ node_type: 'corridor', building_id: 'bldg_A', level: 3 });
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.props.to === nodes[0]!.id && e.props.level_to === 3)).toBe(true);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('works outdoors: edge_type outdoor without floors, and a new spot is an outdoor point', () => {
    const s = fixtureSession();
    const before = s.history.current();
    runPlan(s.history, ok(planEscalator(before, s.ctx, 'n_out_0001', { position: [127.0001, 37.0002], buildingId: null, level: null }, 'up')));
    const { nodes, edges } = added(before, s.history.current());
    expect(nodes[0]!.props).toMatchObject({ node_type: 'outdoor', building_id: null, level: null });
    expect(edges[0]!.props).toMatchObject({ highway: 'steps', edge_type: 'outdoor', step_free: false, conveying: 'forward', bidirectional: false });
    expect('level_from' in edges[0]!.props).toBe(false);
    expect(checks(s, s.history.current()).errors).toEqual(checks(s, before).errors);
    // between two existing outdoor points
    runPlan(s.history, ok(planEscalator(s.history.current(), s.ctx, 'n_out_0004', 'n_out_0005', 'reversible')));
  });

  it('refuses the same floor (W12), other buildings, indoor to outdoor, and the same point, each with a reason', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(errorOf(planEscalator(st, s.ctx, 'n_A_1_hall', 'n_A_1_main', 'up'))).toMatch(/같은 층/);
    expect(errorOf(planEscalator(st, s.ctx, 'n_A_1_hall', { position: [127.0005, 37.0006], buildingId: 'bldg_A', level: 1 }, 'up'))).toMatch(/같은 층/);
    expect(errorOf(planEscalator(st, s.ctx, 'n_A_1_hall', 'n_B_2_hall', 'up'))).toMatch(/연결통로/);
    expect(errorOf(planEscalator(st, s.ctx, 'n_A_1_hall', 'n_out_0001', 'up'))).toMatch(/포탈/);
    expect(errorOf(planEscalator(st, s.ctx, 'n_out_0001', 'n_A_1_hall', 'up'))).toMatch(/포탈/);
    expect(errorOf(planEscalator(st, s.ctx, 'n_A_1_hall', 'n_A_1_hall', 'up'))).toMatch(/같은 지점/);
    expect(errorOf(planEscalator(st, s.ctx, 'n_A_1_hall', { position: [127.0005, 37.0006], buildingId: 'bldg_A', level: 9 }, 'up'))).toMatch(/층 목록/);
  });
});

describe('길찾기: 한 쌍으로 그린 에스컬레이터를 core가 읽는다', () => {
  /** Building T (1-2층): a corridor on each floor, an elevator in the middle, and an escalator pair joining the west ends. */
  function building(): { s: Session; a1: string; b2: string } {
    const s = createSession('x', [{ path: 'campus.json', text: JSON.stringify(defaultMeta('x')) }], 5);
    const ring: Position[] = [[127, 37], [127.001, 37], [127.001, 37.0005], [127, 37.0005], [127, 37]];
    runPlan(s.history, ok(planAddBuilding(ring, { name: '테스트관', code: 'T', levels: [1, 2], groundLevels: [1] })));
    const floor = (level: number): Scope => ({ kind: 'building', buildingId: 'bldg_T', level });
    const corridor = (level: number, x0: number) => runPlan(s.history, ok(planDrawnPath(
      s.history.current(), s.ctx, [{ position: [x0, 37.0002] as Position }, { position: [127.0009, 37.0002] as Position }], 'flat', floor(level),
    )));
    corridor(1, 127.0001);
    corridor(2, 127.0002);
    runPlan(s.history, ok(planElevator(s.history.current(), s.ctx, { buildingId: 'bldg_T', position: [127.0005, 37.00021], levels: [1, 2] })));
    const at = (level: number, x: number) => Object.values(s.history.current().nodes).find((n) => n.props.level === level && n.props.node_type === 'corridor' && n.coord[0] === x && n.coord[1] === 37.0002)!.id;
    const [lowWest, upWest] = [at(1, 127.0001), at(2, 127.0002)];
    expect(runPlan(s.history, ok(planEscalator(s.history.current(), s.ctx, lowWest, upWest, 'pair'))).ok).toBe(true);
    return { s, a1: lowWest, b2: at(2, 127.0009) };
  }

  it('shortest goes up the escalator, step_free takes the elevator, and the data has no errors', () => {
    const { s, a1, b2 } = building();
    const st = s.history.current();
    const result = checks(s, st);
    // the only complaint is that this little building has no entrance; nothing about the parallel escalators (E12, schema pairing, W12)
    expect(result.errors.map((e) => e.code)).toEqual(['ground-level-without-entrance']);
    expect(result.warnings.map((w) => w.code)).not.toContain('escalator-same-scope');
    expect(checkInvariants(st)).toEqual([]);
    const graph = buildGraph(stateToCampus(st, s.meta, [], []));
    const shortest = findRoute(graph, a1, b2, 'shortest');
    const stepFree = findRoute(graph, a1, b2, 'step_free');
    if (!shortest.found || !stepFree.found) throw new Error('no route');
    expect(shortest.steps.some((x) => x.kind === 'escalator')).toBe(true);
    expect(stepFree.steps.some((x) => x.kind === 'escalator')).toBe(false);
    expect(stepFree.steps.some((x) => x.kind === 'elevator')).toBe(true);
    expect(stepFree.timeSec).toBeGreaterThan(shortest.timeSec);
  });
});
