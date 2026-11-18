// 경로 테스트 with 평지 ends: the route line (plaza walk + graph route, a shared contact once), the dashed walks, the
// route card's plaza sentence, and a point in a hole (snapped, with a notice).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildGraph, findRouteBetween, localFrame, type PointRoute, type Position } from '@campo/core';
import { HOLE_NOTICE, plazaLegText, plazaLines, plazaWalks, pointEnd, routeStops } from '../src/model/plazaRoute.ts';
import { createSession, stateToCampus } from '../src/model/session.ts';
import { readFolder } from './fixture.ts';

const PLAZA = fileURLToPath(new URL('../../core/test/fixtures/campus-plaza', import.meta.url));
const F = localFrame([127, 37]);
const P = (x: number, y: number): Position => F.toPos(x, y);
const OUT = { kind: 'outdoor' } as const;

function setup() {
  const session = createSession('fixture-plaza', readFolder(PLAZA), 1);
  const state = session.history.current();
  const g = buildGraph(stateToCampus(state, session.meta, session.passthrough, session.extras), { overrides: [], calibration: {} });
  return { state, g };
}

describe('route ends on a plaza', () => {
  it('a point on the solid area is a plaza end; in a hole it snaps, with the hole flagged', () => {
    const { state, g } = setup();
    expect(pointEnd(g, state, { at: P(5, 5), scope: OUT })).toMatchObject({ end: { plaza: { plazaId: 'plaza_ring' } }, snap: null, inHole: false });
    const hole = pointEnd(g, state, { at: P(20, 12), scope: OUT })!;
    expect(hole.inHole).toBe(true);
    expect('snap' in hole.end).toBe(true);
    expect(HOLE_NOTICE).toBe('구멍 안입니다. 평지 바깥으로 보고 가장 가까운 길에 이었습니다.');
  });

  it('the line runs walk → nodes → walk with a shared contact drawn once, and the walks are dashed too', () => {
    const { state, g } = setup();
    const from = pointEnd(g, state, { at: P(5, 5), scope: OUT })!.end;
    const r = findRouteBetween(g, from, { nodeId: 'n_out_b' }, 'shortest') as PointRoute;
    expect(r.found).toBe(true);
    const nodeAt = (id: string) => state.nodes[id]?.coord;
    const { coordinates, refs } = routeStops(r, nodeAt, { scope: OUT }, { scope: OUT });
    expect(coordinates[0]).toEqual(P(5, 5));
    expect(coordinates.at(-1)).toEqual(state.nodes['n_out_b']!.coord);
    for (let i = 1; i < coordinates.length; i++) expect(coordinates[i]).not.toEqual(coordinates[i - 1]);
    expect(refs).toHaveLength(coordinates.length);
    expect(refs[0]).toEqual({ scope: OUT });
    const walks = plazaWalks(r);
    expect(walks).toHaveLength(1);
    expect(walks[0]!.path[0]).toEqual(P(5, 5));
    // A node contact: the walk ends on the first node of the route, which is then not repeated.
    if (r.startPlaza!.contact.kind === 'node') {
      expect(r.nodes[0]).toBe(r.startPlaza!.contact.nodeId);
      expect(coordinates.filter((c) => c[0] === nodeAt(r.nodes[0]!)![0] && c[1] === nodeAt(r.nodes[0]!)![1])).toHaveLength(1);
    }
  });

  it('two points of one plaza: the straight walk (no nodes) is drawn and named once', () => {
    const { state, g } = setup();
    const a = pointEnd(g, state, { at: P(5, 5), scope: OUT })!.end;
    const b = pointEnd(g, state, { at: P(35, 5), scope: OUT })!.end;
    const r = findRouteBetween(g, a, b, 'shortest') as PointRoute;
    expect(r.nodes).toEqual([]);
    expect(r.steps).toEqual([]);
    const { coordinates } = routeStops(r, (id) => state.nodes[id]?.coord, { scope: OUT }, { scope: OUT });
    expect(coordinates).toEqual([P(5, 5), P(35, 5)]);
    expect(plazaLines(r, (id) => (id === 'plaza_ring' ? '분수 광장' : id))).toEqual(["평지 '분수 광장' 안에서 바로 갑니다: 30 m (직선)"]);
  });

  it('the card sentence for a walk to a contact', () => {
    expect(plazaLegText({ plazaId: 'p', path: [P(0, 0), P(12.4, 0)], lengthM: 12.4, contact: { kind: 'node', nodeId: 'n' } }, '잔디 광장'))
      .toBe("평지 '잔디 광장'을 가로질러 접점까지 12 m (직선)");
    expect(plazaLegText({ plazaId: 'p', plazaIds: ['p', 'q'], path: [P(0, 0), P(20, 0)], lengthM: 20, contact: { kind: 'node', nodeId: 'n' } }, ['잔디 광장', '분수 광장']))
      .toBe("평지 '잔디 광장'·'분수 광장'을 가로질러 접점까지 20 m (직선)");
    expect(plazaLines({ startPlaza: { plazaId: 'p', plazaIds: ['p', 'q'], path: [P(0, 0), P(20, 0)], lengthM: 20, contact: { kind: 'node', nodeId: 'n' } } }, (id) => id.toUpperCase()))
      .toEqual(["평지 'P'·'Q'을 가로질러 접점까지 20 m (직선)"]);
    // A snapped end keeps its foot; nothing of a plaza is added.
    const stops = routeStops({ nodes: ['a'], startFoot: P(1, 1), endFoot: null }, () => P(2, 2), { scope: OUT }, { scope: OUT });
    expect(stops.coordinates).toEqual([P(1, 1), P(2, 2)]);
  });
});

