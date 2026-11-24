// Route display helpers: dashed connectors, merged slope sections (with their slice of the route line),
// the indoor outside-veil and the compass needle. All pure functions, run in Node.
import { STEEP_NOTE } from '@campo/core';
import { describe, expect, it } from 'vitest';
import type { SlopeWarning } from '../src/contracts.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { slopeSections } from '../src/route/slopeSections.ts';
import { compassState, distanceM, insideOutline, normalizeBearing, outsideMask, routeConnectors } from '../src/features/map/model.ts';
import { META, bundleFrom, edgeFeature, nodeFeature } from './helpers.ts';

/** About 1.11 m of latitude per 0.00001°. */
const DEG_PER_M = 1 / 111_195;

describe('routeConnectors', () => {
  const polyline = [{ lng: 127, lat: 37 }, { lng: 127, lat: 37.001 }];
  it('joins a pin 1.5 m or more away to the line end, from pin → line start and line end → pin', () => {
    const from = { lng: 127 - 5 * DEG_PER_M, lat: 37 };
    const to = { lng: 127, lat: 37.001 + 3 * DEG_PER_M };
    const out = routeConnectors(polyline, from, to);
    expect(out.features).toHaveLength(2);
    expect(out.features[0]!.properties.end).toBe('from');
    expect(out.features[0]!.geometry.coordinates).toEqual([[from.lng, from.lat], [127, 37]]);
    expect(out.features[1]!.properties.end).toBe('to');
    expect(out.features[1]!.geometry.coordinates).toEqual([[127, 37.001], [to.lng, to.lat]]);
  });
  it('draws nothing for a gap under 1.5 m, missing pins, or an empty line', () => {
    const near = { lng: 127, lat: 37 + 1.2 * DEG_PER_M };
    expect(distanceM([near.lng, near.lat], [127, 37])).toBeLessThan(1.5);
    expect(routeConnectors(polyline, near, null).features).toEqual([]);
    expect(routeConnectors(polyline, null, null).features).toEqual([]);
    expect(routeConnectors([], { lng: 127, lat: 37 }, { lng: 127, lat: 37 }).features).toEqual([]);
  });
  it('treats exactly the threshold as a gap', () => {
    const from = { lng: 127, lat: 37 - 1.6 * DEG_PER_M };
    expect(routeConnectors(polyline, from, null).features).toHaveLength(1);
    expect(routeConnectors(polyline, from, null, 2).features).toHaveLength(0);
  });
});

const warning = (edgeId: string, gradePct: number, range: [number, number] | null, gradeClass: SlopeWarning['gradeClass'] = 'steep'): SlopeWarning => {
  const base: SlopeWarning = { edgeId, gradePct, gradeClass, message: `${edgeId}` };
  if (!range) return base;
  const coordinates = Array.from({ length: range[1] - range[0] + 1 }, (_, i): [number, number] => [127, 37 + (range[0] + i) * 0.0001]);
  return { ...base, polylineRange: range, coordinates };
};

describe('slopeSections', () => {
  it('merges two connected steep edges in the same direction into one card with the joined coordinates', () => {
    const sections = slopeSections([warning('a', -9.4, [0, 1]), warning('b', -12.6, [1, 3])]);
    expect(sections).toHaveLength(1);
    const [section] = sections;
    expect(section!.direction).toBe('down');
    expect(section!.maxGradePct).toBe(12.6);
    expect(section!.warnings.map((w) => w.edgeId)).toEqual(['a', 'b']);
    // The shared point (index 1) appears once.
    expect(section!.coordinates).toEqual([[127, 37], [127, 37.0001], [127, 37.0002], [127, 37.0003]]);
    expect(section!.lengthM).toBeCloseTo(3 * 0.0001 * 111_195, -1);
    expect(section!.message).toBe(`급경사 구간 (내리막 · 최대 12.6% · 약 ${Math.round(section!.lengthM!)}m) · ${STEEP_NOTE}`);
  });
  it('splits when the direction changes', () => {
    const sections = slopeSections([warning('a', 10, [0, 1]), warning('b', -10, [1, 2])]);
    expect(sections.map((s) => s.direction)).toEqual(['up', 'down']);
    expect(sections.map((s) => s.key)).toEqual(['0:a', '1:b']);
  });
  it('is broken by a caution-grade slope in between, and by a gap in the route line', () => {
    const withCaution = slopeSections([warning('a', 10, [0, 1]), warning('c', 6, [1, 2], 'caution'), warning('b', 11, [2, 3])]);
    expect(withCaution.map((s) => s.gradeClass)).toEqual(['steep', 'caution', 'steep']);
    expect(withCaution[1]!.message).toMatch(/^경사 구간 \(오르막 · 최대 6% · 약 \d+m\)$/);
    // A gentle stretch between them: index 1 → 2 is not a slope warning.
    const withGap = slopeSections([warning('a', 10, [0, 1]), warning('b', 11, [2, 3])]);
    expect(withGap).toHaveLength(2);
  });
  it('keeps a warning that could not be placed on the line as its own card without coordinates', () => {
    const sections = slopeSections([warning('a', 10, null), warning('b', 10, [0, 1])]);
    expect(sections).toHaveLength(2);
    expect(sections[0]!.coordinates).toEqual([]);
    expect(sections[0]!.lengthM).toBeNull();
    expect(sections[0]!.message).toBe(`급경사 구간 (오르막 · 최대 10%) · ${STEEP_NOTE}`);
    expect(slopeSections([])).toEqual([]);
  });
});

