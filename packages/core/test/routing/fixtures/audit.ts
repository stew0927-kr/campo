// Code-built campuses for the v0.1 routing audit (SPEC-v0.2 3.7, R1~R20).
//
// These return LoadedCampus directly instead of a GeoJSON folder, because some
// cases (step_free: null, a missing step_free, node_type 'restroom', incline)
// are not allowed by the v0.1 schema yet. Positions are given in metres on a
// local plane and converted to [lon, lat]; edge coordinates are filled in from
// the node positions unless a case needs them to be wrong on purpose.
import type { LoadedCampus, Position } from '../../../src/types.ts';

type XY = [number, number];
type Props = Record<string, unknown>;

const LON0 = 127.0;
const LAT0 = 37.0;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

/** Local metres → [lon, lat]. */
export function pos([x, y]: XY): Position {
  return [LON0 + x / M_PER_DEG_LON, LAT0 + y / M_PER_DEG_LAT];
}

const SOURCE = 'field-survey-2026-11';

interface NodeSpec { kind: 'node'; id: string; at: XY; props: Props }
interface EdgeSpec { kind: 'edge'; id: string; from: string; to: string; props: Props; via: XY[]; coords: XY[] | undefined; omit: string[] }
interface BuildingSpec { kind: 'building'; id: string; props: Props }
type Spec = NodeSpec | EdgeSpec | BuildingSpec;

export function node(id: string, at: XY, props: Props = {}): NodeSpec {
  return { kind: 'node', id, at, props: { node_type: 'corridor', building_id: null, level: null, source: SOURCE, ...props } };
}

export interface EdgeGeometry {
  /** Bend points between the two node positions (makes the line longer than the straight distance). */
  via?: XY[];
  /** Use these coordinates as-is instead of the node positions (for data-error cases). */
  coords?: XY[];
  /** Property keys to leave out entirely (e.g. a missing step_free). */
  omit?: string[];
}

export function edge(id: string, from: string, to: string, props: Props = {}, geometry: EdgeGeometry = {}): EdgeSpec {
  return {
    kind: 'edge',
    id,
    from,
    to,
    props: { highway: 'corridor', edge_type: 'indoor', bidirectional: true, step_free: true, source: SOURCE, ...props },
    via: geometry.via ?? [],
    coords: geometry.coords,
    omit: geometry.omit ?? [],
  };
}

export function building(id: string, name: string, code: string, levels: number[], props: Props = {}): BuildingSpec {
  return {
    kind: 'building',
    id,
    props: { name, code, levels, ground_levels: levels.slice(0, 1), source: SOURCE, ...props },
  };
}

export function campus(specs: Spec[]): LoadedCampus {
  const at = new Map<string, XY>();
  for (const s of specs) if (s.kind === 'node') at.set(s.id, s.at);

  const features = specs.map((s) => {
    switch (s.kind) {
      case 'node':
        return {
          file: 'audit.geojson',
          feature: { type: 'Feature', id: s.id, geometry: { type: 'Point', coordinates: pos(s.at) }, properties: { kind: 'node', ...s.props } },
        };
      case 'building': {
        const ring: XY[] = [[-50, -50], [60, -50], [60, 50], [-50, 50], [-50, -50]];
        return {
          file: 'audit.geojson',
          feature: { type: 'Feature', id: s.id, geometry: { type: 'Polygon', coordinates: [ring.map(pos)] }, properties: { kind: 'building', ...s.props } },
        };
      }
      case 'edge': {
        const a = at.get(s.from);
        const b = at.get(s.to);
        if (!a || !b) throw new Error(`fixture edge ${s.id}: unknown node`);
        const line = s.coords ?? [a, ...s.via, b];
        const properties: Props = { kind: 'edge', ...s.props, from: s.from, to: s.to };
        for (const key of s.omit) delete properties[key];
        return {
          file: 'audit.geojson',
          feature: { type: 'Feature', id: s.id, geometry: { type: 'LineString', coordinates: line.map(pos) }, properties },
        };
      }
    }
  });
  return { meta: { id: 'audit', name: 'audit', center: pos([0, 0]), bbox: [126.99, 36.99, 127.01, 37.01] }, features, fileErrors: [] };
}

