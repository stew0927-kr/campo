// Splitting: X on selected edges, and the handle in the middle of an edge (SPEC-v0.2 5.1, 5.3).
import { describe, expect, it } from 'vitest';
import { splitEdgeAt } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { HandleDrag } from '../src/model/drag.ts';
import { isError, runPlan } from '../src/model/plan.ts';
import { edgeMidpoint, planSplit } from '../src/model/split.ts';

function splittable(s: ReturnType<typeof fixtureSession>) {
  const st = s.history.current();
  const e = Object.values(st.edges).find((x) => x.props.highway === 'footway' && x.props.edge_type === 'outdoor' && splitEdgeAt(x.id, edgeMidpoint(st, x.id)!, {}, s.ctx).disabled(st) === false);
  if (!e) throw new Error('no splittable edge in the fixture');
  return e;
}

describe('나누기 (X)', () => {
  it('cuts every selected edge at its middle in one entry, and says why when nothing is selected', () => {
    const s = fixtureSession();
    const e = splittable(s);
    const before = s.history.current();
    expect(isError(planSplit(before, s.ctx, []))).toBe(true);
    const plan = planSplit(before, s.ctx, [e.id]);
    if (isError(plan)) throw new Error(plan.error);
    expect(runPlan(s.history, plan).ok).toBe(true);
    const after = s.history.current();
    expect(Object.keys(after.nodes)).toHaveLength(Object.keys(before.nodes).length + 1);
    expect(Object.keys(after.edges)).toHaveLength(Object.keys(before.edges).length + 1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });
});

describe('구간 가운데 손잡이 끌기', () => {
  it('makes a new node that follows the pointer; the whole drag is one Ctrl+Z', () => {
    const s = fixtureSession();
    const e = splittable(s);
    const before = s.history.current();
    const mid = edgeMidpoint(before, e.id)!;
    const drag = HandleDrag.create(s.history, s.ctx, e.id, mid);
    if (typeof drag === 'string') throw new Error(drag);
    const size = s.history.size();
    drag.start();
    drag.move([mid[0] + 0.00001, mid[1] + 0.00001]);
    const during = drag.move([mid[0] + 0.00002, mid[1] + 0.00003]);
    expect(during.nodes[drag.nodeId]!.coord).toEqual([mid[0] + 0.00002, mid[1] + 0.00003]);
    expect(Object.keys(during.edges)).toHaveLength(Object.keys(before.edges).length + 1);
    expect(drag.finish([mid[0] + 0.00002, mid[1] + 0.00003])).toMatchObject({ ok: true, kind: 'handle' });
    expect(s.history.size()).toBe(size + 1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('refuses an edge that cannot be split (elevator rides) with core\'s reason', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const ride = Object.values(st.edges).find((x) => x.props.highway === 'elevator')!;
    const mid = edgeMidpoint(st, ride.id) ?? st.nodes[ride.props.from]!.coord;
    expect(typeof HandleDrag.create(s.history, s.ctx, ride.id, mid)).toBe('string');
  });
});
