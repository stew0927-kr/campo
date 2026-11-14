import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FEWEST_STEPS_STAIRS_PENALTY_SEC,
  RAMP_PENALTY_SEC,
  buildGraph,
  findNearestRestroom,
  findNearestRestroomFrom,
  findRoute,
  findRouteBetween,
  snapToRoutes,
  type CampusGraph,
  type Route,
} from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/campus-basic', import.meta.url));
const GATE = 'n_out_0001';
const ROOM_408 = 'n_A_4_408door';
const A_HALL_1 = 'n_A_1_hall';
const A_HALL_3 = 'n_A_3_hall';

let g: CampusGraph;
beforeAll(async () => {
  g = buildGraph(await loadCampus(FIXTURE_DIR));
});

const found = <T extends { found: boolean }>(r: T): Extract<T, { found: true }> => {
  if (!r.found) throw new Error(`expected a route: ${(r as unknown as { message: string }).message}`);
  return r as Extract<T, { found: true }>;
};

describe('snapToRoutes: the foot of the perpendicular on the nearest walkable edge', () => {
  it('drops a point beside the gate path onto that path', () => {
    // The gate path runs from [127, 37] to [127.0002, 37.0004]; this point is a little east of its middle.
    const s = snapToRoutes(g, [127.00013, 37.0002])!;
    expect(s.edgeId).toBe('e_out_0001__out_0002');
    expect(s.distanceM).toBeGreaterThan(1);
    expect(s.distanceM).toBeLessThan(10);
    expect(s.along).toBeGreaterThan(0.3);
    expect(s.along).toBeLessThan(0.7);
    // The foot lies on the segment: lng / lat in the same ratio as the edge.
    expect((s.foot[0] - 127) / 0.0002).toBeCloseTo((s.foot[1] - 37) / 0.0004, 2);
  });

  it('never snaps to an elevator edge, and honours accept', () => {
    const s = snapToRoutes(g, [127.00013, 37.0002], (e) => e.id !== 'e_out_0001__out_0002')!;
    expect(s.edgeId).not.toBe('e_out_0001__out_0002');
    g.graph.forEachLink((l) => {
      if (l.data.kind === 'hop') expect(s.edgeId).not.toBe(l.data.edge.id);
    });
  });
});

describe('findRouteBetween', () => {
  it('a node to a node is findRoute itself', () => {
    const r = found(findRouteBetween(g, { nodeId: GATE }, { nodeId: ROOM_408 }, 'shortest'));
    const plain = found(findRoute(g, GATE, ROOM_408, 'shortest'));
    expect(r.edgeIds).toEqual(plain.edgeIds);
    expect(r.timeSec).toBe(plain.timeSec);
    expect(r.startFoot).toBeNull();
  });

  it('a snapped start walks part of its edge, then follows the graph', () => {
    const snap = snapToRoutes(g, [127.00013, 37.0002])!;
    const r = found(findRouteBetween(g, { snap }, { nodeId: ROOM_408 }, 'shortest'));
    const fromEnd = found(findRoute(g, 'n_out_0002', ROOM_408, 'shortest'));
    // Leaves the foot towards n_out_0002 (uphill, towards the building), so it is that route plus part of the gate path.
    expect(r.nodes[0]).toBe('n_out_0002');
    expect(r.edgeIds).toEqual(fromEnd.edgeIds);
    expect(r.timeSec).toBeGreaterThan(fromEnd.timeSec);
    expect(r.distanceM).toBeGreaterThan(fromEnd.distanceM);
    expect(r.startFoot).toEqual(snap.foot);
    // Shorter than starting at the gate itself.
    expect(r.timeSec).toBeLessThan(found(findRoute(g, GATE, ROOM_408, 'shortest')).timeSec);
  });

  it('a snapped destination ends at its foot', () => {
    const snap = snapToRoutes(g, [127.00013, 37.0002])!;
    const r = found(findRouteBetween(g, { nodeId: ROOM_408 }, { snap }, 'step_free'));
    expect(r.endFoot).toEqual(snap.foot);
    expect(r.stairsCount).toBe(0);
  });
});

