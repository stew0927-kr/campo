// Routes from and to points on a plaza (평지): contacts, the visibility walk around holes, and the route ends.
import { describe, expect, it } from 'vitest';
import {
  PROFILES,
  WALK_SPEED_MPS,
  buildGraph,
  endAtPoint,
  findNearestRestroomFrom,
  findRouteBetween,
  findRouteThrough,
  plazaAt,
  plazaContacts,
  plazaDistance,
  plazaGeodesics,
  snapToRoutes,
  type CampusGraph,
  type LoadedCampus,
  type PointRoute,
  type PointRouteResult,
  type Position,
} from '../../src/index.ts';
import { F, P, rect, ring } from '../plaza/helpers.ts';

type Feature = Record<string, unknown>;
const pos = new Map<string, [number, number]>();

function node(id: string, x: number, y: number, extra: Record<string, unknown> = {}): Feature {
  pos.set(id, [x, y]);
  return {
    type: 'Feature', id, geometry: { type: 'Point', coordinates: P(x, y) },
    properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 't', rev: 1, ...extra },
  };
}
function edge(id: string, from: string, to: string, extra: Record<string, unknown> = {}): Feature {
  const [a, b] = [pos.get(from)!, pos.get(to)!];
  return {
    type: 'Feature', id, geometry: { type: 'LineString', coordinates: [P(...a), P(...b)] },
    properties: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: true, source: 't', rev: 1, ...extra },
  };
}
function plaza(id: string, coordinates: Position[][], name?: string): Feature {
  return { type: 'Feature', id, geometry: { type: 'Polygon', coordinates }, properties: { kind: 'plaza', source: 't', rev: 1, ...(name ? { name } : {}) } };
}
function graphOf(...features: Feature[]): CampusGraph {
  const campus: LoadedCampus = { meta: undefined, features: features.map((feature) => ({ file: 'outdoor.geojson', feature })), fileErrors: [] };
  return buildGraph(campus, { overrides: [], calibration: {}, now: new Date('2026-11-17T00:00:00Z') });
}
function found(r: PointRouteResult): PointRoute {
  if (!r.found) throw new Error(`no route: ${r.message}`);
  return r as PointRoute;
}
const xy = (p: Position) => F.toXY(p);
const near = (p: Position, x: number, y: number, tol = 1e-6) => {
  const [px, py] = xy(p);
  return Math.abs(px - x) < tol && Math.abs(py - y) < tol;
};

const SQUARE = rect(0, 0, 20, 20);
const HOLE = rect(7, 7, 13, 13, false);

describe('plaza geodesics (visibility graph)', () => {
  it('around a 6×6 m hole: 2·√(5²+3²) + 6 = 17.662 m, straight 16 m without it', () => {
    const g = graphOf(plaza('pz', [SQUARE, HOLE]));
    const d = plazaDistance(g, 'pz', P(2, 10), P(18, 10))!;
    expect(d.lengthM).toBeCloseTo(2 * Math.sqrt(34) + 6, 3);
    expect(d.path).toHaveLength(4);
    expect(near(d.path[0]!, 2, 10)).toBe(true);
    expect(near(d.path[3]!, 18, 10)).toBe(true);
    const plain = graphOf(plaza('pz', [SQUARE]));
    const s = plazaDistance(plain, 'pz', P(2, 10), P(18, 10))!;
    expect(s.lengthM).toBeCloseTo(16, 6);
    expect(s.path).toHaveLength(2);
  });

  it('an L-shaped plaza bends at its reflex corner', () => {
    const g = graphOf(plaza('pz', [ring([[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]])]));
    const d = plazaDistance(g, 'pz', P(18, 8), P(8, 18))!;
    expect(d.lengthM).toBeCloseTo(2 * Math.sqrt(68), 6);
    expect(near(d.path[1]!, 10, 10)).toBe(true);
  });

  it('outside points have no walk; a broken plaza is left out with a warning', () => {
    const g = graphOf(plaza('pz', [SQUARE, HOLE]), plaza('bad', [ring([[30, 0], [40, 10], [40, 0], [30, 10]])], '나비'));
    expect(plazaDistance(g, 'pz', P(10, 10), P(2, 2))).toBeNull();
    expect(plazaGeodesics(g, { plazaId: 'pz', point: P(10, 10) })).toEqual([]);
    expect(g.plazas.has('bad')).toBe(false);
    expect(g.warnings).toContain("평지 '나비'의 모양이 올바르지 않아 길찾기에 쓰지 않습니다.");
  });
});

