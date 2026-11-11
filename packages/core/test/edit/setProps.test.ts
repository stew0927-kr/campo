import { describe, expect, it } from 'vitest';
import { checkInvariants, setProps } from '../../src/index.ts';
import { expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

describe('setProps', () => {
  it('sets values in place (key order kept), undefined removes a key, null is stored', async () => {
    const s = await fixtureState();
    const next = setProps(['e_A_3_hall__A_3_north', 'e_A_3_hall__A_3_bridge'], { step_free: null, covered: true }).apply(s);
    for (const id of ['e_A_3_hall__A_3_north', 'e_A_3_hall__A_3_bridge']) {
      const p = next.edges[id]!.props;
      expect(p.step_free).toBeNull();
      expect(p.covered).toBe(true);
      expect(p.rev).toBe(2);
      expect(Object.keys(p)).toEqual([...Object.keys(s.edges[id]!.props), 'covered']);
    }
    const removed = setProps(['n_A_1_main'], { name: undefined }).apply(s);
    expect('name' in removed.nodes['n_A_1_main']!.props).toBe(false);
  });

  it('changes buildings by Feature id and rooms like any Feature', async () => {
    const s = await fixtureState();
    const next = setProps(['bldg_B'], { name: 'B동(신관)' }).apply(s);
    expect(next.buildings['B']!.props).toMatchObject({ name: 'B동(신관)', rev: 2 });
  });

  it('keeps unrelated properties (elevator_id, step_free null, incline, conveying)', async () => {
    const s = await fixtureState();
    const next = setProps(['e_out_0002__out_0003_esc', 'n_A_elevA_L1'], { needs_check: true }).apply(s);
    expect(next.edges['e_out_0002__out_0003_esc']!.props).toMatchObject({ incline: 'up', conveying: 'forward', step_free: false });
    expect(next.nodes['n_A_elevA_L1']!.props.elevator_id).toBe('A_elevA');
  });

  it('is disabled for structural keys', async () => {
    const s = await fixtureState();
    for (const k of ['id', 'kind', 'rev', 'from', 'to', 'building_id', 'level', 'code']) {
      expect(setProps(['n_A_1_hall'], { [k]: 'x' }).disabled(s)).toMatch(/바꿀 수 없습니다/);
    }
    expect(setProps(['n_A_1_hall'], {}).disabled(s)).toMatch(/바꿀 속성/);
    expect(setProps(['n_nope'], { name: 'x' }).disabled(s)).toMatch(/n_nope/);
  });

  it('is disabled when a new elevator_id breaks I5, or a portal turned flat crosses scopes (I4)', async () => {
    const s = await fixtureState();
    expect(setProps(['n_B_2_hall'], { node_type: 'elevator_stop', elevator_id: 'A_elevA' }).disabled(s)).toMatch(/I5|elevator_id/);
    expect(setProps(['e_portal_A_1_main'], { edge_type: 'outdoor' }).disabled(s)).toMatch(/평지 구간/);
    expect(setProps(['n_A_1_hall'], { elevator_id: 'A_elevA' }).disabled(s)).toBe(false); // not a stop: I5 does not apply
    expect(checkInvariants(setProps(['n_A_1_hall'], { elevator_id: 'A_elevA' }).apply(s))).toEqual([]);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), setProps(['n_A_1_main'], { name: undefined, ref: 'M' }));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), setProps(['n_A_1_main', 'e_A_1_hall__A_1_esc'], { name: undefined, needs_check: true }));
  });
});
