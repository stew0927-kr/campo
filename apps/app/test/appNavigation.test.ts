import { describe, expect, it } from 'vitest';
import { appReducer, INITIAL_STATE, planIntent, placeDestination, resolveDestination, type Destination } from '../src/state/model.ts';
import { essayDestination, eventDestination, stallDestination } from '../src/features/content/destinations.ts';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
import { flowDestination } from '../src/features/festival/flow.ts';
import { requestFor } from '../src/features/map/model.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { fixtureRuntime } from './helpers.ts';
const targets = [essayDestination(DEMO_CONTENT.essays[0]!), stallDestination(DEMO_CONTENT.stalls[0]!), eventDestination(DEMO_CONTENT.events[0]!)];
describe('cross-tab destination handoff', () => {
  it.each(targets)('moves $kind to the map and opens a search when no real node exists', (destination) => {
    const state = appReducer({ ...INITIAL_STATE, tab: '논술' }, { type: 'navigate', destination });
    expect(state.tab).toBe('지도·길찾기');
    expect(state.intent?.destination).toEqual(destination);
    const plan = planIntent(null, state.intent!.destination);
    expect(plan.destination.kind).toBe('search');
    if (plan.destination.kind === 'search') expect(plan.destination.query).toBe(destination.searchTerm);
    expect(state.intent!.destination.nodeId).toBeNull();
  });
  it.each(targets)('selects an existing $kind destination and calculates a real fixture route', async (target) => {
    const runtime = await fixtureRuntime();
    const state = appReducer(INITIAL_STATE, { type: 'navigate', destination: { ...target, nodeId: 'n_A_4_408door' } });
    const plan = planIntent(runtime, state.intent!.destination);
    expect(plan.destination.kind).toBe('selected');
    if (plan.destination.kind !== 'selected') throw Error('destination not selected');
    expect(plan.destination.place.id).toBe('n_A_4_408door');
    const route = computeRoute(runtime, requestFor(runtime.places.find((p) => p.id === 'n_out_0001')!, plan.destination.place, 'wheelchair'));
    expect(route.status).toBe('ok');
    expect(route.route!.nodeIds.at(-1)).toBe('n_A_4_408door');
  });
  it('does not guess a node for stale ids or ambiguous names', async () => {
    const runtime = await fixtureRuntime();
    const known = runtime.places[0]!;
    const target: Destination = { ...placeDestination(known), nodeId: 'stale', searchTerm: known.name };
    expect(resolveDestination(runtime, target).kind).toBe('search');
    const duplicated = { ...runtime, places: [known, { ...known, id: 'other' }] };
    expect(resolveDestination(duplicated, { ...target, nodeId: null }).kind).toBe('search');
    expect(resolveDestination(runtime, { ...target, nodeId: null }).kind).toBe('selected');
  });
  it('shares favorites across tabs, routes from favorites and removes them without duplicates', async () => {
    const runtime = await fixtureRuntime();
    const target = placeDestination(runtime.places[0]!);
    let state = appReducer(INITIAL_STATE, { type: 'favorite', destination: target });
    state = appReducer(state, { type: 'tab', tab: '내정보' });
    state = appReducer(state, { type: 'navigate', destination: state.favorites[0]! });
    expect(state.tab).toBe('지도·길찾기');
    expect(planIntent(runtime, state.intent!.destination).destination.kind).toBe('selected');
    state = appReducer(state, { type: 'favorite', destination: target });
    expect(state.favorites).toEqual([]);
  });
  it('processes repeated destinations and never consumes a newer intent with an old acknowledgement', () => {
    let state = appReducer(INITIAL_STATE, { type: 'navigate', destination: targets[0]! });
    const first = state.intent!.sequence;
    state = appReducer(state, { type: 'navigate', destination: targets[0]! });
    state = appReducer(state, { type: 'consumed', sequence: first });
    expect(state.intent).not.toBeNull();
    state = appReducer(state, { type: 'consumed', sequence: state.intent!.sequence });
    expect(state.intent).toBeNull();
  });
  it('passes the profile chosen in Me to the next map request', async () => {
    const runtime = await fixtureRuntime();
    const state = appReducer(INITIAL_STATE, { type: 'mode', mode: 'wheelchair' });
    const request = requestFor(runtime.places[0]!, runtime.places[1]!, state.defaultMode);
    expect(request?.mode).toBe('wheelchair');
  });
  it('requires both actual entrance and exit ids before displaying a flow', async () => {
    const runtime = await fixtureRuntime();
    const stall = DEMO_CONTENT.stalls[0]!;
    expect(planIntent(runtime, flowDestination(stall, 'enter')).missingFlow).toBe(true);
    const real = { ...stall, nodeId: 'n_A_4_408door', entranceNodeId: 'n_out_0001', exitNodeId: 'n_out_0001' };
    const enter = planIntent(runtime, flowDestination(real, 'enter'));
    expect(enter.missingFlow).toBe(false); expect(enter.start?.id).toBe('n_out_0001');
    const exit = planIntent(runtime, flowDestination(real, 'exit'));
    expect(exit.start?.id).toBe('n_A_4_408door');
    expect(exit.destination.kind).toBe('selected');
  });
});
