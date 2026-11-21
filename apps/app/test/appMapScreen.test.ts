import { describe, expect, it } from 'vitest';
import { fixtureRuntime } from './helpers.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { floorLines } from '../src/features/map/indoor.ts';
import { placesInScope, pointPlace, requestFor, TRAVEL_MODES } from '../src/features/map/model.ts';

describe('A map screen data connection', () => {
  it('offers every existing travel mode', () => {
    expect(TRAVEL_MODES.map((m) => m.value).sort()).toEqual(['elevator_first', 'fewest_steps', 'shortest', 'step_free', 'wheelchair']);
  });
  it('uses point endpoints for map taps and refuses distant locations through the existing engine', async () => {
    const runtime = await fixtureRuntime();
    const point = pointPlace({ lat: 20, lng: 120 }, '지도 선택');
    const request = requestFor(point, runtime.places[0]!, 'shortest');
    expect(request?.from?.kind).toBe('point');
    expect(computeRoute(runtime, request).status).toBe('not-found');
  });
  it('connects the entrance to an indoor classroom and avoids stairs in wheelchair mode', async () => {
    const runtime = await fixtureRuntime();
    const from = runtime.places.find((p) => p.id === 'n_out_0001')!;
    const to = runtime.places.find((p) => p.id === 'n_A_4_408door')!;
    expect(from).toBeDefined(); expect(to).toBeDefined();
    const result = computeRoute(runtime, requestFor(from, to, 'wheelchair'));
    expect(result.status).toBe('ok');
    expect(result.route!.stairsCount).toBe(0);
    expect(result.route!.steps.some((step) => step.kind === 'stairs')).toBe(false);
    const lift = computeRoute(runtime, { from: { kind: 'node', nodeId: 'n_A_1_main' }, to: { kind: 'node', nodeId: 'n_A_4_408door' }, mode: 'elevator_first' });
    expect(lift.status).toBe('ok');
    expect(lift.route!.steps.some((step) => step.kind === 'elevator')).toBe(true);
    expect(lift.route!.floorChanges.length).toBeGreaterThan(0);
  });
  it('draws only the chosen building and floor, not another floor at the same coordinates', async () => {
    const runtime = await fixtureRuntime();
    const floor = placesInScope(runtime.places, 'bldg_A', 4);
    expect(floor.length).toBeGreaterThan(0);
    expect(floor.every((p) => p.level === 4 && p.buildingId === 'bldg_A')).toBe(true);
    const result = computeRoute(runtime, { from: { kind: 'node', nodeId: 'n_out_0001' }, to: { kind: 'node', nodeId: 'n_A_4_408door' }, mode: 'wheelchair' });
    const lines = floorLines(runtime.graph, 'bldg_A', 4, result.route);
    expect(lines.features.some((f) => f.properties?.['route'] === true)).toBe(true);
    expect(floorLines(null, 'bldg_A', 4, null).features).toEqual([]);
  });
});
