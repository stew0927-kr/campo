import { describe, expect, it } from 'vitest';
import { createIdGen, edgeFileScope, freshId, type IdGen } from '../../src/index.ts';
import { fixtureState } from './helpers.ts';

describe('ids', () => {
  it('same seed, same tails; six lowercase base-36 characters', () => {
    const a = createIdGen(123);
    const b = createIdGen(123);
    const tails = Array.from({ length: 50 }, () => a.tail());
    expect(Array.from({ length: 50 }, () => b.tail())).toEqual(tails);
    expect(tails.every((t) => /^[0-9a-z]{6}$/.test(t))).toBe(true);
    expect(new Set(tails).size).toBe(50);
    expect(createIdGen(124).tail()).not.toBe(tails[0]);
  });

  it('a taken id is redrawn from the same generator', async () => {
    const s = await fixtureState();
    const tails = ['0001__out_0002', 'zzzzzz'];
    const gen: IdGen = { tail: () => tails.shift()! };
    expect(freshId(s, gen, 'e_out_')).toBe('e_out_zzzzzz');
    expect(freshId(s, createIdGen(1), 'n_out_', new Set([`n_out_${createIdGen(1).tail()}`]))).toBe(`n_out_${(() => { const g = createIdGen(1); g.tail(); return g.tail(); })()}`);
  });

  it('edge file scope: portal / bridge / mixed → connections, both outdoor → outdoor, one building → lower level', () => {
    const out = { building_id: null, level: null };
    const a2 = { building_id: 'bldg_A', level: 2 };
    const a1 = { building_id: 'bldg_A', level: 1 };
    const b1 = { building_id: 'bldg_B', level: 1 };
    expect(edgeFileScope('portal', a1, out)).toEqual({ kind: 'connections' });
    expect(edgeFileScope('bridge', a1, b1)).toEqual({ kind: 'connections' });
    expect(edgeFileScope('indoor', a1, b1)).toEqual({ kind: 'connections' });
    expect(edgeFileScope('outdoor', out, a1)).toEqual({ kind: 'connections' });
    expect(edgeFileScope('outdoor', out, out)).toEqual({ kind: 'outdoor' });
    expect(edgeFileScope('indoor', a2, a1)).toEqual({ kind: 'building', buildingId: 'bldg_A', level: 1 });
  });
});
