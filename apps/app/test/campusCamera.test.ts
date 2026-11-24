import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMPUS_MAX_BOUNDS, CAMPUS_MAX_ZOOM, CAMPUS_MIN_ZOOM } from '../src/map/campusCamera.ts';

const campus = JSON.parse(readFileSync(new URL('../../../data/campuses/hanyang-seoul/campus.json', import.meta.url), 'utf8')) as {
  center: { lng: number; lat: number } | [number, number];
  bbox?: [number, number, number, number];
  map_limits: { bounds: [number, number, number, number] };
};

const [west, south, east, north] = CAMPUS_MAX_BOUNDS;
const inside = (lat: number, lng: number) => lng >= west && lng <= east && lat >= south && lat <= north;

describe('campus camera limits', () => {
  it('matches campus.json map_limits.bounds', () => {
    expect(CAMPUS_MAX_BOUNDS).toEqual(campus.map_limits.bounds);
  });

  it('contains the campus center and bbox', () => {
    const c = campus.center;
    const [lng, lat] = Array.isArray(c) ? c : [c.lng, c.lat];
    expect(inside(lat, lng)).toBe(true);
    if (campus.bbox) {
      const [w, s, e, n] = campus.bbox;
      expect(inside(s, w) && inside(n, e)).toBe(true);
    }
  });

  it('contains nearby stations and the park', () => {
    expect(inside(37.5613, 127.0371)).toBe(true); // 왕십리역
    expect(inside(37.5556, 127.0437)).toBe(true); // 한양대역
    expect(inside(37.5541, 127.0495)).toBe(true); // 살곶이공원
  });

  it('excludes far places', () => {
    expect(inside(37.5665, 126.978)).toBe(false); // 서울시청
    expect(inside(37.4979, 127.0276)).toBe(false); // 강남역
  });

  it('keeps the whole of Seoul out of view', () => {
    expect(CAMPUS_MIN_ZOOM).toBeGreaterThanOrEqual(14);
    expect(CAMPUS_MIN_ZOOM).toBeLessThanOrEqual(15);
    expect(CAMPUS_MAX_ZOOM).toBeGreaterThan(CAMPUS_MIN_ZOOM);
  });
});