describe('elevator_first: the lift wherever there is one', () => {
  it('takes the elevator where shortest takes the stairs', () => {
    const short = found(findRoute(g, A_HALL_1, A_HALL_3, 'shortest'));
    const lift: Route = found(findRoute(g, A_HALL_1, A_HALL_3, 'elevator_first'));
    expect(short.stairsCount + short.escalatorCount).toBeGreaterThan(0);
    expect(lift.stairsCount).toBe(0);
    expect(lift.escalatorCount).toBe(0);
    expect(lift.edgeIds).toContain('e_A_elevA_L1__A_elevA_L2');
  });

  it('costs stairs like fewest_steps and adds a ramp penalty, never closing anything', () => {
    g.graph.forEachLink((l) => {
      if (l.data.kind !== 'walk') return;
      const { highway } = l.data.edge.properties;
      const extra = l.data.cost.elevator_first - l.data.timeSec;
      if (highway === 'steps') expect(extra).toBeCloseTo(FEWEST_STEPS_STAIRS_PENALTY_SEC, 5);
      else if (highway === 'ramp') expect(extra).toBeCloseTo(RAMP_PENALTY_SEC, 5);
      expect(l.data.blocked.elevator_first).toBe(l.data.blocked.shortest);
    });
  });
});

describe('wheelchair: 휠체어로 갈 수 있는 가장 가까운 화장실', () => {
  it('goes only to a wheelchair restroom, without steps', () => {
    const r = found(findNearestRestroom(g, A_HALL_1, 'wheelchair'));
    expect(r.targetId).toBe('n_A_4_wc_f'); // n_A_4_wc_m is wheelchair: no
    expect(r.profile).toBe('wheelchair');
    expect(r.stairsCount).toBe(0);
    expect(r.escalatorCount).toBe(0);
    expect(r.fallback).toBeNull();
  });

  it('is closed on steps and pays for ramps', () => {
    g.graph.forEachLink((l) => {
      if (l.data.kind !== 'walk') return;
      const { highway } = l.data.edge.properties;
      if (highway === 'steps') expect(l.data.blocked.wheelchair).toBe(true);
      if (highway === 'ramp') expect(l.data.cost.wheelchair).toBeGreaterThanOrEqual(l.data.cost.step_free + RAMP_PENALTY_SEC - 1e-9);
    });
  });

  it('finds no route rather than falling back to stairs', () => {
    // B동 2층 201호 is only reachable over steps from A동 1층 (the B building has stairs only).
    const free = findRoute(g, A_HALL_1, 'n_B_1_hall', 'step_free');
    const chair = findRoute(g, A_HALL_1, 'n_B_1_hall', 'wheelchair');
    if (free.found && free.fallback) expect(chair.found).toBe(false);
    else expect(chair.found).toBe(free.found);
  });

  it('any restroom: the nearest one, by the shortest profile', () => {
    const r = found(findNearestRestroom(g, A_HALL_1, 'any'));
    expect(['n_A_4_wc_f', 'n_A_4_wc_m']).toContain(r.targetId);
    expect(r.profile).toBe('shortest');
  });
});

describe('findNearestRestroomFrom: 가장 가까운 화장실 from a picked point', () => {
  it('a node start is findNearestRestroom itself', () => {
    const r = found(findNearestRestroomFrom(g, { nodeId: A_HALL_1 }, 'wheelchair'));
    expect(r.targetId).toBe(found(findNearestRestroom(g, A_HALL_1, 'wheelchair')).targetId);
    expect(r.startFoot).toBeNull();
  });
  it('a snapped start adds its stretch of edge', () => {
    const snap = snapToRoutes(g, [127.00013, 37.0002])!;
    const r = found(findNearestRestroomFrom(g, { snap }, 'any'));
    expect(r.startFoot).toEqual(snap.foot);
    expect(['n_A_4_wc_f', 'n_A_4_wc_m']).toContain(r.targetId);
  });
});
