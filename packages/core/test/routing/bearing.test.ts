// Walking directions at the nodes of a route (route/bearing.ts), and that findRoute fills them into its steps.
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LOOKAHEAD_M,
  bearingAlong,
  buildGraph,
  computeStepBearings,
  findRoute,
  initialBearingDeg,
  signedDiffDeg,
  type CampusGraph,
  type LngLat,
  type RouteStep,
} from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';

// About 1 m in degrees at latitude 37.56 (Seoul): north per 1e-5 lat ≈ 1.11 m, east per 1e-5 lng ≈ 0.88 m.
const O: LngLat = [127.045, 37.556];
const LAT_M = 1 / 111_195;
const LNG_M = 1 / (111_195 * Math.cos((O[1] * Math.PI) / 180));
/** A point `east` / `north` metres from O. */
const at = (east: number, north: number): LngLat => [O[0] + east * LNG_M, O[1] + north * LAT_M];

const step = (kind: RouteStep['kind'], edges: number): RouteStep => ({
  kind, fromNodeId: 'a', toNodeId: 'b', fromLevel: null, toLevel: null, distanceM: 0, timeSec: 0,
  edgeIds: Array.from({ length: edges }, (_, i) => `e${i}`), text: '',
});

/** Within 1° of `expected` (the test points are placed to the metre). */
const near = (value: number | null | undefined, expected: number) => {
  expect(value).toBeTypeOf('number');
  expect(Math.abs(signedDiffDeg(value!, expected))).toBeLessThan(1);
};

describe('initialBearingDeg / signedDiffDeg', () => {
  it('measures the four compass points clockwise from north', () => {
    near(initialBearingDeg(O, at(0, 10)), 0);
    near(initialBearingDeg(O, at(10, 0)), 90);
    near(initialBearingDeg(O, at(0, -10)), 180);
    near(initialBearingDeg(O, at(-10, 0)), 270);
    expect(initialBearingDeg(O, at(-10, 0))).toBeGreaterThan(0);
  });

  it('signedDiffDeg is -180..180 with right positive, across north as well', () => {
    expect(signedDiffDeg(10, 350)).toBe(20);
    expect(signedDiffDeg(350, 10)).toBe(-20);
    expect(signedDiffDeg(90, 0)).toBe(90);
    expect(signedDiffDeg(0, 90)).toBe(-90);
    expect(signedDiffDeg(180, 0)).toBe(-180);
    expect(signedDiffDeg(-10, 10)).toBe(-20);
    expect(Object.is(signedDiffDeg(45, 45), 0)).toBe(true);
  });
});

describe('bearingAlong', () => {
  it('looks 4 m ahead along a bent line, not at the next node', () => {
    // 2 m north, then 10 m east: 4 m along is 2 m north + 2 m east → 45°; the next node alone would say 0°.
    const line = [O, at(0, 2), at(10, 2)];
    near(bearingAlong(line, 0, 1), 45);
    expect(LOOKAHEAD_M).toBe(4);
  });

  it('walks over short edges and zero-length stretches (a floor change) to gather its distance', () => {
    const line = [O, at(0.5, 0), at(0.5, 0), at(1, 0), at(10, 0)];
    near(bearingAlong(line, 0, 1), 90);
  });

  it('looks back with dir -1 (pointing back along the route)', () => {
    const line = [at(0, -10), O, at(10, 0)];
    near(bearingAlong(line, 1, -1), 180);
  });

  it('is null with less than 1 m to go, or at the end of the line; a short end still counts from 1 m', () => {
    expect(bearingAlong([O, at(0.5, 0)], 0, 1)).toBeNull();
    expect(bearingAlong([O, at(10, 0)], 1, 1)).toBeNull();
    expect(bearingAlong([O, O], 0, 1)).toBeNull();
    near(bearingAlong([O, at(2, 0)], 0, 1), 90);
    expect(bearingAlong([], 0, 1)).toBeNull();
  });
});

