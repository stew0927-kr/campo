// Plaza transfer (길 A → 평지 → 길 B): a plaza joins the paths that meet it, so a route may cross it in the middle, start or
// end on a point that stands on it ({ nodeId }), and a point just outside its boundary still counts as on it.
// Follows graph links and plaza geometry only.
import { describe, expect, it } from 'vitest';
import {
  PROFILES,
  WALK_SPEED_MPS,
  buildGraph,
  endAtPoint,
  findRoute,
  findRouteBetween,
  findRouteThrough,
  plazaAt,
  type CampusGraph,
  type LoadedCampus,
  type PointRoute,
  type PointRouteResult,
  type Position,
  type Route,
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
const lengthOf = (path: Position[]) => path.slice(1).reduce((s, p, i) => {
  const [a, b] = [xy(path[i]!), xy(p)];
  return s + Math.hypot(b[0] - a[0], b[1] - a[1]);
}, 0);

/** Road A ends on the plaza's west side (0, 10), road B starts on its east side (30, 10); the two never meet. */
const roadA = () => [node('a1', -20, 10), node('a2', 0, 10), edge('e_a', 'a1', 'a2')];
const roadB = () => [node('b1', 30, 10), node('b2', 50, 10), edge('e_b', 'b1', 'b2')];

describe('길 A → 평지 → 길 B', () => {
  it('crosses the plaza between two roads that do not meet: distance and time include the walk', () => {
    const g = graphOf(plaza('p', [rect(0, 0, 30, 20)], '분수 광장'), ...roadA(), ...roadB());
    const a = findRoute(g, 'a1', 'a2', 'shortest') as Route;
    const b = findRoute(g, 'b1', 'b2', 'shortest') as Route;
    for (const profile of PROFILES) {
      const r = found(findRouteBetween(g, { nodeId: 'a1' }, { nodeId: 'b2' }, profile));
      expect(r.nodes).toEqual(['a1', 'a2', 'b1', 'b2']);
      expect(r.distanceM).toBeCloseTo(70, 0);
      expect(r.timeSec).toBeCloseTo(a.timeSec + b.timeSec + 30 / WALK_SPEED_MPS, 0);
      expect(r.viaPlazas).toHaveLength(1);
      const via = r.viaPlazas![0]!;
      expect(via).toMatchObject({ plazaId: 'p', fromNodeId: 'a2', toNodeId: 'b1' });
      expect(via.lengthM).toBeCloseTo(30, 1);
      expect(xy(via.path[0]!)[0]).toBeCloseTo(0, 3);
      expect(xy(via.path.at(-1)!)[0]).toBeCloseTo(30, 3);
    }
  });

  it('the way back, and the step sentence names the plaza', () => {
    const g = graphOf(plaza('p', [rect(0, 0, 30, 20)], '분수 광장'), ...roadA(), ...roadB());
    const r = found(findRouteBetween(g, { nodeId: 'b2' }, { nodeId: 'a1' }, 'shortest'));
    expect(r.nodes).toEqual(['b2', 'b1', 'a2', 'a1']);
    expect(r.viaPlazas![0]).toMatchObject({ fromNodeId: 'b1', toNodeId: 'a2' });
    const step = r.steps.find((s) => s.text.includes('분수 광장'))!;
    expect(step).toMatchObject({ kind: 'walk', fromNodeId: 'b1', toNodeId: 'a2' });
    expect(step.text).toBe("평지 '분수 광장'을 가로질러 30m 걸어가세요");
  });

  it('entering the plaza in the middle of an edge walks only the part of it up to the plaza', () => {
    // e_a runs (-10, 5) → (10, 25): it crosses the west side at (0, 15) and the north side at (5, 20); a3 is 15 m north of a2.
    const g = graphOf(
      plaza('p', [rect(0, 0, 30, 20)]),
      node('a1', -10, 5), node('a2', 10, 25), node('a3', 10, 40), edge('e_a', 'a1', 'a2'), edge('e_a3', 'a2', 'a3'),
      ...roadB(),
    );
    const r = found(findRouteBetween(g, { nodeId: 'a3' }, { nodeId: 'b2' }, 'shortest'));
    // a3 → a2 15 m, a2 → (5, 20) 7.07 m along e_a, (5, 20) → (30, 10) 26.93 m on the plaza, b1 → b2 20 m.
    expect(r.distanceM).toBeCloseTo(15 + Math.hypot(5, 5) + Math.hypot(25, 10) + 20, 0);
    expect(r.nodes).toEqual(['a3', 'a2', 'b1', 'b2']);
    const via = r.viaPlazas![0]!;
    expect(via.lengthM).toBeCloseTo(Math.hypot(25, 10), 1);
    expect(xy(via.path[0]!)[0]).toBeCloseTo(5, 2);
    expect(xy(via.path[0]!)[1]).toBeCloseTo(20, 2);
    // The drawn line runs from a2 along e_a to the contact, across, and on to b1.
    expect(xy(via.line[0]!)[0]).toBeCloseTo(10, 2);
    expect(xy(via.line.at(-1)!)[0]).toBeCloseTo(30, 2);
    expect(r.edgeIds).toContain('e_a');
  });

  it('around a hole: the walk bends at its corners and never crosses it', () => {
    const g = graphOf(plaza('p', [rect(0, 0, 30, 20), rect(10, 5, 20, 15, false)]), ...roadA(), ...roadB());
    const r = found(findRouteBetween(g, { nodeId: 'a1' }, { nodeId: 'b2' }, 'shortest'));
    const via = r.viaPlazas![0]!;
    expect(via.lengthM).toBeCloseTo(2 * Math.hypot(10, 5) + 10, 1);
    expect(lengthOf(via.path)).toBeCloseTo(via.lengthM, 1);
    expect(r.distanceM).toBeCloseTo(40 + via.lengthM, 0);
    for (let i = 0; i + 1 < via.path.length; i++) {
      const [a, b] = [xy(via.path[i]!), xy(via.path[i + 1]!)];
      for (const t of [0.25, 0.5, 0.75]) {
        const m = F.toPos(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
        expect(plazaAt(g, m)?.hit).toBe('solid');
      }
    }
  });

  it('across two linked plazas (A and B share a side)', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 15, 20)]), plaza('pb', [rect(15, 0, 30, 20)]), ...roadA(), ...roadB());
    const r = found(findRouteBetween(g, { nodeId: 'a1' }, { nodeId: 'b2' }, 'shortest'));
    expect(r.distanceM).toBeCloseTo(70, 0);
    const via = r.viaPlazas![0]!;
    expect(via.plazaId).toBe('pa');
    expect(via.plazaIds).toEqual(['pa', 'pb']);
    expect(via.lengthM).toBeCloseTo(30, 1);
  });

  it('a plaza between roads that is not linked to the other plaza is no bridge', () => {
    const g = graphOf(plaza('pa', [rect(0, 0, 12, 20)]), plaza('pb', [rect(18, 0, 30, 20)]), ...roadA(), ...roadB());
    expect(findRouteBetween(g, { nodeId: 'a1' }, { nodeId: 'b2' }, 'shortest').found).toBe(false);
  });

  it('findRouteThrough keeps the crossings of its parts', () => {
    const g = graphOf(plaza('p', [rect(0, 0, 30, 20)]), ...roadA(), ...roadB());
    const r = found(findRouteThrough(g, [{ nodeId: 'a1' }, { nodeId: 'b1' }, { nodeId: 'b2' }], 'shortest'));
    expect(r.viaPlazas).toHaveLength(1);
    expect(r.distanceM).toBeCloseTo(70, 0);
  });
});

