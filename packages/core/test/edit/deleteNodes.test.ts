import { describe, expect, it } from 'vitest';
import { OBSERVATION_CHANGED_MESSAGE, checkInvariants, deleteNodes, healPlan, type EdgeProperties, type EditState } from '../../src/index.ts';
import { ctx, deepFreeze, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

function edge(id: string, from: string, to: string, extra: Partial<EdgeProperties> = {}) {
  const props: EdgeProperties = { kind: 'edge', highway: 'steps', edge_type: 'outdoor', from, to, bidirectional: true, step_free: false, source: 'x', rev: 1, ...extra };
  return { id, vertices: [], props };
}
function node(id: string, coord: [number, number]) {
  return { id, coord, props: { kind: 'node' as const, node_type: 'outdoor' as const, building_id: null, level: null, source: 'x', rev: 1 } };
}
/** a(127) — n(127.0001) — b(127.0003), outdoor. */
function line(e1: ReturnType<typeof edge>, e2: ReturnType<typeof edge>): EditState {
  return deepFreeze({
    nodes: { a: node('a', [127, 37]), n: node('n', [127.0001, 37]), b: node('b', [127.0003, 37]) },
    edges: { [e1.id]: e1, [e2.id]: e2 },
    buildings: {},
    rooms: {},
  });
}

describe('deleteNodes', () => {
  it('deletes the nodes and every edge on them', async () => {
    const s = await fixtureState();
    const next = deleteNodes(['n_A_4_408door']).apply(s);
    expect(next.nodes['n_A_4_408door']).toBeUndefined();
    expect(next.edges['e_A_4_hall__A_4_408door']).toBeUndefined();
    expect(next.edges['e_A_4_north__A_4_408door']).toBeUndefined();
    expect(checkInvariants(next)).toEqual([]);
  });

  it('heal: two matching edges become one, the longer id stays, n becomes a bend point', async () => {
    const s = await fixtureState();
    const next = deleteNodes(['n_A_4_408door'], { heal: true }).apply(s);
    expect(next.edges['e_A_4_north__A_4_408door']).toBeUndefined();
    const kept = next.edges['e_A_4_hall__A_4_408door']!;
    expect(kept.props).toMatchObject({ from: 'n_A_4_hall', to: 'n_A_4_north', rev: 2 });
    expect(kept.vertices).toEqual([[127.0005, 37.00065]]);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('heal adds step counts and keeps the direction of the longer edge', () => {
    const s = line(edge('e1', 'a', 'n', { step_count: 3, incline: 'up' }), edge('e2', 'n', 'b', { step_count: 4, incline: 'up' }));
    const next = deleteNodes(['n'], { heal: true }).apply(s);
    expect(Object.keys(next.edges)).toEqual(['e2']);
    expect(next.edges['e2']!.props).toMatchObject({ from: 'a', to: 'b', step_count: 7, rev: 2 });
    expect(next.edges['e2']!.vertices).toEqual([[127.0001, 37]]);
  });

  it('heal warns that measurements on the joined edges must be redone, plain delete does not', async () => {
    const s = await fixtureState();
    const targets = new Set(['edge:e_A_4_hall__A_4_408door']);
    const heal = deleteNodes(['n_A_4_408door'], { heal: true }, ctx(1, { observationTargets: targets }));
    expect(heal.warnings!(s)).toEqual([`구간 "e_A_4_hall__A_4_408door": ${OBSERVATION_CHANGED_MESSAGE}.`]);
    expect(OBSERVATION_CHANGED_MESSAGE).toBe('이 구간의 측정은 바뀌기 전 길이 기준이라 다시 재야 합니다');
    expect(deleteNodes(['n_A_4_408door'], {}, ctx(1, { observationTargets: targets })).warnings!(s)).toEqual([]);
  });

  it('no heal when the direction through n differs (one-way, or incline)', () => {
    const oneWay = line(edge('e1', 'a', 'n', { bidirectional: false, highway: 'footway' }), edge('e2', 'b', 'n', { bidirectional: false, highway: 'footway' }));
    expect(healPlan(oneWay, 'n')).toBeNull();
    expect(Object.keys(deleteNodes(['n'], { heal: true }).apply(oneWay).edges)).toEqual([]);
    const incline = line(edge('e1', 'a', 'n', { incline: 'up' }), edge('e2', 'b', 'n', { incline: 'up' }));
    expect(healPlan(incline, 'n')).toBeNull();
    // a plain two-way edge may be turned around
    const plain = line(edge('e1', 'a', 'n', { highway: 'footway' }), edge('e2', 'b', 'n', { highway: 'footway' }));
    expect(healPlan(plain, 'n')).toMatchObject({ keep: 'e2', drop: 'e1', from: 'b', to: 'a' });
  });

  it('no heal when properties differ, one side lacks step_count, or the edge is a portal / bridge / elevator', () => {
    expect(healPlan(line(edge('e1', 'a', 'n', { step_free: true }), edge('e2', 'n', 'b')), 'n')).toBeNull();
    expect(healPlan(line(edge('e1', 'a', 'n', { step_count: 3 }), edge('e2', 'n', 'b')), 'n')).toBeNull();
    expect(healPlan(line(edge('e1', 'a', 'n', { edge_type: 'portal' }), edge('e2', 'n', 'b', { edge_type: 'portal' })), 'n')).toBeNull();
    expect(healPlan(line(edge('e1', 'a', 'n', { highway: 'elevator' }), edge('e2', 'n', 'b', { highway: 'elevator' })), 'n')).toBeNull();
    expect(healPlan(line(edge('e1', 'a', 'n', { step_count: 3, rev: 5 }), edge('e2', 'n', 'b', { step_count: 1 })), 'n')).not.toBeNull();
  });

  it('heal: false deletes both edges', () => {
    const s = line(edge('e1', 'a', 'n'), edge('e2', 'n', 'b'));
    expect(Object.keys(deleteNodes(['n']).apply(s).edges)).toEqual([]);
  });

  it('is disabled for no ids or a missing id', async () => {
    const s = await fixtureState();
    expect(deleteNodes([]).disabled(s)).toMatch(/하나 이상/);
    expect(deleteNodes(['n_nope']).disabled(s)).toMatch(/n_nope/);
  });

  it('warns when a removed Feature has an override', async () => {
    const s = await fixtureState();
    const action = deleteNodes(['n_A_4_408door'], { heal: true }, ctx(1, { overrideIds: new Set(['e_A_4_north__A_4_408door', 'n_A_4_408door', 'e_A_4_hall__A_4_408door']) }));
    const warnings = action.warnings!(s);
    expect(warnings).toHaveLength(3); // two removed Features with an override, plus the dropped edge's override moving to the kept one
    expect(warnings[0]).toBe('"e_A_4_north__A_4_408door"에 override가 있습니다. overrides.json에서 이 항목을 지우세요.');
    expect(warnings[1]).toContain('n_A_4_408door');
    expect(warnings[2]).toContain('남는 구간 "e_A_4_hall__A_4_408door"');
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), deleteNodes(['n_A_4_408door'], { heal: true }));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), deleteNodes(['n_A_4_408door', 'n_A_1_hall'], { heal: true }));
  });
});