describe('computeStepBearings', () => {
  it('gives one entry per step start and one for the destination (in only); turns are signed', () => {
    // walk north 10 m, then walk east 10 m.
    const line = [O, at(0, 10), at(10, 10)];
    const b = computeStepBearings([step('walk', 1), step('walk', 1)], line);
    expect(b).toHaveLength(3);
    near(b[0]!.outDeg, 0);
    expect(b[0]!.inDeg).toBeNull();
    expect(b[0]!.turnDeg).toBeNull();
    near(b[1]!.outDeg, 90);
    near(b[1]!.inDeg, 0);
    near(b[1]!.turnDeg, 90); // right turn
    expect(b[2]!.outDeg).toBeNull();
    near(b[2]!.inDeg, 90);
  });

  it('a left turn is negative', () => {
    const b = computeStepBearings([step('walk', 1), step('walk', 1)], [O, at(0, 10), at(-10, 10)]);
    near(b[1]!.turnDeg, -90);
  });

  it('an elevator drawn at one spot: board facing the way it was entered, get off facing the way the route goes on', () => {
    // walk east 10 m to the stop, ride (same spot), walk north 10 m on the other floor.
    const line = [O, at(10, 0), at(10, 0), at(10, 10)];
    const b = computeStepBearings([step('walk', 1), step('elevator', 1), step('walk', 1)], line);
    expect(b).toHaveLength(4);
    near(b[1]!.outDeg, 90); // facing the elevator
    near(b[1]!.inDeg, 90);
    expect(b[1]!.floorChange).toBe('elevator');
    near(b[2]!.outDeg, 0);
    near(b[2]!.inDeg, 0); // not the corridor of the floor left behind
    near(b[2]!.turnDeg, 0);
    expect(b[2]!.floorChange).toBeUndefined();
  });

  it('a route that starts with the ride takes the direction after it', () => {
    const line = [O, O, at(0, 10)];
    const b = computeStepBearings([step('elevator', 1), step('walk', 1)], line);
    near(b[0]!.outDeg, 0);
    expect(b[0]!.floorChange).toBe('elevator');
  });

  it('stairs with a horizontal run keep their own direction', () => {
    const line = [O, at(0, 10), at(0, 20)];
    const b = computeStepBearings([step('walk', 1), step('stairs', 1)], line);
    near(b[1]!.outDeg, 0);
    expect(b[1]!.floorChange).toBe('stairs');
  });

  it('a step too short to tell (0.5 m) leaving falls back to the way it was entered', () => {
    const line = [O, at(0, 10), at(0.3, 10.4)];
    const b = computeStepBearings([step('walk', 1), step('walk', 1)], line);
    near(b[1]!.outDeg, 0);
  });

  it('is empty when the line does not fit the steps', () => {
    expect(computeStepBearings([step('walk', 2)], [O, at(0, 10)])).toEqual([]);
    expect(computeStepBearings([], [O])).toEqual([]);
  });
});

describe('findRoute fills the directions into its steps', () => {
  const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/campus-basic', import.meta.url));
  let graph: CampusGraph;
  beforeAll(async () => {
    graph = buildGraph(await loadCampus(FIXTURE_DIR));
  });

  it('every step of gate → B동 201 (step_free, by elevator) has a direction; only the first lacks the way in', () => {
    const r = findRoute(graph, 'n_out_0001', 'n_B_2_201door', 'step_free');
    if (!r.found) throw new Error(r.message);
    for (const s of r.steps) {
      expect(s.bearing_deg).toBeGreaterThanOrEqual(0);
      expect(s.bearing_deg).toBeLessThan(360);
      expect(s.bearing_arrive_deg).toBeGreaterThanOrEqual(0);
    }
    expect(r.steps[0]!.bearing_in_deg).toBeUndefined();
    expect(r.steps[0]!.bearing_turn_deg).toBeUndefined();
    for (const s of r.steps.slice(1)) expect(s.bearing_in_deg).toBeGreaterThanOrEqual(0);
    const ride = r.steps.find((s) => s.kind === 'elevator')!;
    expect(ride.bearing_floor_change).toBe('elevator');
    // Each step's way of arriving is the next step's way in.
    r.steps.slice(0, -1).forEach((s, i) => expect(s.bearing_arrive_deg).toBe(r.steps[i + 1]!.bearing_in_deg));
    expect(r.steps.filter((s) => s.kind === 'walk').every((s) => s.bearing_floor_change === undefined)).toBe(true);
  });
});