describe('a node that stands on a plaza ({ nodeId } ends)', () => {
  it('a point on the plaza with no edge of its own is found from and to, in every profile', () => {
    const g = graphOf(plaza('p', [rect(0, 0, 30, 20)]), node('on', 10, 12), ...roadB());
    for (const profile of PROFILES) {
      const there = found(findRouteBetween(g, { nodeId: 'on' }, { nodeId: 'b2' }, profile));
      expect(there.distanceM).toBeCloseTo(Math.hypot(20, 2) + 20, 0);
      expect(there.viaPlazas![0]).toMatchObject({ fromNodeId: 'on', toNodeId: 'b1' });
      const back = found(findRouteBetween(g, { nodeId: 'b2' }, { nodeId: 'on' }, profile));
      expect(back.distanceM).toBeCloseTo(there.distanceM, 1);
    }
  });

  it('a node 0.2 m outside the boundary counts as on it; an indoor node never does', () => {
    const g = graphOf(
      plaza('p', [rect(0, 0, 30, 20)]), node('edge', -0.2, 12), node('inside', 10, 12, { node_type: 'corridor', building_id: 'B', level: 1 }),
      ...roadB(),
    );
    expect(found(findRouteBetween(g, { nodeId: 'edge' }, { nodeId: 'b2' }, 'shortest')).distanceM).toBeCloseTo(0.2 + Math.hypot(30, 2) + 20, 0);
    expect(findRouteBetween(g, { nodeId: 'inside' }, { nodeId: 'b2' }, 'shortest').found).toBe(false);
  });

  it('the campus-plaza fixture: a point on 분수 광장 reaches n_out_b', async () => {
    const { fileURLToPath } = await import('node:url');
    const { loadCampus } = await import('../../src/node/index.ts');
    const campus = await loadCampus(fileURLToPath(new URL('../fixtures/campus-plaza', import.meta.url)));
    campus.features.push({ file: 'outdoor.geojson', feature: node('n_on_plaza', 10, 15) as never });
    const g = buildGraph(campus, { overrides: [], calibration: {} });
    for (const profile of PROFILES) expect(findRouteBetween(g, { nodeId: 'n_on_plaza' }, { nodeId: 'n_out_b' }, profile).found).toBe(true);
  });
});

