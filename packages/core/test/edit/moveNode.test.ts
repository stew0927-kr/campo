import { describe, expect, it } from 'vitest';
import { checkInvariants, edgeCoords, moveNode, toFeatures } from '../../src/index.ts';
import { expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

describe('moveNode', () => {
  it('moves a node; its edges follow and get rev+1, others stay', async () => {
    const s = await fixtureState();
    const next = moveNode('n_A_3_north', [127.00071, 37.00071]).apply(s);
    expect(next.nodes['n_A_3_north']!.coord).toEqual([127.00071, 37.00071]);
    expect(next.nodes['n_A_3_north']!.props.rev).toBe(2);
    for (const id of ['e_A_3_hall__A_3_north', 'e_A_3_north__C_5_bridge']) {
      expect(next.edges[id]!.props.rev).toBe(2);
    }
    expect(next.edges['e_A_3_hall__A_3_bridge']!.props.rev).toBe(1);
    const saved = toFeatures(next).find((f) => f.id === 'e_A_3_north__C_5_bridge')!;
    expect((saved.geometry.coordinates as number[][])[0]).toEqual([127.00071, 37.00071]);
    expect(edgeCoords(next, next.edges['e_A_3_hall__A_3_north']!).at(-1)).toEqual([127.00071, 37.00071]);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('an elevator stop moves every stop of its elevator_id together (I5)', async () => {
    const s = await fixtureState();
    const to: [number, number] = [127.00082, 37.00052];
    const next = moveNode('n_A_elevA_L3', to).apply(s);
    for (const id of ['n_A_elevA_L1', 'n_A_elevA_L2', 'n_A_elevA_L3', 'n_A_elevA_L4']) {
      expect(next.nodes[id]!.coord).toEqual(to);
      expect(next.nodes[id]!.props.rev).toBe(2);
    }
    expect(next.edges['e_A_elevA_L1__A_elevA_L2']!.props.rev).toBe(2);
    expect(next.edges['e_A_1_hall__A_elevA_L1']!.props.rev).toBe(2);
    expect(next.nodes['n_A_1_hall']!.props.rev).toBe(1);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('is disabled for a missing node or a bad coordinate', async () => {
    const s = await fixtureState();
    expect(moveNode('n_nope', [127, 37]).disabled(s)).toMatch(/없습니다/);
    expect(moveNode('n_A_1_hall', [Number.NaN, 37]).disabled(s)).toMatch(/좌표/);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), moveNode('n_A_elevA_L1', [127.0009, 37.0006]));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), moveNode('n_A_elevA_L1', [127.0009, 37.0006]));
  });
});
