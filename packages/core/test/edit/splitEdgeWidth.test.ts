// Splitting an edge keeps its width on both pieces (width_m is a fact about the way, like flat_exact).
import { describe, expect, it } from 'vitest';
import { checkInvariants, splitEdgeAt, type EditState } from '../../src/index.ts';
import { ctx, fixtureState } from './helpers.ts';

const WIDE = 'e_out_0001__out_0006'; // fixture footway with width_m 3.0
const PLAIN = 'e_out_0001__out_0002'; // fixture footway without width_m

function pieces(before: EditState, after: EditState, id: string) {
  const { from, to } = before.edges[id]!.props;
  return Object.values(after.edges).filter((e) => e.id === id || (!(e.id in before.edges) && (e.props.from === from || e.props.to === to)));
}

describe('splitEdgeAt and width_m', () => {
  it('a 3 m edge splits into two 3 m pieces', async () => {
    const s = await fixtureState();
    expect(s.edges[WIDE]!.props.width_m).toBe(3);
    const next = splitEdgeAt(WIDE, [127.0005, 37.00005], {}, ctx()).apply(s);
    const two = pieces(s, next, WIDE);
    expect(two).toHaveLength(2);
    for (const e of two) expect(e.props.width_m).toBe(3);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('an edge without width_m splits into two pieces without the key', async () => {
    const s = await fixtureState();
    expect('width_m' in s.edges[PLAIN]!.props).toBe(false);
    const next = splitEdgeAt(PLAIN, [127.0001, 37.0002], {}, ctx()).apply(s);
    const two = pieces(s, next, PLAIN);
    expect(two).toHaveLength(2);
    for (const e of two) expect('width_m' in e.props).toBe(false);
  });
});
