import { describe, expect, it } from 'vitest';
import { checkInvariants, deleteEdges } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

describe('deleteEdges', () => {
  it('deletes edges and the corridor / outdoor nodes left without an edge', async () => {
    const s = await fixtureState();
    const next = deleteEdges(['e_C_5_hall__C_5_east', 'e_C_5_east__B_2_steps']).apply(s);
    expect(next.edges['e_C_5_hall__C_5_east']).toBeUndefined();
    expect(next.nodes['n_C_5_east']).toBeUndefined();
    expect(next.nodes['n_C_5_hall']).toBeDefined();
    expect(next.nodes['n_B_2_steps']).toBeDefined();
    expect(checkInvariants(next)).toEqual([]);
  });

  it('keeps doors, restrooms, entrances, poi, stops and landings even when left alone', async () => {
    const s = await fixtureState();
    const next = deleteEdges(['e_A_4_hall__A_4_wc_f', 'e_out_0001__out_0006', 'e_portal_B_1_main', 'e_A_1_stair__A_2_stair', 'e_A_1_hall__A_1_stair']).apply(s);
    expect(next.nodes['n_A_4_wc_f']).toBeDefined();
    expect(next.nodes['n_B_1_main']).toBeDefined();
    expect(next.nodes['n_A_1_stair']).toBeDefined();
    expect(next.nodes['n_out_0006']).toBeUndefined();
    const doorless = deleteEdges(['e_A_4_hall__A_4_408door', 'e_A_4_north__A_4_408door']).apply(s);
    expect(doorless.nodes['n_A_4_408door']).toBeDefined();
  });

  it('is disabled for no ids or a missing id', async () => {
    const s = await fixtureState();
    expect(deleteEdges([]).disabled(s)).toMatch(/하나 이상/);
    expect(deleteEdges(['e_nope']).disabled(s)).toMatch(/e_nope/);
    expect(deleteEdges(['e_nope']).apply(s)).toBe(s);
  });

  it('warns about overrides on the deleted edges and on nodes deleted with them', async () => {
    const s = await fixtureState();
    const action = deleteEdges(['e_out_0001__out_0006', 'e_portal_B_1_main'], ctx(1, { overrideIds: new Set(['e_portal_B_1_main', 'n_out_0006', 'n_B_1_main']) }));
    expect(action.warnings!(s)).toEqual([
      '"e_portal_B_1_main"에 override가 있습니다. overrides.json에서 이 항목을 지우세요.',
      '"n_out_0006"에 override가 있습니다. overrides.json에서 이 항목을 지우세요.',
    ]);
  });

  it('does not warn about measurements (W13 reports those)', async () => {
    const s = await fixtureState();
    expect(deleteEdges(['e_out_0002__out_0003_esc'], ctx(1, { observationTargets: new Set(['edge:e_out_0002__out_0003_esc']) })).warnings!(s)).toEqual([]);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), deleteEdges(['e_C_5_hall__C_5_east', 'e_C_5_east__B_2_steps']));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), deleteEdges(['e_C_5_hall__C_5_east', 'e_C_5_east__B_2_steps']));
  });
});