/** Deep copy with every level value removed (level, level_from, level_to, levels, ground_levels). */
export function stripLevels(c: LoadedCampus): { campus: LoadedCampus; removed: number } {
  const copy = structuredClone(c);
  let removed = 0;
  for (const { feature } of copy.features) {
    const p = (feature as { properties: Props }).properties;
    for (const key of ['level', 'level_from', 'level_to', 'levels', 'ground_levels']) {
      if (key in p) {
        delete p[key];
        removed++;
      }
    }
  }
  return { campus: copy, removed };
}

// ---- tower7: 7 floors, hall + elevator stop + stair landing on every floor ----

export const TOWER = {
  hall: (l: number) => `n_T_${l}_hall`,
  stop: (l: number) => `n_T_elevA_L${l}`,
  landing: (l: number) => `n_T_${l}_stair`,
  /** Elevator edge from floor l to l+1. */
  elevatorEdge: (l: number) => `e_T_elevA_L${l}__T_elevA_L${l + 1}`,
  /** Stair edge from floor l to l+1. */
  stairEdge: (l: number) => `e_T_${l}_stair__T_${l + 1}_stair`,
  hallToStop: (l: number) => `e_T_${l}_hall__T_elevA_L${l}`,
  hallToLanding: (l: number) => `e_T_${l}_hall__T_${l}_stair`,
  ELEVATOR_ID: 'T-EV1',
} as const;

export interface Tower7Options {
  /** Include the elevator (default true). */
  elevator?: boolean;
  /**
   * Connect every floor's stair landing to that floor's hall (default true).
   * false: only floors 1 and 7 are connected, so the landings in between have no branch.
   */
  stairBranches?: boolean;
}

/**
 * 7-floor building "T동". Each floor: hall at (0,0), elevator stop at (10,0)
 * (same position on every floor), stair landing at (-10,0). Neighbouring stops
 * are joined by one elevator edge each (6 edges, SPEC §3), neighbouring
 * landings by one steps edge each (bent through (-15,5), ~14 m, incline 'up').
 */
export function tower7({ elevator = true, stairBranches = true }: Tower7Options = {}): LoadedCampus {
  const levels = [1, 2, 3, 4, 5, 6, 7];
  const specs: Spec[] = [building('bldg_T', 'T동', 'T', levels)];
  for (const l of levels) {
    const where = { building_id: 'bldg_T', level: l };
    specs.push(node(TOWER.hall(l), [0, 0], { node_type: 'corridor', ...where }));
    specs.push(node(TOWER.landing(l), [-10, 0], { node_type: 'stair_landing', ...where }));
    if (stairBranches || l === 1 || l === 7) specs.push(edge(TOWER.hallToLanding(l), TOWER.hall(l), TOWER.landing(l)));
    if (elevator) {
      specs.push(node(TOWER.stop(l), [10, 0], { node_type: 'elevator_stop', shaft_id: TOWER.ELEVATOR_ID, elevator_id: TOWER.ELEVATOR_ID, ...where }));
      specs.push(edge(TOWER.hallToStop(l), TOWER.hall(l), TOWER.stop(l)));
    }
  }
  for (const l of levels.slice(0, -1)) {
    specs.push(edge(TOWER.stairEdge(l), TOWER.landing(l), TOWER.landing(l + 1), {
      highway: 'steps', step_free: false, level_from: l, level_to: l + 1, step_count: 20, incline: 'up',
    }, { via: [[-15, 5]] }));
    if (elevator) {
      specs.push(edge(TOWER.elevatorEdge(l), TOWER.stop(l), TOWER.stop(l + 1), {
        highway: 'elevator', step_free: true, level_from: l, level_to: l + 1,
      }));
    }
  }
  return campus(specs);
}

// ---- parallelStairsRamp: steps and a ramp between the same two points ----

export const PARALLEL = { P: 'n_out_P', Q: 'n_out_Q', STEPS: 'e_out_P__out_Q_steps', RAMP: 'e_out_P__out_Q_ramp' } as const;

