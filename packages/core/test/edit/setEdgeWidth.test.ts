// setEdgeWidth: the width of one or more edges in one history entry; null goes back to the default (2.0 m).
import { describe, expect, it } from 'vitest';
import { checkInvariants, setEdgeWidth, type EditState } from '../../src/index.ts';
import { expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

const WIDE = 'e_out_0001__out_0006'; // fixture footway with width_m 3.0
const PLAIN = 'e_out_0001__out_0002'; // fixture footway without width_m

describe('setEdgeWidth', () => {
  it('sets width_m on one edge, rev+1, and undoes', async () => {
    const s = await fixtureState();
    const next = expectUndoRedo(s, setEdgeWidth([PLAIN], 2.5));
    expectInputUntouched(s, setEdgeWidth([PLAIN], 2.5));
    expect(next.edges[PLAIN]!.props).toMatchObject({ width_m: 2.5, rev: s.edges[PLAIN]!.props.rev + 1 });
    expect(checkInvariants(next)).toEqual([]);
  });

  it('sets several edges at once; an edge that already has the width is left alone (no rev bump)', async () => {
    const s = await fixtureState();
    const next = setEdgeWidth([PLAIN, WIDE], 3).apply(s);
    expect(next.edges[PLAIN]!.props.width_m).toBe(3);
    expect(next.edges[WIDE]!.props.width_m).toBe(3);
    expect(next.edges[WIDE]!.props.rev).toBe(s.edges[WIDE]!.props.rev);
    expect(next.edges[PLAIN]!.props.rev).toBe(s.edges[PLAIN]!.props.rev + 1);
  });

  it('null removes the key (back to the default 2.0 m)', async () => {
    const s = await fixtureState();
    const next: EditState = setEdgeWidth([WIDE], null).apply(s);
    expect('width_m' in next.edges[WIDE]!.props).toBe(false);
    expect(next.edges[WIDE]!.props.rev).toBe(s.edges[WIDE]!.props.rev + 1);
  });

  it('refuses widths out of 0.5 to 20 m, non-numbers, missing edges and no change', async () => {
    const s = await fixtureState();
    for (const bad of [0.3, 0.49, 20.01, 50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(setEdgeWidth([PLAIN], bad).disabled(s), String(bad)).toBe('길 폭은 0.5 m 이상 20 m 이하로 입력해 주세요.');
      expect(setEdgeWidth([PLAIN], bad).apply(s)).toBe(s);
    }
    expect(setEdgeWidth([PLAIN], '2' as never).disabled(s)).toBe('길 폭은 0.5 m 이상 20 m 이하로 입력해 주세요.');
    expect(setEdgeWidth(['e_nope'], 2).disabled(s)).toMatch('없는 구간');
    expect(setEdgeWidth([], 2).disabled(s)).toMatch('하나 이상 골라');
    expect(setEdgeWidth([WIDE], 3).disabled(s)).toBe('바뀔 길 폭이 없습니다.');
    expect(setEdgeWidth([PLAIN], null).disabled(s)).toBe('바뀔 길 폭이 없습니다.');
    expect(setEdgeWidth([PLAIN], 0.5).disabled(s)).toBe(false);
    expect(setEdgeWidth([PLAIN], 20).disabled(s)).toBe(false);
  });
});