describe('plazaAt: within PLAZA_NODE_TOL_M of the boundary is on the plaza', () => {
  it('0.2 m outside is solid, 0.5 m outside is nothing; endAtPoint follows', () => {
    const g = graphOf(plaza('p', [rect(0, 0, 30, 20)]), ...roadB());
    expect(plazaAt(g, P(30.2, 5))).toMatchObject({ plaza: { id: 'p' }, hit: 'solid' });
    expect(plazaAt(g, P(-0.25, 5))?.hit).toBe('solid');
    expect(plazaAt(g, P(30.5, 5))).toBeNull();
    const end = endAtPoint(g, P(-0.2, 5))!;
    expect('plaza' in end).toBe(true);
    expect(found(findRouteBetween(g, end, { nodeId: 'b2' }, 'shortest')).distanceM).toBeCloseTo(0.2 + Math.hypot(30, 5) + 20, 0);
    expect('snap' in endAtPoint(g, P(-0.5, 5))!).toBe(true);
  });

  it('linked plazas: the first by id whose solid area holds the point, then the first within the tolerance', () => {
    const g = graphOf(plaza('pb', [rect(10, 0, 30, 20)]), plaza('pa', [rect(0, 0, 10, 20)]), ...roadB());
    expect(plazaAt(g, P(10, 5))!.plaza.id).toBe('pa');
    expect(plazaAt(g, P(10.2, 5))!.plaza.id).toBe('pb'); // on pb itself, 0.2 m outside pa
    expect(plazaAt(g, P(-0.2, 5))!.plaza.id).toBe('pa');
    expect(plazaAt(g, P(20, 5))!.plaza.id).toBe('pb');
  });
});