describe('slope warnings carry their slice of the route line', () => {
  // n0 → n1 → n2 → n3, all downhill: two steep edges, then a gentle one.
  const runtime = loadBundledCampus(bundleFrom(META, [
    nodeFeature('n0', 127.0, 37.0), nodeFeature('n1', 127.0, 37.0005), nodeFeature('n2', 127.0, 37.001), nodeFeature('n3', 127.0, 37.0015),
    edgeFeature('e01', 'n0', 'n1', [[127.0, 37.0], [127.0, 37.0005]], { grade_pct: -9.5, elev_sigma_m: 0.2 }),
    edgeFeature('e12', 'n1', 'n2', [[127.0, 37.0005], [127.0, 37.001]], { grade_pct: -12.6, elev_sigma_m: 0.2 }),
    edgeFeature('e23', 'n2', 'n3', [[127.0, 37.001], [127.0, 37.0015]], { grade_pct: -1, elev_sigma_m: 0.2 }),
  ]));

  it('keeps one warning per edge (unchanged contract) and adds polylineRange and coordinates', () => {
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: 'n0' }, to: { kind: 'node', nodeId: 'n3' } });
    expect(state.status).toBe('ok');
    const warnings = state.route!.slopeWarnings;
    expect(warnings.map((w) => [w.edgeId, w.gradeClass, w.polylineRange])).toEqual([['e01', 'steep', [0, 1]], ['e12', 'steep', [1, 2]]]);
    expect(warnings[1]!.message).toContain(STEEP_NOTE);
    expect(warnings[1]!.coordinates).toEqual([[127.0, 37.0005], [127.0, 37.001]]);
    const sections = slopeSections(warnings);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.coordinates).toEqual([[127.0, 37.0], [127.0, 37.0005], [127.0, 37.001]]);
    expect(sections[0]!.message).toContain('급경사 구간 (내리막 · 최대 12.6% · 약 111m)');
  });

  it('slices from the snapped foot when the start is a point picked on the map', () => {
    // A point beside e12, a quarter of the way along it, walking up the hill to n0.
    const state = computeRoute(runtime, { from: { kind: 'point', lng: 127.00002, lat: 37.000625 }, to: { kind: 'node', nodeId: 'n0' } });
    expect(state.status).toBe('ok');
    const route = state.route!;
    const foot = route.polyline[0]!;
    expect(foot.lat).toBeCloseTo(37.000625, 6);
    expect(route.slopeWarnings.map((w) => [w.edgeId, w.polylineRange])).toEqual([['e12', [0, 1]], ['e01', [1, 2]]]);
    expect(route.slopeWarnings[0]!.coordinates![0]).toEqual([foot.lng, foot.lat]);
    const sections = slopeSections(route.slopeWarnings);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.direction).toBe('up');
    expect(sections[0]!.coordinates).toHaveLength(3);
    // The pin sits 2 m beside the way: the map joins it to the line's start with a dashed connector.
    expect(routeConnectors(route.polyline, { lng: 127.00002, lat: 37.000625 }, null).features).toHaveLength(1);
  });
});

describe('indoor outside-veil', () => {
  // A counter-clockwise building ring; the mask must turn either winding into a clockwise hole.
  const ccw = [[127.0, 37.0], [127.001, 37.0], [127.001, 37.001], [127.0, 37.001], [127.0, 37.0]];
  const area = (ring: number[][]) => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]!; return sum + p[0]! * q[1]! - q[0]! * p[1]!; }, 0);
  it('covers the bounds with the building cut out as a clockwise hole', () => {
    for (const ring of [ccw, [...ccw].reverse()]) {
      const mask = outsideMask([126.9, 36.9, 127.1, 37.1], [ring])!;
      const [outer, hole] = mask.geometry.coordinates;
      expect(outer).toEqual([[126.9, 36.9], [127.1, 36.9], [127.1, 37.1], [126.9, 37.1], [126.9, 36.9]]);
      expect(area(outer!)).toBeGreaterThan(0);
      expect(area(hole!)).toBeLessThan(0);
      expect(hole).toHaveLength(ring.length);
    }
  });
  it('has no mask without an outline', () => {
    expect(outsideMask([0, 0, 1, 1], null)).toBeNull();
    expect(outsideMask([0, 0, 1, 1], [[[0, 0], [1, 1]]])).toBeNull();
  });
  it('tells a tap inside the building from one outside it (holes count as outside)', () => {
    expect(insideOutline({ lng: 127.0005, lat: 37.0005 }, [ccw])).toBe(true);
    expect(insideOutline({ lng: 127.002, lat: 37.0005 }, [ccw])).toBe(false);
    const courtyard = [[127.0004, 37.0004], [127.0006, 37.0004], [127.0006, 37.0006], [127.0004, 37.0006], [127.0004, 37.0004]];
    expect(insideOutline({ lng: 127.0005, lat: 37.0005 }, [ccw, courtyard])).toBe(false);
    expect(insideOutline({ lng: 127.0002, lat: 37.0002 }, [ccw, courtyard])).toBe(true);
    expect(insideOutline({ lng: 127, lat: 37 }, null)).toBe(false);
  });
});

describe('compass', () => {
  it('turns the needle against the map bearing, normalised to (-180, 180]', () => {
    expect(compassState(0)).toEqual({ rotation: 0, northUp: true });
    expect(compassState(30).rotation).toBe(-30);
    expect(compassState(350).rotation).toBe(10);
    expect(compassState(-90).rotation).toBe(90);
    expect(compassState(540).rotation).toBe(-180);
    expect(normalizeBearing(720)).toBe(0);
    expect(normalizeBearing(Number.NaN)).toBe(0);
  });
  it('counts a tiny rotation as north-up, but not a rotated or tilted map', () => {
    expect(compassState(0.3).northUp).toBe(true);
    expect(compassState(359.8).northUp).toBe(true);
    expect(compassState(12).northUp).toBe(false);
    expect(compassState(0, 30).northUp).toBe(false);
  });
});
