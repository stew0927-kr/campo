import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMPUS_MAX_BOUNDS, CAMPUS_MAX_ZOOM, CAMPUS_MIN_ZOOM } from '../src/map/campusCamera.ts';

const campus = JSON.parse(readFileSync(new URL('../../../data/campuses/hanyang-seoul/campus.json', import.meta.url), 'utf8')) as {
  center: { lng: number; lat: number } | [number, number];
  bbox?: [number, number, number, number];
  map_limits: { bounds: [number, number, number, number]; min_zoom: number };
};

const [west, south, east, north] = CAMPUS_MAX_BOUNDS;
const inside = (lat: number, lng: number) => lng >= west && lng <= east && lat >= south && lat <= north;

describe('campus camera limits', () => {
  it('stays inside campus.json map_limits.bounds (tighter than the editor)', () => {
    const [w, s, e, n] = campus.map_limits.bounds;
    expect(west).toBeGreaterThan(w);
    expect(south).toBeGreaterThan(s);
    expect(east).toBeLessThan(e);
    expect(north).toBeLessThan(n);
  });

  it('is tight: at most about 200 m beyond the campus bbox on every side', () => {
    const [w, s, e, n] = campus.bbox!;
    const mLat = 111_320, mLng = 111_320 * Math.cos((37.557 * Math.PI) / 180);
    expect((w - west) * mLng).toBeLessThan(200);
    expect((east - e) * mLng).toBeLessThan(200);
    expect((s - south) * mLat).toBeLessThan(200);
    expect((north - n) * mLat).toBeLessThan(200);
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

  it('contains the adjacent station entrance and roads', () => {
    expect(inside(37.5556, 127.0437)).toBe(true); // 한양대역
    expect(inside(37.5541, 127.0495)).toBe(true); // 살곶이공원 쪽 캠퍼스 남동 끝
  });

  it('excludes far places', () => {
    expect(inside(37.5613, 127.0371)).toBe(false); // 왕십리역(편집기 범위에는 있지만 앱 카메라 중심은 가지 않는다)
    expect(inside(37.5665, 126.978)).toBe(false); // 서울시청
    expect(inside(37.4979, 127.0276)).toBe(false); // 강남역
  });

  it('keeps the whole of Seoul out of view', () => {
    expect(CAMPUS_MIN_ZOOM).toBeGreaterThanOrEqual(14);
    expect(CAMPUS_MIN_ZOOM).toBeLessThanOrEqual(campus.map_limits.min_zoom);
    expect(CAMPUS_MAX_ZOOM).toBeGreaterThan(CAMPUS_MIN_ZOOM);
  });
});
