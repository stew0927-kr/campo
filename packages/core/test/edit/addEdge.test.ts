import { describe, expect, it } from 'vitest';
import { addEdge, checkInvariants, createIdGen, type NewEdge } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState, newIds } from './helpers.ts';

const corridor: NewEdge = {
  props: { kind: 'edge', highway: 'corridor', edge_type: 'indoor', from: 'n_A_3_bridge', to: 'n_A_3_north', bidirectional: true, step_free: null, source: 'estimate' },
};

describe('addEdge', () => {
  it('adds an edge at rev 1 that references its nodes', async () => {
    const s = await fixtureState();
    const next = addEdge({ ...corridor, vertices: [[127.0008, 37.0006]] }, ctx(2)).apply(s);
    const [id] = newIds(s, next);
    expect(id).toMatch(/^e_A_3_[0-9a-z]{6}$/);
    const e = next.edges[id!]!;
    expect(e.props.rev).toBe(1);
    expect(e.vertices).toEqual([[127.0008, 37.0006]]);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('prefixes: outdoor e_out_, portal e_conn_, a stair across levels uses the lower level', async () => {
    const s = await fixtureState();
    const out = addEdge({ props: { ...corridor.props, highway: 'footway', edge_type: 'outdoor', from: 'n_out_0006', to: 'n_out_0007' } }, ctx(1)).apply(s);
    expect(newIds(s, out)[0]).toMatch(/^e_out_/);
    const portal = addEdge({ props: { ...corridor.props, highway: 'footway', edge_type: 'portal', from: 'n_A_1_main', to: 'n_out_0001' } }, ctx(1)).apply(s);
    expect(newIds(s, portal)[0]).toMatch(/^e_conn_/);
    const stairs = addEdge({ props: { ...corridor.props, highway: 'steps', from: 'n_A_4_hall', to: 'n_A_2_hall', step_free: false } }, ctx(1)).apply(s);
    expect(newIds(s, stairs)[0]).toMatch(/^e_A_2_/);
  });

  it('is disabled for a taken id, a missing end, a loop, or a flat edge across scopes (I4)', async () => {
    const s = await fixtureState();
    expect(addEdge({ ...corridor, id: 'n_A_1_hall' }).disabled(s)).toMatch(/이미 있는 id/);
    expect(addEdge({ props: { ...corridor.props, to: 'n_nope' } }, ctx()).disabled(s)).toMatch(/to 지점/);
    expect(addEdge({ props: { ...corridor.props, from: 'n_nope' } }, ctx()).disabled(s)).toMatch(/from 지점/);
    expect(addEdge({ props: { ...corridor.props, to: 'n_A_3_bridge' } }, ctx()).disabled(s)).toMatch(/같은 지점/);
    expect(addEdge({ props: { ...corridor.props, to: 'n_A_4_hall' } }, ctx()).disabled(s)).toMatch(/평지 구간/);
    expect(addEdge({ props: { ...corridor.props, highway: 'footway', edge_type: 'outdoor', from: 'n_A_1_main', to: 'n_out_0001' } }, ctx()).disabled(s)).toMatch(/평지 구간/);
    // steps and portals may cross scopes
    expect(addEdge({ props: { ...corridor.props, highway: 'steps', to: 'n_A_4_hall' } }, ctx()).disabled(s)).toBe(false);
    expect(addEdge({ props: { ...corridor.props, highway: 'footway', edge_type: 'portal', from: 'n_A_1_main', to: 'n_out_0001' } }, ctx()).disabled(s)).toBe(false);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), addEdge(corridor, ctx()));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), addEdge(corridor, ctx()));
  });

  it('same seed, same id', async () => {
    const s = await fixtureState();
    expect(newIds(s, addEdge(corridor, { ids: createIdGen(4) }).apply(s))).toEqual(newIds(s, addEdge(corridor, { ids: createIdGen(4) }).apply(s)));
  });
});
