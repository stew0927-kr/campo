// 마그넷 (model/snap.ts resolveSnap): node first, else the nearer of an edge and a plaza edge, Alt never, all in screen pixels.
import { describe, expect, it } from 'vitest';
import { createHistory, emptyState, addNode, addEdge, type EditState, type Position } from '@campo/core';
import { EDGE_SNAP_PX, PLAZA_SNAP_PX, SNAP_PX, resolveSnap, segmentsOf, type ScreenPoint } from '../src/model/snap.ts';
import { pathCanLandOn } from '../src/model/tools.ts';
import { OUTDOOR } from '../src/model/scope.ts';

/** A flat "screen" of 1 px per 1e-5 degree, at a zoom factor `k` (k = 2: everything twice as large on screen). */
const screenAt = (k: number) => (p: Position): ScreenPoint => ({ x: (p[0] - 127) * 1e5 * k, y: (37 - p[1]) * 1e5 * k });
const toScreen = screenAt(1);
const at = (x: number, y: number): Position => [127 + x * 1e-5, 37 - y * 1e-5];

const road = { id: 'e1', segments: segmentsOf([at(0, 0), at(100, 0)], toScreen) };
const plazaRing = { id: 'pz', segments: segmentsOf([at(0, 50), at(100, 50), at(100, 90), at(0, 90), at(0, 50)], toScreen) };
const nodes = [{ id: 'n1', position: at(0, 0), screen: toScreen(at(0, 0)) }];

describe('resolveSnap', () => {
  it('thresholds are 5 px (node), 8 px (edge), 10 px (plaza edge)', () => {
    expect([SNAP_PX, EDGE_SNAP_PX, PLAZA_SNAP_PX]).toEqual([5, 8, 10]);
  });

  it('a node within SNAP_PX wins over the edge it ends, even though the foot on the edge is nearer', () => {
    const hit = resolveSnap({ x: 3, y: 2 }, { nodes, edges: [road] });
    expect(hit).toMatchObject({ kind: 'node', id: 'n1' });
  });

  it('else the foot on the edge, exactly on the map segment', () => {
    const hit = resolveSnap({ x: 40, y: 6 }, { nodes, edges: [road] })!;
    expect(hit).toMatchObject({ kind: 'edge', id: 'e1' });
    expect(hit.position[1]).toBe(37);
    expect(hit.position[0]).toBeCloseTo(127 + 40e-5, 12);
    expect(resolveSnap({ x: 40, y: 9 }, { edges: [road] })).toBeNull(); // past 8 px
  });

  it('plaza edges (outer ring and holes) snap within 10 px; the nearer of edge and plaza edge wins', () => {
    expect(resolveSnap({ x: 50, y: 41 }, { plazas: [plazaRing] })).toMatchObject({ kind: 'plaza', id: 'pz' });
    expect(resolveSnap({ x: 50, y: 39 }, { plazas: [plazaRing] })).toBeNull();
    const both = { edges: [road], plazas: [{ id: 'pz', segments: segmentsOf([at(0, 9), at(100, 9)], toScreen) }] };
    expect(resolveSnap({ x: 50, y: 3 }, both)).toMatchObject({ kind: 'edge' });
    expect(resolveSnap({ x: 50, y: 6 }, both)).toMatchObject({ kind: 'plaza' });
  });

  it('Alt: nothing snaps', () => {
    expect(resolveSnap({ x: 3, y: 2 }, { nodes, edges: [road], plazas: [plazaRing] }, { alt: true })).toBeNull();
  });

  it('the same pixel distance at any zoom: map positions differ, pixels do not', () => {
    const zoomed = screenAt(4);
    const c = { plazas: [{ id: 'pz', segments: segmentsOf([at(0, 50), at(100, 50)], zoomed) }] };
    const hit = resolveSnap({ x: 200, y: 200 + 9 }, c)!; // 9 px off at 4×
    expect(hit).toMatchObject({ kind: 'plaza' });
    expect(resolveSnap({ x: 200, y: 200 + 11 }, c)).toBeNull();
  });
});

describe('pathCanLandOn (edges a path point may split)', () => {
  function state(): EditState {
    const h = createHistory(emptyState());
    const props = { kind: 'node' as const, node_type: 'outdoor' as const, building_id: null, level: null, source: 't' };
    h.perform(addNode({ id: 'a', coord: at(0, 0), props }));
    h.perform(addNode({ id: 'b', coord: at(10, 0), props }));
    const edge = (id: string, extra: Record<string, unknown>) =>
      h.perform(addEdge({ id, props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'a', to: 'b', bidirectional: true, step_free: null, source: 't', ...extra } as never }));
    edge('plain', {});
    edge('steps1', { highway: 'steps', step_count: 1, step_free: false });
    edge('steps9', { highway: 'steps', step_count: 9, step_free: false });
    return h.current();
  }
  it('an outdoor footway and long steps yes; one step no; another scope no', () => {
    const s = state();
    expect(pathCanLandOn(s, s.edges['plain']!, OUTDOOR)).toBe(true);
    expect(pathCanLandOn(s, s.edges['steps9']!, OUTDOOR)).toBe(true);
    expect(pathCanLandOn(s, s.edges['steps1']!, OUTDOOR)).toBe(false);
    expect(pathCanLandOn(s, s.edges['plain']!, { kind: 'building', buildingId: 'x', level: 1 })).toBe(false);
  });
});
