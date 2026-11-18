// Linked plazas (평지 A - 평지 B - 길): plazas that touch or overlap are walked across as one flat area, so a point on a
// plaza that only meets another plaza still reaches the network through it. Follows graph links and plaza geometry only.
import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  endAtPoint,
  findNearestRestroomFrom,
  findRouteBetween,
  findRouteThrough,
  plazaContacts,
  plazaGeodesics,
  type CampusGraph,
  type LoadedCampus,
  type PointRoute,
  type PointRouteResult,
  type Position,
} from '../../src/index.ts';
import { F, P, rect } from '../plaza/helpers.ts';

type Feature = Record<string, unknown>;
const pos = new Map<string, [number, number]>();

function node(id: string, x: number, y: number, extra: Record<string, unknown> = {}): Feature {
  pos.set(id, [x, y]);
  return {
    type: 'Feature', id, geometry: { type: 'Point', coordinates: P(x, y) },
    properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 't', rev: 1, ...extra },
  };
}
function edge(id: string, from: string, to: string): Feature {
  const [a, b] = [pos.get(from)!, pos.get(to)!];
  return {
    type: 'Feature', id, geometry: { type: 'LineString', coordinates: [P(...a), P(...b)] },
    properties: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: true, source: 't', rev: 1 },
  };
}
function plaza(id: string, coordinates: Position[][]): Feature {
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates }, properties: { kind: 'plaza', source: 't', rev: 1 } };
}
function graphOf(...features: Feature[]): CampusGraph {
  const campus: LoadedCampus = { meta: undefined, features: features.map((feature) => ({ file: 'outdoor.geojson', feature })), fileErrors: [] };
  return buildGraph(campus, { overrides: [], calibration: {}, now: new Date('2026-11-17T00:00:00Z') });
}
function found(r: PointRouteResult): PointRoute {
  if (!r.found) throw new Error(`no route: ${r.message}`);
  return r as PointRoute;
}
const onPlaza = (plazaId: string, x: number, y: number) => ({ plaza: { plazaId, point: P(x, y) } });
const pathLength = (path: Position[]) => path.slice(1).reduce((s, p, i) => s + Math.hypot(...((): [number, number] => {
  const [a, b] = [F.toXY(path[i]!), F.toXY(p)];
  return [b[0] - a[0], b[1] - a[1]];
})()), 0);

/** A (0–10) and B (10–20) share the side x = 10; the road starts on B's far side at (20, 5) and runs 20 m east. */
const road = () => [node('r1', 20, 5), node('r2', 40, 5), edge('e_road', 'r1', 'r2')];