/**
 * Outdoor P (0,0) and Q (20,0). Steps straight across (20 m), ramp bent through
 * (10,30) (~63 m), so shortest prefers the steps and step_free must use the ramp.
 */
export function parallelStairsRamp({ rampStepFree = true }: { rampStepFree?: boolean | null } = {}): LoadedCampus {
  return campus([
    node(PARALLEL.P, [0, 0], { node_type: 'outdoor' }),
    node(PARALLEL.Q, [20, 0], { node_type: 'outdoor' }),
    edge(PARALLEL.STEPS, PARALLEL.P, PARALLEL.Q, { highway: 'steps', edge_type: 'outdoor', step_free: false, step_count: 12 }),
    edge(PARALLEL.RAMP, PARALLEL.P, PARALLEL.Q, { highway: 'ramp', edge_type: 'outdoor', step_free: rampStepFree }, { via: [[10, 30]] }),
  ]);
}

// ---- oneWay: A → B only ----

export const ONE_WAY = { A: 'n_out_A', B: 'n_out_B', EDGE: 'e_out_A__out_B' } as const;

export function oneWay(): LoadedCampus {
  return campus([
    node(ONE_WAY.A, [0, 0], { node_type: 'outdoor' }),
    node(ONE_WAY.B, [30, 0], { node_type: 'outdoor' }),
    edge(ONE_WAY.EDGE, ONE_WAY.A, ONE_WAY.B, { highway: 'footway', edge_type: 'outdoor', bidirectional: false }),
  ]);
}

// ---- triangle: A–B direct (30 m) and A–C–B (~50 m) ----

export const TRIANGLE = { A: 'n_out_TA', B: 'n_out_TB', C: 'n_out_TC' } as const;

export function triangle(): LoadedCampus {
  const out = { highway: 'footway', edge_type: 'outdoor' };
  return campus([
    node(TRIANGLE.A, [0, 0], { node_type: 'outdoor' }),
    node(TRIANGLE.B, [30, 0], { node_type: 'outdoor' }),
    node(TRIANGLE.C, [15, 20], { node_type: 'outdoor' }),
    edge('e_out_TA__out_TB', TRIANGLE.A, TRIANGLE.B, out),
    edge('e_out_TA__out_TC', TRIANGLE.A, TRIANGLE.C, out),
    edge('e_out_TC__out_TB', TRIANGLE.C, TRIANGLE.B, out),
  ]);
}

// ---- nullCorridor: indoor corridors whose step_free is null / missing ----

export const NULL_CORRIDOR = {
  OUT: 'n_out_N0',
  MAIN: 'n_N_1_main',
  HALL: 'n_N_1_hall',
  /** Behind a corridor with step_free: null. */
  ROOM_NULL: 'n_N_1_101door',
  /** Behind a corridor with no step_free key at all. */
  ROOM_MISSING: 'n_N_1_102door',
  EDGE_NULL: 'e_N_1_hall__N_1_101door',
  EDGE_MISSING: 'e_N_1_hall__N_1_102door',
} as const;

export function nullCorridor(): LoadedCampus {
  const N = NULL_CORRIDOR;
  const inN = { building_id: 'bldg_N', level: 1 };
  return campus([
    building('bldg_N', 'N동', 'N', [1]),
    node(N.OUT, [-10, 0], { node_type: 'outdoor' }),
    node(N.MAIN, [0, 0], { node_type: 'entrance', ...inN }),
    node(N.HALL, [20, 0], { node_type: 'corridor', ...inN }),
    node(N.ROOM_NULL, [40, 0], { node_type: 'door', space_name: '101호 강의실', ref: '101', ...inN }),
    node(N.ROOM_MISSING, [20, 20], { node_type: 'door', space_name: '102호 강의실', ref: '102', ...inN }),
    edge('e_portal_N_1_main', N.MAIN, N.OUT, { highway: 'footway', edge_type: 'portal', step_free: true }),
    edge('e_N_1_main__N_1_hall', N.MAIN, N.HALL, { step_free: true }),
    edge(N.EDGE_NULL, N.HALL, N.ROOM_NULL, { step_free: null, source: 'estimate' }),
    edge(N.EDGE_MISSING, N.HALL, N.ROOM_MISSING, { source: 'estimate' }, { omit: ['step_free'] }),
  ]);
}

