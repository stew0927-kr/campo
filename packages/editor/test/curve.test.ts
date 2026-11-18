// 곡선 길 (curve.ts): a smooth line through the control points, as the bend points of each segment.
import { describe, expect, it } from 'vitest';
import type { Position } from '@campo/core';
import { CURVE_SAMPLING, curveLine, curveSegments } from '../src/model/curve.ts';

const C: Position[] = [[127.0, 37.0], [127.0003, 37.0004], [127.0007, 37.0003], [127.001, 37.0007]];
const M_LAT = 110574;
const M_LNG = 111320 * Math.cos((37 * Math.PI) / 180);
const meters = (a: Position, b: Position) => Math.hypot((b[0] - a[0]) * M_LNG, (b[1] - a[1]) * M_LAT);
const length = (line: readonly Position[]) => line.slice(1).reduce((s, p, i) => s + meters(line[i]!, p), 0);

describe('curveSegments', () => {
  it('gives one list per segment, strictly between its two controls', () => {
    const segs = curveSegments(C);
    expect(segs).toHaveLength(C.length - 1);
    for (const [i, seg] of segs.entries()) {
      expect(seg.length).toBeGreaterThan(0);
      expect(seg).not.toContainEqual(C[i]);
      expect(seg).not.toContainEqual(C[i + 1]);
    }
  });

  it('passes exactly through every control point, first and last included', () => {
    const line = curveLine(C);
    expect(line[0]).toEqual(C[0]);
    expect(line[line.length - 1]).toEqual(C[C.length - 1]);
    for (const c of C) expect(line).toContainEqual(c);
  });

  it('is deterministic: the same input gives the same output, and the input is not changed', () => {
    const copy = JSON.parse(JSON.stringify(C)) as Position[];
    expect(curveSegments(C)).toEqual(curveSegments(copy));
    expect(C).toEqual(copy);
  });

  it('bounds the samples per segment, rounds to 7 decimals, and keeps the points apart', () => {
    const long: Position[] = [[127, 37], [127.01, 37.004], [127.02, 37]]; // about 1 km a segment: the upper bound applies
    for (const seg of curveSegments(long)) expect(seg.length).toBeLessThanOrEqual(CURVE_SAMPLING.max - 1);
    for (const seg of curveSegments(C)) {
      expect(seg.length).toBeLessThanOrEqual(CURVE_SAMPLING.max - 1);
      for (const p of seg) expect(p.every((v) => Math.abs(v * 1e7 - Math.round(v * 1e7)) < 1e-3)).toBe(true);
    }
    const tiny: Position[] = [[127, 37], [127.0000002, 37.0000002], [127.00002, 37]]; // a 2 cm segment: no point closer than 5 cm
    for (const seg of curveSegments(tiny)) expect(seg.length).toBeLessThan(CURVE_SAMPLING.min);
  });

  it('is longer than the straight line between the controls and bends away from it', () => {
    const line = curveLine(C);
    const straight = length(C);
    expect(length(line)).toBeGreaterThan(straight);
    expect(length(line)).toBeLessThan(straight * 1.3);
  });

  it('two controls are the straight line (nothing between), one or none draw nothing', () => {
    expect(curveSegments([[127, 37], [127.001, 37]])).toEqual([[]]);
    expect(curveLine([[127, 37], [127.001, 37]])).toEqual([[127, 37], [127.001, 37]]);
    expect(curveSegments([[127, 37]])).toEqual([]);
    expect(curveSegments([])).toEqual([]);
  });

  it('ignores a control repeated right after itself (a double click)', () => {
    expect(curveSegments([C[0]!, C[0]!, C[1]!, C[2]!, C[2]!])).toEqual(curveSegments([C[0]!, C[1]!, C[2]!]));
  });

  it('three points on a line stay on the line', () => {
    const flat: Position[] = [[127, 37], [127.0005, 37], [127.001, 37]];
    for (const p of curveLine(flat)) expect(p[1]).toBe(37);
  });

  it('can close a loop (first control equal to the last)', () => {
    const loop: Position[] = [[127, 37], [127.0003, 37], [127.0003, 37.0003], [127, 37.0003], [127, 37]];
    const line = curveLine(loop);
    expect(curveSegments(loop)).toHaveLength(4);
    expect(line[0]).toEqual(line[line.length - 1]);
    expect(line.every((p) => p.every(Number.isFinite))).toBe(true);
  });
});

describe('curvePreviewGeoJSON (the live preview)', () => {
  it('draws the same line the finished path gets, plus the control points and the pointer', async () => {
    const { curvePreviewGeoJSON } = await import('../src/map/layers.ts');
    const cursor: Position = [127.0012, 37.0009];
    const line = curveLine([...C, cursor]);
    const fc = curvePreviewGeoJSON(C, cursor, line);
    const byRole = (role: string) => fc.features.filter((f) => f.properties?.['role'] === role);
    expect(byRole('curve')).toHaveLength(1);
    expect(byRole('curve')[0]!.geometry).toEqual({ type: 'LineString', coordinates: line });
    expect(byRole('ctrl')).toHaveLength(C.length);
    expect(byRole('cursor')).toHaveLength(1);
    expect(curvePreviewGeoJSON([], null, []).features).toEqual([]);
  });
});
