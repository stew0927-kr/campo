// 경로 테스트: what stays sharp of buildings outside the floor shown (model/routeFocus.ts, map/layers.ts toDisplayGeoJSON).
import { describe, expect, it } from 'vitest';
import type { EditNode, PointRouteResult } from '@campo/core';
import { toDisplayGeoJSON } from '../src/map/layers.ts';
import { routeFocusOf } from '../src/model/routeFocus.ts';
import { OUTDOOR } from '../src/model/scope.ts';
import { fixtureSession } from './fixture.ts';

const state = fixtureSession().history.current();
const nodes = Object.values(state.nodes);
const edges = Object.values(state.edges);
const inB = (id: string) => state.nodes[id]?.props.building_id;
const isClassroom = (n: EditNode) => n.props.node_type === 'door' && (n.props.space_name !== undefined || n.props.ref !== undefined);

// Target: A. Passed through: B. The ids are taken from the fixture rather than named.
const entranceA = nodes.find((n) => n.props.node_type === 'entrance' && n.props.building_id === 'bldg_A')!;
const doorA = nodes.find((n) => isClassroom(n) && n.props.building_id === 'bldg_A');
const liftA = edges.find((e) => e.props.highway === 'elevator' && inB(e.props.from) === 'bldg_A')!;
const hallB = edges.find((e) => e.props.highway === 'corridor' && inB(e.props.from) === 'bldg_B')!;
const iconB = nodes.find((n) => n.props.building_id === 'bldg_B' && ['entrance', 'elevator_stop', 'stair_landing'].includes(n.props.node_type))!;
const plainB = nodes.find((n) => n.props.building_id === 'bldg_B' && n.props.node_type === 'corridor')!;

const route = (nodeIds: string[], edgeIds: string[]) => ({ found: true, nodes: nodeIds, edgeIds } as unknown as PointRouteResult);
const found = route(
  [entranceA.id, ...(doorA ? [doorA.id] : []), liftA.props.from, liftA.props.to, hallB.props.from, hallB.props.to, iconB.id, plainB.id],
  [liftA.id, hallB.id],
);
const focus = routeFocusOf(state, OUTDOOR, true, [found], ['bldg_A', null])!;
const feature = (fc: ReturnType<typeof toDisplayGeoJSON>, id: string) => fc.features.find((f) => f.id === id);
const emphasis = (fc: ReturnType<typeof toDisplayGeoJSON>, id: string) => feature(fc, id)?.properties?.['emphasis'];

describe('routeFocusOf', () => {
  it('is null off the 경로 테스트 tab, or when no route was found', () => {
    expect(routeFocusOf(state, OUTDOOR, false, [found], ['bldg_A'])).toBeNull();
    expect(routeFocusOf(state, OUTDOOR, true, [{ found: false } as PointRouteResult], ['bldg_A'])).toBeNull();
    expect(routeFocusOf(state, OUTDOOR, true, [], ['bldg_A'])).toBeNull();
  });
  it('splits target buildings from the ones only passed through, and the building shown is neither', () => {
    expect([...focus.targetBuildings]).toEqual(['bldg_A']);
    expect(focus.passBuildings.has('bldg_B')).toBe(true);
    expect(focus.passBuildings.has('bldg_A')).toBe(false);
    const shown = routeFocusOf(state, { kind: 'building', buildingId: 'bldg_B', level: 2 }, true, [found], ['bldg_A'])!;
    expect(shown.passBuildings.has('bldg_B')).toBe(false);
  });
});

describe('toDisplayGeoJSON with a route focus', () => {
  const base = toDisplayGeoJSON(state, OUTDOOR);
  const fc = toDisplayGeoJSON(state, OUTDOOR, new Set(), new Set(), focus);

  it('without a focus nothing changes: the building stays faded', () => {
    expect(emphasis(base, liftA.id)).toBe(0);
    expect(toDisplayGeoJSON(state, OUTDOOR, new Set(), new Set(), null)).toEqual(base);
  });
  it('a target building keeps its elevator line, entrance and classroom door sharp', () => {
    expect(emphasis(fc, liftA.id)).toBe(1);
    expect(emphasis(fc, entranceA.id)).toBe(1);
    if (doorA) expect(emphasis(fc, doorA.id)).toBe(1);
  });
  it('a building passed through shows its corridor and plain point, and hides its icons', () => {
    expect(emphasis(fc, hallB.id)).toBe(1);
    expect(emphasis(fc, plainB.id)).toBe(1);
    expect(feature(fc, iconB.id)).toBeUndefined();
    expect(feature(base, iconB.id)).toBeDefined();
  });
  it('does not sharpen what is off the route', () => {
    const off = nodes.find((n) => n.props.building_id === 'bldg_A' && n.props.node_type === 'entrance' && n.id !== entranceA.id);
    if (off) expect(emphasis(fc, off.id)).toBe(0);
  });
});