// ---- bridgeOffset: A동 3층 ↔ C동 5층 bridge ----

export const BRIDGE = {
  A_HALL: 'n_A_3_hall',
  A_END: 'n_A_3_bridge',
  C_END: 'n_C_5_bridge',
  C_HALL: 'n_C_5_hall',
  EDGE: 'e_A_3_bridge__C_5_bridge',
  C_END_EDGE: 'e_C_5_bridge__C_5_hall',
} as const;

/** stairsAtEnd: the bridge lands on a short flight of steps in C동 instead of a level corridor. */
export function bridgeOffset({ stairsAtEnd = false }: { stairsAtEnd?: boolean } = {}): LoadedCampus {
  const B = BRIDGE;
  const inA = { building_id: 'bldg_A', level: 3 };
  const inC = { building_id: 'bldg_C', level: 5 };
  return campus([
    building('bldg_A', 'A동', 'A', [3]),
    building('bldg_C', 'C동', 'C', [5]),
    node(B.A_HALL, [0, 0], inA),
    node(B.A_END, [10, 0], inA),
    node(B.C_END, [40, 0], inC),
    node(B.C_HALL, [50, 0], inC),
    edge('e_A_3_hall__A_3_bridge', B.A_HALL, B.A_END),
    edge(B.EDGE, B.A_END, B.C_END, {
      highway: 'corridor', edge_type: 'bridge', step_free: true, covered: true,
      level_from: 3, level_to: 5, building_from: 'bldg_A', building_to: 'bldg_C',
    }),
    stairsAtEnd
      ? edge(B.C_END_EDGE, B.C_END, B.C_HALL, { highway: 'steps', step_free: false, step_count: 4 })
      : edge(B.C_END_EDGE, B.C_END, B.C_HALL),
  ]);
}

// ---- restrooms: the straight-line nearest restroom is upstairs, the cheapest is on this floor ----

export const RESTROOMS = {
  START: 'n_R_1_start',
  /** Same floor, 30 m along the corridor. */
  SAME_FLOOR: 'n_R_1_wc',
  /** One floor up, 1 m away in plan, but only reachable by the elevator 20 m away. */
  UPSTAIRS: 'n_R_2_wc',
} as const;

export function restrooms(): LoadedCampus {
  const R = RESTROOMS;
  const wc = { node_type: 'restroom', restroom_gender: 'unisex', wheelchair: 'yes', changing_table: null };
  return campus([
    building('bldg_R', 'R동', 'R', [1, 2]),
    node(R.START, [0, 0], { building_id: 'bldg_R', level: 1 }),
    node(R.SAME_FLOOR, [30, 0], { ...wc, building_id: 'bldg_R', level: 1 }),
    node(R.UPSTAIRS, [1, 0], { ...wc, building_id: 'bldg_R', level: 2 }),
    node('n_R_elevA_L1', [-20, 0], { node_type: 'elevator_stop', shaft_id: 'R-EV1', elevator_id: 'R-EV1', building_id: 'bldg_R', level: 1 }),
    node('n_R_elevA_L2', [-20, 0], { node_type: 'elevator_stop', shaft_id: 'R-EV1', elevator_id: 'R-EV1', building_id: 'bldg_R', level: 2 }),
    edge('e_R_1_start__R_1_wc', R.START, R.SAME_FLOOR),
    edge('e_R_1_start__R_elevA_L1', R.START, 'n_R_elevA_L1'),
    edge('e_R_elevA_L1__R_elevA_L2', 'n_R_elevA_L1', 'n_R_elevA_L2', { highway: 'elevator', level_from: 1, level_to: 2 }),
    edge('e_R_elevA_L2__R_2_wc', 'n_R_elevA_L2', R.UPSTAIRS),
  ]);
}

// ---- expressElevator: one elevator edge 1F → 7F (no stops in between) ----

export const EXPRESS = { HALL1: 'n_X_1_hall', HALL7: 'n_X_7_hall', EDGE: 'e_X_elevA_L1__X_elevA_L7' } as const;

