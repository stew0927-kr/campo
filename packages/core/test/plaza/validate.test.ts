// Plaza schema (campo.schema.json $defs/plazaProperties) and checks E16 / E17 / E18 / W18 (SPEC-v0.2 §8).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES as E, WARNING_CODES as W, isValidFeature, validateCampus, type LoadedCampus, type Position } from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';
import { rect, ring } from './helpers.ts';

const PLAZA_DIR = fileURLToPath(new URL('../fixtures/campus-plaza', import.meta.url));
const meta = { id: 't', schema_version: '0.2', name: 't', center: [127.0001, 37.0001], bbox: [126.99, 36.99, 127.01, 37.01] };

function plaza(id: string, coordinates: Position[][], extra: Record<string, unknown> = {}) {
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates }, properties: { kind: 'plaza', source: 't', rev: 1, ...extra } };
}
function campus(...features: unknown[]): LoadedCampus {
  return { meta, features: features.map((feature) => ({ file: 'outdoor.geojson', feature })), fileErrors: [] };
}
const codes = (c: LoadedCampus) => {
  const r = validateCampus(c, { now: new Date('2026-11-17T00:00:00Z') });
  return { errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code), result: r };
};

describe('plaza schema', () => {
  it('accepts a valid plaza with every property', () => {
    expect(isValidFeature(plaza('plaza_a', [rect(0, 0, 10, 10)], { name: '광장', surface: 'deck', fixed_height_m: 12.5, needs_check: true }))).toBe(true);
  });
  it('rejects unknown keys, out-of-range heights, bad surfaces, empty names and non-polygons', () => {
    expect(isValidFeature(plaza('p', [rect(0, 0, 10, 10)], { level: 1 }))).toBe(false);
    expect(isValidFeature(plaza('p', [rect(0, 0, 10, 10)], { fixed_height_m: 3000.5 }))).toBe(false);
    expect(isValidFeature(plaza('p', [rect(0, 0, 10, 10)], { fixed_height_m: -101 }))).toBe(false);
    expect(isValidFeature(plaza('p', [rect(0, 0, 10, 10)], { surface: 'lava' }))).toBe(false);
    expect(isValidFeature(plaza('p', [rect(0, 0, 10, 10)], { name: '' }))).toBe(false);
    expect(isValidFeature({ ...plaza('p', []), geometry: { type: 'Point', coordinates: [127, 37] } })).toBe(false);
  });
});

describe('plaza checks', () => {
  it('the campus-plaza fixture has no errors and no plaza warnings', async () => {
    const r = validateCampus(await loadCampus(PLAZA_DIR));
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.code.startsWith('plaza'))).toEqual([]);
  });
  it('E16: a ring crossing itself', () => {
    expect(codes(campus(plaza('p', [ring([[0, 0], [10, 10], [10, 0], [0, 10]])]))).errors).toEqual([E.plazaRingInvalid]);
  });
  it('E17: a hole outside or too close', () => {
    expect(codes(campus(plaza('p', [rect(0, 0, 10, 10), rect(8, 2, 12, 4, false)]))).errors).toEqual([E.plazaHoleInvalid]);
    expect(codes(campus(plaza('p', [rect(0, 0, 10, 10), rect(0.05, 2, 4, 4, false)]))).errors).toEqual([E.plazaHoleInvalid]);
  });
  it('E18: overlapping plazas, but not one inside the other\'s hole', () => {
    const r = codes(campus(plaza('a', [rect(0, 0, 10, 10)]), plaza('b', [rect(5, 5, 15, 15)])));
    expect(r.errors).toEqual([E.plazaOverlap]);
    expect(r.result.errors[0]!.featureId).toBe('b');
    expect(codes(campus(plaza('a', [rect(0, 0, 20, 20), rect(5, 5, 15, 15, false)]), plaza('b', [rect(7, 7, 13, 13)]))).errors).toEqual([]);
  });
  it('W18: a plaza over a building outline', () => {
    const building = {
      type: 'Feature', id: 'bldg_A', geometry: { type: 'Polygon', coordinates: [rect(5, 5, 15, 15)] },
      properties: { kind: 'building', name: 'A동', code: 'A', levels: [1], ground_levels: [1], source: 't', rev: 1 },
    };
    expect(codes(campus(building, plaza('p', [rect(0, 0, 10, 10)]))).warnings).toContain(W.plazaOverlapsBuilding);
    expect(codes(campus(building, plaza('p', [rect(0, 0, 20, 20), rect(4, 4, 16, 16, false)]))).warnings).not.toContain(W.plazaOverlapsBuilding);
  });
});
