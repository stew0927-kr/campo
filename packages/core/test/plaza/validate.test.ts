// Plaza schema (campo.schema.json $defs/plazaProperties) and checks E16 / E17 / W17 / W18; touching or overlapping plazas are linked (no E18) (SPEC-v0.2 §8).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES as E, WARNING_CODES as W, isValidFeature, validateCampus, type LoadedCampus, type Position } from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';
import { P, rect, ring } from './helpers.ts';

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
  it('touching or overlapping plazas are fine (E18 was removed): no error, linked', () => {
    expect(codes(campus(plaza('a', [rect(0, 0, 10, 10)]), plaza('b', [rect(5, 5, 15, 15)]))).errors).toEqual([]);
    expect(codes(campus(plaza('a', [rect(0, 0, 10, 10)]), plaza('b', [rect(10, 0, 20, 10)]))).errors).toEqual([]);
    expect(codes(campus(plaza('a', [rect(0, 0, 20, 20), rect(5, 5, 15, 15, false)]), plaza('b', [rect(7, 7, 13, 13)]))).errors).toEqual([]);
  });
  it('W17: a plaza that touches no outdoor node or walkable edge', () => {
    expect(codes(campus(plaza('p', [rect(0, 0, 10, 10)]))).warnings).toContain(W.plazaNoContact);
    const n = (id: string, x: number, y: number) => ({
      type: 'Feature', id, geometry: { type: 'Point', coordinates: P(x, y) },
      properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 't', rev: 1 },
    });
    const e = {
      type: 'Feature', id: 'e', geometry: { type: 'LineString', coordinates: [P(-5, 5), P(15, 5)] },
      properties: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'a', to: 'b', bidirectional: true, step_free: true, source: 't', rev: 1 },
    };
    expect(codes(campus(plaza('p', [rect(0, 0, 10, 10)]), n('a', -5, 5), n('b', 15, 5), e)).warnings).not.toContain(W.plazaNoContact);
    expect(codes(campus(plaza('p', [rect(0, 0, 10, 10)]), n('a', 5, 5))).warnings).not.toContain(W.plazaNoContact);
  });
  it('W17: a plaza reaching the network only through linked plazas has no warning; an isolated one still has', () => {
    const n = {
      type: 'Feature', id: 'n', geometry: { type: 'Point', coordinates: P(25, 5) },
      properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 't', rev: 1 },
    };
    const chain = [plaza('a', [rect(0, 0, 10, 10)]), plaza('b', [rect(10, 0, 20, 10)]), plaza('c', [rect(18, 0, 30, 10)])];
    const r = codes(campus(...chain, n));
    expect(r.warnings).not.toContain(W.plazaNoContact);
    const lone = codes(campus(...chain, n, plaza('d', [rect(50, 0, 60, 10)])));
    expect(lone.result.warnings.filter((w) => w.code === W.plazaNoContact).map((w) => w.featureId)).toEqual(['d']);
    // The same chain with no node anywhere: every plaza of it is warned about.
    expect(codes(campus(...chain)).result.warnings.filter((w) => w.code === W.plazaNoContact).map((w) => w.featureId)).toEqual(['a', 'b', 'c']);
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