describe('plaza contacts', () => {
  it('an edge across the plaza meets it twice, with along as snapToRoutes measures it', () => {
    const g = graphOf(plaza('pz', [SQUARE]), node('a', -5, 5), node('b', 25, 5), edge('e', 'a', 'b'));
    const c = plazaContacts(g, 'pz');
    expect(c.map((x) => x.kind)).toEqual(['edge', 'edge']);
    const alongs = c.map((x) => (x.kind === 'edge' ? x.along : -1)).sort();
    expect(alongs[0]).toBeCloseTo(5 / 30, 6);
    expect(alongs[1]).toBeCloseTo(25 / 30, 6);
  });

  it('an edge across a hole also meets the hole ring', () => {
    const g = graphOf(plaza('pz', [SQUARE, HOLE]), node('a', -5, 10), node('b', 25, 10), edge('e', 'a', 'b'));
    const xs = plazaContacts(g, 'pz').map((x) => Math.round(xy(x.at)[0] * 1000) / 1000).sort((p, q) => p - q);
    expect(xs).toEqual([0, 7, 13, 20]);
  });

  it('nodes inside, on or just outside the boundary are node contacts; crossings at an end node are absorbed', () => {
    const g = graphOf(
      plaza('pz', [SQUARE]),
      node('in', 5, 5), node('edge', 20.2, 5), node('far', 21, 15), node('x', 30, 5),
      edge('e1', 'edge', 'x'), edge('e2', 'far', 'x'),
    );
    const c = plazaContacts(g, 'pz');
    expect(c).toEqual([
      { kind: 'node', nodeId: 'edge', at: P(20.2, 5) },
      { kind: 'node', nodeId: 'in', at: P(5, 5) },
    ]);
  });

  it('contacts within 5 cm merge into one; indoor edges never make contacts', () => {
    const g = graphOf(
      plaza('pz', [SQUARE]),
      node('a', -5, 5), node('b', -5, 5.02), node('o1', 30, 5), node('o2', 30, 5.02),
      edge('e1', 'a', 'o1'), edge('e2', 'b', 'o2'),
      node('i1', -5, 15, { building_id: 'bldg_X', level: 1, node_type: 'corridor' }),
      node('i2', 30, 15, { building_id: 'bldg_X', level: 1, node_type: 'corridor' }),
      edge('ei', 'i1', 'i2', { highway: 'corridor', edge_type: 'indoor' }),
    );
    const c = plazaContacts(g, 'pz');
    expect(c).toHaveLength(2); // x = 0 and x = 20, each once
    expect(c.every((x) => x.kind === 'edge' && x.edgeId !== 'ei')).toBe(true);
  });
});

/** Q at (5, 10). Left exit L (0, 10) is 5 m away but 140 m from D; right exit R (20, 10) is 15 m away and 20 m from D. */
function twoExits(): CampusGraph {
  return graphOf(
    plaza('pz', [SQUARE], '분수 광장'),
    node('L', 0, 10), node('U', -10, 10), node('V', -10, 50), node('W', 40, 50), node('D', 40, 10), node('R', 20, 10),
    node('toilet', 40, 0, { node_type: 'restroom', restroom_gender: 'unisex', wheelchair: 'yes' }),
    edge('eLU', 'L', 'U'), edge('eUV', 'U', 'V'), edge('eVW', 'V', 'W'), edge('eWD', 'W', 'D'), edge('eRD', 'R', 'D'), edge('eDt', 'D', 'toilet'),
  );
}
const Q = P(5, 10);
const start = { plaza: { plazaId: 'pz', point: Q } } as const;