describe('a plaza crossed in the middle of a route (길 A → 평지 → 길 B)', () => {
  /** The fixture plus road B east of 분수 광장 that meets nothing but the plaza (its west end on the east side, x = 40.04). */
  function crossing() {
    const session = createSession('fixture-plaza', readFolder(PLAZA), 1);
    const east = F.toXY([127.000450428, 37])[0]; // the east side of 분수 광장 in metres
    const base = session.history.current();
    const state = {
      ...base,
      nodes: {
        ...base.nodes,
        n_b1: { id: 'n_b1', coord: P(east, 25), props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', rev: 1 } },
        n_b2: { id: 'n_b2', coord: P(east + 20, 25), props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', rev: 1 } },
      },
      edges: {
        ...base.edges,
        e_b: {
          id: 'e_b', vertices: [],
          props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'n_b1', to: 'n_b2', bidirectional: true, step_free: true, source: 'estimate', rev: 1 },
        },
      },
    } as typeof base;
    const g = buildGraph(stateToCampus(state, session.meta, session.passthrough, session.extras), { overrides: [], calibration: {} });
    return { state, g };
  }

  it('the route crosses the plaza, and the line runs start → crossing → end without repeats', () => {
    const { state, g } = crossing();
    const r = findRouteBetween(g, { nodeId: 'n_b2' }, { nodeId: 'n_out_w' }, 'shortest') as PointRoute;
    expect(r.found).toBe(true);
    expect(r.viaPlazas).toHaveLength(1);
    const via = r.viaPlazas![0]!;
    expect(via.plazaId).toBe('plaza_ring');
    const nodeAt = (id: string) => state.nodes[id]?.coord;
    const { coordinates, refs } = routeStops(r, nodeAt, { scope: OUT }, { scope: OUT });
    expect(coordinates[0]).toEqual(nodeAt('n_b2'));
    expect(coordinates.at(-1)).toEqual(nodeAt('n_out_w'));
    for (let i = 1; i < coordinates.length; i++) expect(coordinates[i]).not.toEqual(coordinates[i - 1]);
    expect(refs).toHaveLength(coordinates.length);
    // Every point of the walk across the plaza is on the line, in order.
    const at = via.path.map((p) => coordinates.findIndex((c) => c[0] === p[0] && c[1] === p[1]));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(plazaWalks(r)).toEqual([via]);
    expect(plazaLines(r, (id) => (id === 'plaza_ring' ? '분수 광장' : id))).toEqual([`평지 '분수 광장'을 가로질러 지나갑니다: ${Math.round(via.lengthM)} m (직선)`]);
    expect(r.steps.some((s) => s.text.startsWith("평지 '분수 광장'을 가로질러"))).toBe(true);
  });

  it('a plaza start, a crossing and a plaza end in one route are drawn in walking order', () => {
    const { state, g } = crossing();
    const from = pointEnd(g, state, { at: P(5, 5), scope: OUT })!.end;
    const r = findRouteBetween(g, from, { nodeId: 'n_b2' }, 'shortest') as PointRoute;
    expect(r.found).toBe(true);
    const walks = plazaWalks(r);
    expect(walks[0]).toBe(r.startPlaza);
    const { coordinates } = routeStops(r, (id) => state.nodes[id]?.coord, { scope: OUT }, { scope: OUT });
    expect(coordinates[0]).toEqual(P(5, 5));
    expect(coordinates.at(-1)).toEqual(state.nodes['n_b2']!.coord);
    for (let i = 1; i < coordinates.length; i++) expect(coordinates[i]).not.toEqual(coordinates[i - 1]);
  });
});
