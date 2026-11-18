// Edge width (width_m): the default, the accepted range and the effective width read everywhere else.
import { describe, expect, it } from 'vitest';
import { DEFAULT_EDGE_WIDTH_M, EDGE_WIDTH_MAX_M, EDGE_WIDTH_MIN_M, edgeWidthM, isValidEdgeWidth } from '../src/index.ts';

describe('edgeWidthM', () => {
  it('is width_m when it is there and valid, 2.0 m otherwise', () => {
    expect(edgeWidthM({})).toBe(2);
    expect(edgeWidthM({ width_m: 3.5 })).toBe(3.5);
    expect(edgeWidthM({ width_m: 0.2 })).toBe(2); // out of range: the default
    expect(edgeWidthM({ width_m: Number.NaN })).toBe(2);
  });

  it('falls back to the default for anything that is not a number in range', () => {
    for (const bad of [Number.POSITIVE_INFINITY, -1, 20.01, '3', null, true]) expect(edgeWidthM({ width_m: bad }), String(bad)).toBe(DEFAULT_EDGE_WIDTH_M);
    expect(edgeWidthM({ width_m: EDGE_WIDTH_MIN_M })).toBe(0.5);
    expect(edgeWidthM({ width_m: EDGE_WIDTH_MAX_M })).toBe(20);
  });
});

describe('isValidEdgeWidth', () => {
  it('takes a finite number from 0.5 to 20 m, both ends included', () => {
    expect(isValidEdgeWidth(0.5)).toBe(true);
    expect(isValidEdgeWidth(20)).toBe(true);
    expect(isValidEdgeWidth(0.49)).toBe(false);
    expect(isValidEdgeWidth(20.01)).toBe(false);
    expect(isValidEdgeWidth('2')).toBe(false);
    expect(isValidEdgeWidth(Number.NaN)).toBe(false);
    expect(isValidEdgeWidth(undefined)).toBe(false);
  });

  it('has the constants the schema uses', () => {
    expect([DEFAULT_EDGE_WIDTH_M, EDGE_WIDTH_MIN_M, EDGE_WIDTH_MAX_M]).toEqual([2.0, 0.5, 20]);
  });
});