export function expressElevator(): LoadedCampus {
  const X = EXPRESS;
  return campus([
    building('bldg_X', 'X동', 'X', [1, 7]),
    node(X.HALL1, [0, 0], { building_id: 'bldg_X', level: 1 }),
    node(X.HALL7, [0, 0], { building_id: 'bldg_X', level: 7 }),
    node('n_X_elevA_L1', [10, 0], { node_type: 'elevator_stop', shaft_id: 'X-EV1', building_id: 'bldg_X', level: 1 }),
    node('n_X_elevA_L7', [10, 0], { node_type: 'elevator_stop', shaft_id: 'X-EV1', building_id: 'bldg_X', level: 7 }),
    edge('e_X_1_hall__X_elevA_L1', X.HALL1, 'n_X_elevA_L1'),
    edge('e_X_7_hall__X_elevA_L7', X.HALL7, 'n_X_elevA_L7'),
    edge(X.EDGE, 'n_X_elevA_L1', 'n_X_elevA_L7', { highway: 'elevator', level_from: 1, level_to: 7 }),
  ]);
}

// ---- offsetEdge: an edge whose line does not end at its `to` node (data error, validation E4/I2) ----

export const OFFSET = { A: 'n_out_O1', B: 'n_out_O2', EDGE: 'e_out_O1__out_O2' } as const;

/** Nodes 100 m apart; the edge's line is only 1 m long and ends 99 m short of B. */
export function offsetEdge(): LoadedCampus {
  return campus([
    node(OFFSET.A, [0, 0], { node_type: 'outdoor' }),
    node(OFFSET.B, [100, 0], { node_type: 'outdoor' }),
    edge(OFFSET.EDGE, OFFSET.A, OFFSET.B, { highway: 'footway', edge_type: 'outdoor' }, { coords: [[0, 0], [1, 0]] }),
  ]);
}

// ---- random graphs (R4) ----

/** mulberry32: small seeded PRNG so the 200 graphs are the same on every run. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HIGHWAY_POOL = ['footway', 'footway', 'corridor', 'corridor', 'steps', 'ramp', 'elevator'] as const;

/**
 * Random walkable graph: 4–13 outdoor points in a 150 m square, n..3n edges of
 * mixed highway, random direction and step_free. Some lines bend (longer than
 * straight); about 1 in 10 non-elevator lines is deliberately too short (data
 * error) so the cost clamp in graph.ts is exercised too.
 */
export function randomCampus(seed: number): { campus: LoadedCampus; nodeIds: string[] } {
  const rnd = prng(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const n = 4 + int(10);
  const ids: string[] = [];
  const at: XY[] = [];
  const specs: Spec[] = [];
  for (let i = 0; i < n; i++) {
    const id = `n_out_${String(i).padStart(4, '0')}`;
    const p: XY = [rnd() * 150, rnd() * 150];
    ids.push(id);
    at.push(p);
    specs.push(node(id, p, { node_type: 'outdoor' }));
  }
  const m = n + int(2 * n + 1);
  for (let k = 0; k < m; k++) {
    const i = int(n);
    let j = int(n - 1);
    if (j >= i) j++;
    const highway = HIGHWAY_POOL[int(HIGHWAY_POOL.length)]!;
    const props: Props = {
      highway,
      edge_type: highway === 'elevator' ? 'indoor' : 'outdoor',
      bidirectional: rnd() < 0.7,
      step_free: highway === 'steps' ? false : rnd() < 0.7,
    };
    const roll = rnd();
    let geometry: EdgeGeometry = {};
    if (highway !== 'elevator' && roll < 0.1) {
      const a = at[i]!;
      geometry = { coords: [a, [a[0] + 1, a[1]]] };
    } else if (roll < 0.4) {
      geometry = { via: Array.from({ length: 1 + int(2) }, (): XY => [rnd() * 150, rnd() * 150]) };
    }
    specs.push(edge(`e_rand_${seed}_${k}`, ids[i]!, ids[j]!, props, geometry));
  }
  return { campus: campus(specs), nodeIds: ids };
}
