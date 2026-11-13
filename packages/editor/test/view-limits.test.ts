import { describe, expect, it } from 'vitest';
import { START_ZOOM, startZoom, viewLimits } from '../src/model/viewLimits.ts';
import { fixtureSession } from './fixture.ts';

const limits = { bounds: [127.028, 37.5437, 127.062, 37.5707] as [number, number, number, number], min_zoom: 15, max_zoom: 22 };

describe('지도 이동 반경 (campus.json map_limits)', () => {
  it('turns the declared area into MapLibre options', () => {
    expect(viewLimits(limits)).toEqual({ maxBounds: [[127.028, 37.5437], [127.062, 37.5707]], minZoom: 15, maxZoom: 22 });
  });

  it('a campus without limits is not limited', () => {
    expect(viewLimits(undefined)).toEqual({ maxBounds: null, minZoom: null, maxZoom: null });
    expect(startZoom(undefined)).toBe(START_ZOOM);
  });

  it('opens inside the zoom range', () => {
    expect(startZoom(limits)).toBe(START_ZOOM);
    expect(startZoom({ ...limits, min_zoom: 18 })).toBe(18);
    expect(startZoom({ ...limits, max_zoom: 16 })).toBe(16);
  });

  it('is read from the campus a session was loaded from, so another campus brings its own', () => {
    const s = fixtureSession();
    expect(viewLimits(s.meta.map_limits).maxBounds).not.toBeNull();
    // the fixture's area contains its centre
    const [[w, so], [e, n]] = viewLimits(s.meta.map_limits).maxBounds!;
    const [lng, lat] = s.meta.center;
    expect(lng > w && lng < e && lat > so && lat < n).toBe(true);
  });
});
