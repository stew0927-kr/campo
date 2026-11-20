import { describe, expect, it } from 'vitest';
import { loadBundledCampus } from '../../campus/loadBundledCampus.ts';
import { computeRoute } from '../../route/routeEngine.ts';
import { DEMO_CAMPUS } from './demoCampus.ts';
import { requestFor, routeBounds, routeLine, searchPlaces } from './model.ts';

const runtime = loadBundledCampus(DEMO_CAMPUS);
describe('map screen connection to the existing route engine', () => {
  it('searches by building and classroom number without losing distinct places', () => {
    const places = [
      { id: 'a', name: '강의실', nodeType: 'door', buildingId: 'eng', level: 3, roomRef: '301', lat: 37, lng: 127 },
      { id: 'b', name: '강의실', nodeType: 'door', buildingId: 'lib', level: 3, roomRef: '301', lat: 37, lng: 127 },
    ];
    const buildings = [{ id: 'eng', name: '공학관', levels: [3] }, { id: 'lib', name: '도서관', levels: [3] }];
    expect(searchPlaces(places, buildings, ' 공학관 301 ').map((p) => p.id)).toEqual(['a']);
    expect(searchPlaces(places, buildings, '301')).toHaveLength(2);
    expect(searchPlaces(places, buildings, '없는 장소')).toEqual([]);
  });
  it('calculates a manual route and converts it to GeoJSON in longitude-latitude order', () => {
    const [from, , to] = runtime.places;
    expect(from).toBeDefined(); expect(to).toBeDefined();
    const request = requestFor(from!, to!, 'shortest');
    const result = computeRoute(runtime, request);
    expect(result.status).toBe('ok');
    expect(result.route!.distanceM).toBeGreaterThan(100);
    expect(result.route!.timeSec).toBeGreaterThan(0);
    expect(result.route!.steps.length).toBeGreaterThan(0);
    const line = routeLine(result.route!.polyline)!;
    expect(line.geometry.coordinates[0]).toEqual([from!.lng, from!.lat]);
    expect(line.geometry.coordinates.at(-1)).toEqual([to!.lng, to!.lat]);
    const bounds = routeBounds(result.route!.polyline)!;
    expect(bounds[0]).toBeLessThan(from!.lng); expect(bounds[2]).toBeGreaterThan(to!.lng);
  });
  it('does not request routes with missing endpoints, and respects the selected mode', () => {
    expect(requestFor(null, runtime.places[0]!, 'shortest')).toBeNull();
    const request = requestFor(runtime.places[0]!, runtime.places[2]!, 'wheelchair');
    expect(request?.mode).toBe('wheelchair');
    expect(computeRoute(runtime, request).status).toBe('ok');
  });
  it('keeps an empty campus and an invalid endpoint distinct from successful routes', () => {
    expect(searchPlaces([], [], '')).toEqual([]);
    expect(computeRoute(runtime, { from: { kind: 'node', nodeId: 'missing' }, to: { kind: 'node', nodeId: 'demo_2' } }).status).toBe('not-found');
    expect(routeLine([])).toBeNull(); expect(routeBounds([])).toBeNull();
    expect(routeLine([{ lng: NaN, lat: 37 }, { lng: 127, lat: 37 }])).toBeNull();
  });
  it('keeps a same-place route drawable and marks the demo explicitly', () => {
    const place = runtime.places[0]!;
    const result = computeRoute(runtime, requestFor(place, place, 'shortest'));
    expect(result.status).toBe('ok'); expect(result.route!.distanceM).toBe(0);
    expect(routeLine(result.route!.polyline)?.geometry.coordinates).toHaveLength(2);
    expect(runtime.info.name).toContain('가상');
    expect(runtime.places.every((p) => p.name.includes('가상'))).toBe(true);
  });
});