describe('plaza A – plaza B – road', () => {
  it('① A shares a side with B, B meets the road: found, A and B walks summed in distanceM', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10)]), ...road());
    expect(plazaContacts(g, 'pa').length).toBeGreaterThan(0); // B's contacts are A's too
    const r = found(findRouteBetween(g, onPlaza('pa', 2, 5), { nodeId: 'r2' }, 'shortest'));
    expect(r.distanceM).toBeCloseTo(18 + 20, 1);
    expect(r.startPlaza?.lengthM).toBeCloseTo(18, 6);
    expect(r.startPlaza?.plazaIds).toEqual(['pa', 'pb']);
    expect(pathLength(r.startPlaza!.path)).toBeCloseTo(18, 6);
    expect(r.edgeIds).toEqual(['e_road']);
  });

  it('a shared corner only is enough: the walk passes through it', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 10, 20, 20)]), node('r1', 20, 15), node('r2', 30, 15), edge('e', 'r1', 'r2'));
    const r = found(findRouteBetween(g, onPlaza('pa', 5, 5), { nodeId: 'r2' }, 'shortest'));
    const expected = Math.hypot(5, 5) + Math.hypot(10, 5);
    expect(r.startPlaza?.lengthM).toBeCloseTo(expected, 6);
    expect(r.distanceM).toBeCloseTo(expected + 10, 1);
  });

  it('② two plazas joined by an overlap', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 12, 10)]), plaza('pb', [rect(8, 0, 20, 10)]), ...road());
    const r = found(findRouteBetween(g, onPlaza('pa', 2, 5), { nodeId: 'r2' }, 'shortest'));
    expect(r.distanceM).toBeCloseTo(38, 1);
    expect(r.startPlaza?.plazaIds).toEqual(['pa', 'pb']);
  });

  it('③ through a plaza with a hole: the walk goes around the hole', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10), rect(13, 3, 17, 7, false)]), ...road());
    const r = found(findRouteBetween(g, onPlaza('pa', 2, 5), { nodeId: 'r2' }, 'shortest'));
    const around = Math.hypot(11, 2) + 4 + Math.hypot(3, 2);
    expect(r.startPlaza?.lengthM).toBeCloseTo(around, 6);
    expect(r.distanceM).toBeCloseTo(around + 20, 1);
  });

  it('④ the other way: from the road to a point on A', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10)]), ...road());
    const r = found(findRouteBetween(g, { nodeId: 'r2' }, onPlaza('pa', 2, 5), 'shortest'));
    expect(r.distanceM).toBeCloseTo(38, 1);
    expect(r.endPlaza?.lengthM).toBeCloseTo(18, 6);
    const end = r.endPlaza!.path[r.endPlaza!.path.length - 1]!;
    expect(F.toXY(end)[0]).toBeCloseTo(2, 6);
    expect(r.endPlaza?.plazaIds).toEqual(['pb', 'pa']); // walking order: towards the picked point
    expect(r.endPlaza?.plazaId).toBe('pa');
  });

  it('⑤ a plaza linked to nothing is still no-route', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10)]), plaza('lone', [rect(60, 0, 70, 10)]), ...road());
    const r = findRouteBetween(g, onPlaza('lone', 65, 5), { nodeId: 'r2' }, 'shortest');
    expect(r.found).toBe(false);
    if (!r.found) expect(r.reason).toBe('no-route');
    expect(plazaGeodesics(g, { plazaId: 'lone', point: P(65, 5) })).toEqual([]);
    // A gap of 0.5 m is not a link either.
    const gap = graphOf(plaza('pa', [rect(0, 0, 9.5, 10)]), plaza('pb', [rect(10, 0, 20, 10)]), ...road());
    expect(findRouteBetween(gap, onPlaza('pa', 2, 5), { nodeId: 'r2' }, 'shortest').found).toBe(false);
  });

  it('⑥ a chain of three plazas', () => {
    const g = graphOf(
      plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10)]), plaza('pc', [rect(20, 0, 30, 10)]),
      node('r1', 30, 5), node('r2', 45, 5), edge('e', 'r1', 'r2'),
    );
    const r = found(findRouteBetween(g, onPlaza('pa', 2, 5), { nodeId: 'r2' }, 'shortest'));
    expect(r.startPlaza?.lengthM).toBeCloseTo(28, 6);
    expect(r.distanceM).toBeCloseTo(43, 1);
    expect(r.startPlaza?.plazaIds).toEqual(['pa', 'pb', 'pc']);
    // Only the plazas the walk crossed are listed: from B, A is not walked.
    const fromB = found(findRouteBetween(g, onPlaza('pb', 12, 5), { nodeId: 'r2' }, 'shortest'));
    expect(fromB.startPlaza?.plazaIds).toEqual(['pb', 'pc']);
  });

  it('both ends on linked plazas, no road at all: the straight walk across both', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10)]));
    const r = found(findRouteBetween(g, onPlaza('pa', 2, 5), onPlaza('pb', 18, 5), 'shortest'));
    expect(r.distanceM).toBeCloseTo(16, 1);
    expect(r.startPlaza?.contact).toEqual({ kind: 'direct' });
  });

  it('endAtPoint on the overlap, findRouteThrough and the nearest restroom use the link too', () => {
    const feats = [plaza('pa', [rect(0, 0, 12, 10)]), plaza('pb', [rect(8, 0, 20, 10)]), ...road()];
    const g = graphOf(...feats);
    const end = endAtPoint(g, P(10, 5));
    expect(end && 'plaza' in end).toBe(true);
    const through = found(findRouteThrough(g, [onPlaza('pa', 2, 5), { nodeId: 'r1' }, { nodeId: 'r2' }], 'shortest'));
    expect(through.distanceM).toBeCloseTo(38, 1);
    const withRestroom = graphOf(...feats, node('wc', 40, 8, { node_type: 'restroom', restroom_gender: 'unisex', wheelchair: 'yes' }), edge('e_wc', 'r2', 'wc'));
    const near = found(findNearestRestroomFrom(withRestroom, onPlaza('pa', 2, 5), 'any'));
    expect(near.startPlaza?.plazaIds).toEqual(['pa', 'pb']);
    expect(near.distanceM).toBeCloseTo(38 + 3, 1);
  });

  it('a new graph after an edit gets fresh contacts (the cache is per graph)', () => {
    const before = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10)]));
    expect(plazaContacts(before, 'pa')).toEqual([]);
    const after = graphOf(plaza('pa', [rect(0, 0, 10, 10)]), plaza('pb', [rect(10, 0, 20, 10)]), ...road());
    expect(plazaContacts(after, 'pa').length).toBe(1);
    expect(plazaContacts(before, 'pa')).toEqual([]);
  });
});