describe('routes from and to a plaza', () => {
  it('picks the contact with the cheapest total, not the nearest one, and adds the walk exactly', () => {
    const g = twoExits();
    const r = found(findRouteBetween(g, start, { nodeId: 'D' }, 'shortest'));
    expect(r.startPlaza!.contact).toEqual({ kind: 'node', nodeId: 'R' });
    expect(r.nodes).toEqual(['R', 'D']);
    expect(r.distanceM).toBe(35);
    expect(r.timeSec).toBe(Math.round((35 / WALK_SPEED_MPS) * 10) / 10);
    expect(r.startPlaza!.lengthM).toBeCloseTo(15, 6);
    expect(r.startPlaza!.path[0]).toEqual(Q);
    expect(r.startPlaza!.path.at(-1)).toEqual(g.nodes.get('R')!.geometry.coordinates);
    expect(r.startFoot).toBeNull();
    expect('endPlaza' in r).toBe(false);
  });

  it('arriving on a plaza runs the path from the contact to the point', () => {
    const g = twoExits();
    const r = found(findRouteBetween(g, { nodeId: 'D' }, start, 'shortest'));
    expect(r.endPlaza!.path[0]).toEqual(g.nodes.get('R')!.geometry.coordinates);
    expect(r.endPlaza!.path.at(-1)).toEqual(Q);
    expect(r.endFoot).toBeNull();
    expect('startPlaza' in r).toBe(false);
  });

  it('plaza → snapped point', () => {
    const g = twoExits();
    const snap = snapToRoutes(g, P(30, 11))!;
    expect(snap.edgeId).toBe('eRD');
    const r = found(findRouteBetween(g, start, { snap }, 'shortest'));
    expect(r.distanceM).toBeCloseTo(25, 1);
    expect(r.endFoot).toEqual(snap.foot);
  });

  it('an edge contact walks to either end of its edge', () => {
    const g = graphOf(plaza('pz', [SQUARE]), node('a', -5, 5), node('b', 25, 5), node('far', 25, -20), edge('e', 'a', 'b'), edge('f', 'b', 'far'));
    const r = found(findRouteBetween(g, { plaza: { plazaId: 'pz', point: P(18, 5) } }, { nodeId: 'far' }, 'shortest'));
    expect(r.startPlaza!.contact).toMatchObject({ kind: 'edge', edgeId: 'e' });
    expect(r.nodes).toEqual(['b', 'far']);
    expect(r.distanceM).toBeCloseTo(2 + 5 + 25, 1);
  });

  it('same plaza: the straight walk when it is cheaper', () => {
    const g = twoExits();
    const r = found(findRouteBetween(g, start, { plaza: { plazaId: 'pz', point: P(15, 12) } }, 'shortest'));
    expect(r.nodes).toEqual([]);
    expect(r.edgeIds).toEqual([]);
    expect(r.steps).toEqual([]);
    expect(r.distanceM).toBeCloseTo(Math.hypot(10, 2), 1);
    expect(r.startPlaza!.contact).toEqual({ kind: 'direct' });
    expect(r.startPlaza!.path).toEqual([Q, P(15, 12)]);
    expect(r).toMatchObject({ stairsCount: 0, escalatorCount: 0, uncertainSegments: [], slopeSegments: [], fallback: null, startFoot: null, endFoot: null });
  });

  it('same plaza: the network wins when a big hole makes the walk around it long', () => {
    // A pond (hole 1..19) with a footbridge straight across it from L to R.
    const g = graphOf(plaza('pz', [SQUARE, rect(1, 1, 19, 19, false)]), node('L', 0, 10), node('R', 20, 10), edge('bridge', 'L', 'R'));
    const a = P(0.5, 10);
    const b = P(19.5, 10);
    expect(plazaDistance(g, 'pz', a, b)!.lengthM).toBeGreaterThan(35);
    const r = found(findRouteBetween(g, { plaza: { plazaId: 'pz', point: a } }, { plaza: { plazaId: 'pz', point: b } }, 'shortest'));
    // Both walks meet the bridge where it crosses the hole ring; the stretch between is the bridge itself.
    expect(r.startPlaza!.contact).toMatchObject({ kind: 'edge', edgeId: 'bridge' });
    expect(r.nodes.length).toBeGreaterThan(0);
    expect(r.distanceM).toBeLessThan(21);
  });

  it('a point in a hole snaps to the nearest edge; outside a plaza it is snapToRoutes itself', () => {
    const g = graphOf(plaza('pz', [SQUARE, HOLE]), node('a', -5, 10), node('b', 25, 10), edge('e', 'a', 'b'));
    const inHole = P(10, 11);
    expect(plazaAt(g, inHole)).toMatchObject({ hit: 'hole', plaza: { id: 'pz' } });
    expect(endAtPoint(g, inHole)).toEqual({ snap: snapToRoutes(g, inHole) });
    expect(endAtPoint(g, P(3, 3))).toEqual({ plaza: { plazaId: 'pz', point: P(3, 3) } });
    expect(endAtPoint(g, P(40, 40))).toEqual({ snap: snapToRoutes(g, P(40, 40)) });
    expect(endAtPoint(graphOf(plaza('pz', [SQUARE])), P(40, 40))).toBeNull();
  });

  it('every profile walks the plaza unblocked, at cost = time', () => {
    const g = twoExits();
    for (const profile of PROFILES) {
      const direct = found(findRouteBetween(g, start, { plaza: { plazaId: 'pz', point: P(15, 12) } }, profile));
      expect(direct.cost, profile).toBe(direct.timeSec);
      const r = found(findRouteBetween(g, start, { nodeId: 'D' }, profile));
      expect(r.cost, profile).toBe(r.timeSec);
      expect(r.startPlaza!.contact, profile).toEqual({ kind: 'node', nodeId: 'R' });
    }
  });

  it('a plaza touching no path gives no route, with a reason', () => {
    const g = graphOf(plaza('pz', [SQUARE]), node('a', 40, 40), node('b', 50, 40), edge('e', 'a', 'b'));
    const r = findRouteBetween(g, { plaza: { plazaId: 'pz', point: P(5, 5) } }, { nodeId: 'a' }, 'shortest');
    expect(r).toMatchObject({ found: false, message: '이 평지는 길과 닿는 곳이 없어 길을 찾을 수 없습니다.' });
  });

  it('nearest restroom from a plaza point', () => {
    const r = findNearestRestroomFrom(twoExits(), start, 'any');
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.targetId).toBe('toilet');
      expect(r.startPlaza!.contact).toEqual({ kind: 'node', nodeId: 'R' });
    }
  });

  it('findRouteThrough adds up its parts', () => {
    const g = twoExits();
    const ends = [start, { nodeId: 'W' }, { plaza: { plazaId: 'pz', point: P(18, 18) } }] as const;
    const a = found(findRouteBetween(g, ends[0], ends[1], 'shortest'));
    const b = found(findRouteBetween(g, ends[1], ends[2], 'shortest'));
    const t = found(findRouteThrough(g, [...ends], 'shortest'));
    expect(t.distanceM).toBeCloseTo(a.distanceM + b.distanceM, 6);
    expect(t.timeSec).toBeCloseTo(a.timeSec + b.timeSec, 6);
    expect(t.edgeIds).toEqual([...a.edgeIds, ...b.edgeIds]);
    expect(t.nodes).toEqual([...a.nodes, ...b.nodes.slice(1)]);
    expect(t.startPlaza).toEqual(a.startPlaza);
    expect(t.endPlaza).toEqual(b.endPlaza);
    const miss = findRouteThrough(g, [start, { nodeId: 'nope' }], 'shortest');
    expect(miss.found).toBe(false);
  });
});

describe('campus-plaza fixture', () => {
  it('contacts: crossings of both rings, the node inside, the boundary node', async () => {
    const { fileURLToPath } = await import('node:url');
    const { loadCampus } = await import('../../src/node/index.ts');
    const g = buildGraph(await loadCampus(fileURLToPath(new URL('../fixtures/campus-plaza', import.meta.url))), { overrides: [], calibration: {} });
    expect([...g.plazas.keys()].sort()).toEqual(['plaza_lawn', 'plaza_ring']);
    const ringContacts = plazaContacts(g, 'plaza_ring');
    expect(ringContacts.filter((c) => c.kind === 'node')).toEqual([{ kind: 'node', nodeId: 'n_out_in', at: g.nodes.get('n_out_in')!.geometry.coordinates }]);
    expect(ringContacts.filter((c) => c.kind === 'edge' && c.edgeId === 'e_out_w__e')).toHaveLength(4);
    expect(ringContacts.filter((c) => c.kind === 'edge' && c.edgeId === 'e_out_w__in')).toHaveLength(1);
    expect(plazaContacts(g, 'plaza_lawn')).toEqual([{ kind: 'node', nodeId: 'n_out_b', at: g.nodes.get('n_out_b')!.geometry.coordinates }]);
  });
});
