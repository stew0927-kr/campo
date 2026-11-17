// Derived elevation values on edges (docs/ELEVATION_INTEGRATION.md): written only by setEdgeElevation, flipped by
// reverseEdge, dropped by a split or a heal (the next recompute writes them again). flat_exact / is_breakline stay.
import { describe, expect, it } from 'vitest';
import { checkInvariants, deleteNodes, reverseEdge, setEdgeElevation, splitEdgeAt, type EditState } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

const GATE_PATH = 'e_out_0001__out_0002'; // footway [127, 37] → [127.0002, 37.0004]
const DERIVED = { elev_diff_m: 1.5, elev_sigma_m: 0.2, grade_pct: 3.1 };

async function withDerived(): Promise<EditState> {
  return setEdgeElevation({ [GATE_PATH]: DERIVED }).apply(await fixtureState());
}

describe('setEdgeElevation', () => {
  it('writes the three values after the other properties, rev+1, and undoes', async () => {
    const s = await fixtureState();
    const next = expectUndoRedo(s, setEdgeElevation({ [GATE_PATH]: DERIVED }));
    expectInputUntouched(s, setEdgeElevation({ [GATE_PATH]: DERIVED }));
    const p = next.edges[GATE_PATH]!.props;
    expect(p).toMatchObject({ ...DERIVED, rev: 2 });
    expect(Object.keys(p).slice(-3)).toEqual(['elev_diff_m', 'elev_sigma_m', 'grade_pct']);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('null removes the values; unchanged values, other keys, bad numbers and missing edges are refused', async () => {
    const s = await withDerived();
    expect('grade_pct' in setEdgeElevation({ [GATE_PATH]: null }).apply(s).edges[GATE_PATH]!.props).toBe(false);
    expect(setEdgeElevation({ [GATE_PATH]: DERIVED }).disabled(s)).toBe('바뀔 고도 값이 없습니다.');
    expect(setEdgeElevation({ [GATE_PATH]: { hours: 1 } as never }).disabled(s)).toMatch('고도 값이 아닌 속성');
    expect(setEdgeElevation({ [GATE_PATH]: { elev_diff_m: Number.NaN } }).disabled(s)).toMatch('숫자가 아닙니다');
    expect(setEdgeElevation({ [GATE_PATH]: { elev_diff_m: 1, elev_sigma_m: 0 } }).disabled(s)).toMatch('0보다 커야');
    expect(setEdgeElevation({ e_nope: DERIVED }).disabled(s)).toMatch('없는 구간');
  });
});

describe('edits that change an edge keep its derived values honest', () => {
  it('reverseEdge flips the sign of elev_diff_m and grade_pct, σ stays', async () => {
    const s = await withDerived();
    const p = reverseEdge([GATE_PATH]).apply(s).edges[GATE_PATH]!.props;
    expect(p).toMatchObject({ from: 'n_out_0002', to: 'n_out_0001', elev_diff_m: -1.5, grade_pct: -3.1, elev_sigma_m: 0.2 });
  });

  it('splitEdgeAt drops the derived values from both pieces and keeps flat_exact', async () => {
    const s = setEdgeElevation({ e_out_0001__out_0006: DERIVED }).apply(await fixtureState());
    const next = splitEdgeAt('e_out_0001__out_0006', [127.0005, 37.00005], {}, ctx()).apply(s);
    const pieces = Object.values(next.edges).filter((e) => e.props.from === 'n_out_0001' || e.props.to === 'n_out_0006')
      .filter((e) => e.id === 'e_out_0001__out_0006' || !(e.id in s.edges));
    expect(pieces).toHaveLength(2);
    for (const e of pieces) {
      expect(e.props.flat_exact).toBe(true);
      expect(Object.keys(e.props).filter((k) => k.startsWith('elev_') || k === 'grade_pct')).toEqual([]);
    }
  });

  it('a heal is not blocked by different derived values and drops them from the kept edge', async () => {
    const base = await fixtureState();
    const s0 = splitEdgeAt(GATE_PATH, [127.0001, 37.0002], {}, ctx()).apply(base);
    const mid = Object.keys(s0.nodes).find((id) => !(id in base.nodes))!;
    const pieces = Object.values(s0.edges).filter((e) => e.props.from === mid || e.props.to === mid).map((e) => e.id);
    expect(pieces).toHaveLength(2);
    const s = setEdgeElevation({ [pieces[0]!]: { elev_diff_m: 1 }, [pieces[1]!]: { elev_diff_m: 0.5, grade_pct: 2 } }).apply(s0);
    const healed = deleteNodes([mid], { heal: true }).apply(s);
    const kept = Object.values(healed.edges).filter((e) => pieces.includes(e.id));
    expect(kept).toHaveLength(1);
    expect(kept[0]!.props).toMatchObject({ from: 'n_out_0001', to: 'n_out_0002' });
    expect('elev_diff_m' in kept[0]!.props).toBe(false);
  });
});
