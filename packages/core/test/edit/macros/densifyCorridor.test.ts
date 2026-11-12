import { describe, expect, it } from 'vitest';
import {
  annotationOf,
  checkInvariants,
  createHistory,
  createIdGen,
  densifyCorridor,
  densifyCorridorAction,
  densifyTargets,
  edgeCoords,
  lineLength,
  observationMessage,
} from '../../../src/index.ts';
import { ctx, expectInputUntouched, newIds } from '../helpers.ts';
import { toXY, world } from './world.ts';

describe('densifyCorridor', () => {
  it('interval: nodes every 10 m on a 40 m corridor, length kept', () => {
    const s = world();
    const r = densifyCorridor(s, ['e_s'], { interval: 10 }, ctx(2));
    if (!r.ok) throw new Error(r.reason);
    expect(r.nodeIds).toHaveLength(3);
    expect(r.nodeIds.map((id) => Math.round(toXY(r.state.nodes[id]!.coord)[0]))).toEqual([10, 20, 30]);
    const corridors = Object.values(r.state.edges).filter((e) => !(e.id in s.edges) || e.id === 'e_s');
    expect(corridors).toHaveLength(4);
    expect(corridors.reduce((sum, e) => sum + lineLength(edgeCoords(r.state, e)), 0)).toBeCloseTo(40, 6);
    expect(checkInvariants(r.state)).toEqual([]);
    expect(annotationOf(r.action, s)).toBe('복도에 지점 3개 넣기');
  });

  it('count over a chain of two edges drawn in opposite directions; a target on an existing node is skipped', () => {
    const s = world();
    // e_c1 (60,0)→(80,0), e_c2 (80,20)→(80,0): 40 m; count 3 → 10, 20 (n_c2, skipped), 30
    const r = densifyCorridor(s, ['e_c1', 'e_c2'], { count: 3 }, ctx(3));
    if (!r.ok) throw new Error(r.reason);
    expect(r.nodeIds.map((id) => toXY(r.state.nodes[id]!.coord).map((v) => Math.round(v) + 0))).toEqual([[70, 0], [80, 10]]);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('bent corridor: a node lands past the bend', () => {
    const s = world();
    const r = densifyCorridor(s, ['e_b'], { interval: 25 }, ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.nodeIds.map((id) => toXY(r.state.nodes[id]!.coord).map(Math.round))).toEqual([[20, 35]]);
  });

  it('refuses steps, branches, gaps and tight spacing with a reason', () => {
    const s = world();
    expect(densifyCorridorAction(['e_t'], { interval: 5 }, ctx()).disabled(s)).toMatch(/복도\(corridor\)/);
    expect(densifyCorridorAction(['e_s', 'e_c1'], { interval: 5 }, ctx()).disabled(s)).toMatch(/한 줄로/);
    expect(densifyCorridorAction(['e_s', 'e_u'], { interval: 5 }, ctx()).disabled(s)).toMatch(/같은 건물, 같은 층/);
    expect(densifyCorridorAction(['e_s'], { interval: 1 }, ctx()).disabled(s)).toMatch(/1m보다/);
    expect(densifyCorridorAction(['e_s'], { count: 0 }, ctx()).disabled(s)).toMatch(/count/);
    expect(densifyCorridorAction(['e_s'], { interval: 50 }, ctx()).disabled(s)).toMatch(/넣을 지점이 없습니다/);
    expect(densifyTargets(10, { count: 9 })).toMatch(/1m보다/);
  });

  it('one history entry for all the splits; undo restores the start with I1–I5 intact', () => {
    const s = world();
    const h = createHistory(s);
    const after = h.perform(densifyCorridorAction(['e_s'], { interval: 5 }, ctx()));
    expect(newIds(s, after)).toHaveLength(14);
    expect(h.size()).toBe(1);
    expect(h.undo()).toEqual(s);
    expect(checkInvariants(h.current())).toEqual([]);
    expect(h.redo()).toEqual(after);
  });

  it('collects the measurement warning of the split edge once', () => {
    const s = world();
    const r = densifyCorridor(s, ['e_s'], { interval: 10 }, ctx(1, { observationTargets: new Set(['edge:e_s']) }));
    expect(r.ok && r.warnings).toEqual([observationMessage('e_s')]);
  });

  it('frozen input, same seed same ids', () => {
    const s = world();
    expectInputUntouched(s, densifyCorridorAction(['e_c1', 'e_c2'], { interval: 7 }, ctx()));
    const run = () => {
      const r = densifyCorridor(s, ['e_s'], { interval: 10 }, { ids: createIdGen(5) });
      return r.ok ? newIds(s, r.state) : [];
    };
    expect(run()).toEqual(run());
    expect(run()).toHaveLength(6);
  });
});
