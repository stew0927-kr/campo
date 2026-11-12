import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { checkInvariants, createHistory, edgeCoords, reverseEdge } from '../../src/index.ts';
import { expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

const UP = 'e_A_1_esc__A_2_esc_up'; // escalator: conveying forward, incline up, levels 1 → 2
const BRIDGE = 'e_A_3_bridge__B_2_bridge'; // bridge: A 3F → B 2F

describe('reverseEdge', () => {
  it('turns from / to, vertices, conveying, incline and the level / building ends around, rev+1', async () => {
    const s0 = await fixtureState();
    const s = produce(s0, (d) => {
      d.edges[UP]!.vertices = [[127.00061, 37.00058], [127.00062, 37.0006]];
    });
    const next = reverseEdge([UP]).apply(s);
    const e = next.edges[UP]!;
    expect(e.props).toMatchObject({ from: 'n_A_2_esc', to: 'n_A_1_esc', conveying: 'backward', incline: 'down', level_from: 2, level_to: 1, bidirectional: false, rev: 2 });
    expect(e.vertices).toEqual([[127.00062, 37.0006], [127.00061, 37.00058]]);
    expect(edgeCoords(next, e)).toEqual([...edgeCoords(s, s.edges[UP]!)].reverse());
    expect(checkInvariants(next)).toEqual([]);

    const bridge = reverseEdge([BRIDGE]).apply(s).edges[BRIDGE]!;
    expect(bridge.props).toMatchObject({ from: 'n_B_2_bridge', to: 'n_A_3_bridge', building_from: 'bldg_B', building_to: 'bldg_A', level_from: 2, level_to: 3 });
  });

  it('reversible stays reversible, a plain edge keeps its other properties and key order', async () => {
    const s0 = await fixtureState();
    const s = produce(s0, (d) => {
      d.edges[UP]!.props.conveying = 'reversible';
      d.edges[UP]!.props.bidirectional = true;
    });
    expect(reverseEdge([UP]).apply(s).edges[UP]!.props.conveying).toBe('reversible');

    const id = 'e_A_4_hall__A_4_stair';
    const before = s0.edges[id]!.props;
    const after = reverseEdge([id]).apply(s0).edges[id]!.props;
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after).toEqual({ ...before, from: before.to, to: before.from, rev: 2 });
  });

  it('twice gives the original geometry and meaning (rev counts both turns)', async () => {
    const s = await fixtureState();
    const twice = reverseEdge([UP, BRIDGE]).apply(reverseEdge([UP, BRIDGE]).apply(s));
    for (const id of [UP, BRIDGE]) {
      expect(twice.edges[id]).toEqual({ ...s.edges[id], props: { ...s.edges[id]!.props, rev: 3 } });
    }
  });

  it('one history entry; the history rev rule makes a turn and a turn back +0', async () => {
    const s = await fixtureState();
    const h = createHistory(s);
    h.perform(reverseEdge([UP, BRIDGE]));
    expect(h.size()).toBe(1);
    expect(h.current().edges[UP]!.props.rev).toBe(2);
    h.perform(reverseEdge([UP]));
    expect(h.current().edges[UP]!.props.rev).toBe(1); // back to what was loaded
    expect(h.current().edges[BRIDGE]!.props.rev).toBe(2);
  });

  it('is disabled for a missing edge, frozen input stays untouched, undo / redo work', async () => {
    const s = await fixtureState();
    expect(reverseEdge(['nope']).disabled(s)).toMatch(/없는 구간/);
    expect(reverseEdge([]).disabled(s)).toMatch(/하나 이상/);
    expectInputUntouched(s, reverseEdge([UP]));
    expectUndoRedo(s, reverseEdge([UP]));
  });
});

