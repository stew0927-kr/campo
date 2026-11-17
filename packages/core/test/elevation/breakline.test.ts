import { describe, expect, it } from 'vitest';
import {
  breaklineSideOf, dropMError, emptyElevationStore, oppositeSide, serializeElevationStore, withBreakLineProps, type BreakLine,
} from '../../src/elevation/index.ts';

// A line drawn eastwards (lng grows): north is its left, south its right.
const EAST: [number, number][] = [[127.0, 37.5], [127.001, 37.5]];
const LINE: BreakLine = { id: 'b1', coordinates: [{ lat: 37.5, lng: 127.0 }, { lat: 37.5, lng: 127.001 }], source: 'manual', createdAt: 1 };

describe('breaklineSideOf', () => {
  it('left is the left of the drawing direction, right the right', () => {
    expect(breaklineSideOf(EAST, [127.0005, 37.5001])).toBe('left');
    expect(breaklineSideOf(EAST, [127.0005, 37.4999])).toBe('right');
    // The same line drawn the other way swaps the sides.
    const west = [...EAST].reverse();
    expect(breaklineSideOf(west, [127.0005, 37.5001])).toBe('right');
  });

  it('judges on the nearest segment of a bent line, also past its ends', () => {
    // East, then north: a point east of the second segment is its right.
    const bent: [number, number][] = [[127.0, 37.5], [127.001, 37.5], [127.001, 37.501]];
    expect(breaklineSideOf(bent, [127.0012, 37.5008])).toBe('right');
    expect(breaklineSideOf(bent, [127.0008, 37.5008])).toBe('left');
    expect(breaklineSideOf(EAST, [127.002, 37.5001])).toBe('left');
  });

  it('needs two points', () => {
    expect(breaklineSideOf([[127, 37.5]], [127, 37.6])).toBeNull();
  });
});

describe('withBreakLineProps', () => {
  it('sets and clears lowSide and dropM without touching the input', () => {
    const set = withBreakLineProps(LINE, { lowSide: 'left', dropM: 1.5 });
    expect(set).toMatchObject({ lowSide: 'left', dropM: 1.5 });
    expect(LINE.lowSide).toBeUndefined();
    const cleared = withBreakLineProps(set as BreakLine, { lowSide: null, dropM: null });
    expect('lowSide' in cleared).toBe(false);
    expect('dropM' in cleared).toBe(false);
    expect(oppositeSide('left')).toBe('right');
  });

  it('refuses a negative, non-finite or huge dropM', () => {
    expect(withBreakLineProps(LINE, { dropM: -0.5 })).toHaveProperty('error');
    expect(withBreakLineProps(LINE, { dropM: Number.NaN })).toHaveProperty('error');
    expect(dropMError(250)).not.toBeNull();
    expect(dropMError(0)).toBeNull();
  });
});

describe('serializeElevationStore and break lines', () => {
  it('keeps lowSide and dropM, and an old line without them stays without them', () => {
    const store = { ...emptyElevationStore(), breaklines: [{ ...LINE, lowSide: 'right' as const, dropM: 2 }, { ...LINE, id: 'old' }] };
    const back = JSON.parse(serializeElevationStore(store)) as { breaklines: Record<string, unknown>[] };
    expect(back.breaklines[0]).toMatchObject({ lowSide: 'right', dropM: 2 });
    expect(Object.keys(back.breaklines[1]!).sort()).toEqual(['coordinates', 'createdAt', 'id', 'source']);
  });
});
