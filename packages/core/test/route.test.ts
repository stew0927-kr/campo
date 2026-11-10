import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ELEVATOR_BOARDING_COST,
  ELEVATOR_FLOOR_COST,
  ELEVATOR_FLOOR_S,
  ELEVATOR_WAIT_S,
  WALKING_SPEED_M_PER_S,
  buildGraph,
  elevatorFloors,
  findRoute,
  type CampusGraph,
  type LoadedCampus,
  type Profile,
  type Route,
  type RouteResult,
} from '../src/index.ts';
import { loadCampus } from '../src/node/index.ts';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/campus-basic', import.meta.url));
const GATE = 'n_out_0001'; // 정문 (poi), at the foot of the hill
const ROOM_408 = 'n_A_4_408door';
const ROOM_201 = 'n_B_2_201door';

let campus: LoadedCampus;
let graph: CampusGraph;
beforeAll(async () => {
  campus = await loadCampus(FIXTURE_DIR);
  graph = buildGraph(campus);
});

function route(from: string, to: string, profile: Profile, g = graph): Route {
  const result = findRoute(g, from, to, profile);
  if (!result.found) throw new Error(`expected a route ${from} → ${to} (${profile}): ${result.message}`);
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFeature = any;
const edgeOf = (id: string): AnyFeature => campus.features.map((f) => f.feature as AnyFeature).find((f) => f.id === id);

describe('findRoute: gate → A동 4층 408호', () => {
  it('shortest climbs the outdoor stairs and enters at 4F', () => {
    const r = route(GATE, ROOM_408, 'shortest');
    expect(r.edgeIds).toEqual(['e_out_0001__out_0002', 'e_out_0002__out_0003', 'e_portal_A_4_north', 'e_A_4_north__A_4_408door']);
    expect(r.nodeIds).toEqual([GATE, 'n_out_0002', 'n_out_0003', 'n_A_4_north', ROOM_408]);
    expect(r.stairCount).toBe(1);
    expect(r.floorChanges).toEqual(['바깥 → A동 4층 출입구']);
  });

  it('step_free takes no stairs and still enters through the 4F portal', () => {
    const r = route(GATE, ROOM_408, 'step_free');
    expect(r.stairCount).toBe(0);
    expect(r.edgeIds).not.toContain('e_out_0002__out_0003');
    expect(r.edgeIds).toContain('e_out_0004__out_0005'); // the ramp round the hill
    expect(r.edgeIds).toContain('e_portal_A_4_north');
    expect(r.edgeIds.some((id) => edgeOf(id).properties.highway === 'steps')).toBe(false);
    expect(r.floorChanges).toEqual(['바깥 → A동 4층 출입구']);
  });

  it('reports distance, time and cost consistent with SPEC §6', () => {
    const short = route(GATE, ROOM_408, 'shortest');
    const free = route(GATE, ROOM_408, 'step_free');
    expect(free.distanceM).toBeGreaterThan(short.distanceM);
    expect(free.cost).toBeGreaterThan(short.cost);
    // No elevator on either route: time is just walking at 1.2 m/s.
    expect(short.durationMin).toBeCloseTo(short.distanceM / WALKING_SPEED_M_PER_S / 60, 1);
    // Steps cost length × 1.5 + 15, portal adds 2.
    expect(short.cost).toBeGreaterThan(short.distanceM + 15 + 2);
  });
});

describe('findRoute: gate → B동 2층 201호', () => {
  it('step_free rides the A동 elevator to 3F and crosses the bridge', () => {
    const r = route(GATE, ROOM_201, 'step_free');
    expect(r.edgeIds).toEqual(expect.arrayContaining(['e_portal_A_4_north', 'e_A_elevA_L3__A_elevA_L4', 'e_A_3_bridge__B_2_bridge']));
    expect(r.stairCount).toBe(0);
    expect(r.floorChanges).toEqual([
      '바깥 → A동 4층 출입구',
      'A동 4층 → 엘리베이터 → 3층',
      'A동 3층 → 연결통로 → B동 2층',
    ]);
  });

  it('shortest goes in at B동 1층 and takes the stairs', () => {
    const r = route(GATE, ROOM_201, 'shortest');
    expect(r.stairCount).toBe(1);
    expect(r.floorChanges).toEqual(['바깥 → B동 1층 출입구', 'B동 1층 → 계단 → 2층']);
  });
});

describe('findRoute: no route', () => {
  it('step_free to a place reachable only by stairs returns "no route"', () => {
    const result = findRoute(graph, GATE, 'n_B_1_hall', 'step_free');
    expect(result).toEqual({
      found: false,
      profile: 'step_free',
      reason: 'no-route',
      message: expect.stringContaining('계단 없는 경로가 없습니다'),
    });
    expect(findRoute(graph, GATE, 'n_B_1_hall', 'shortest').found).toBe(true);
  });

  it('respects one-way edges', () => {
    const oneWay = structuredClone(campus);
    const portal = oneWay.features.map((f) => f.feature as AnyFeature).find((f) => f.id === 'e_portal_A_4_north');
    portal.properties.bidirectional = false; // n_A_4_north → n_out_0003 only: exit, no entry
    const g = buildGraph(oneWay);
    expect(findRoute(g, GATE, ROOM_408, 'step_free').found).toBe(false);
    expect(findRoute(g, ROOM_408, GATE, 'step_free').found).toBe(true);
  });

  it('returns unknown-node for ids that are not nodes', () => {
    expect(findRoute(graph, GATE, 'n_nowhere', 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
    expect(findRoute(graph, 'bldg_A', GATE, 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
  });
});

describe('elevator', () => {
  it('pays the boarding cost and the wait once per ride, not once per floor', () => {
    const r = route('n_A_1_hall', 'n_A_4_hall', 'step_free');
    expect(r.floorChanges).toEqual(['A동 1층 → 엘리베이터 → 4층']);
    expect(r.edgeIds.filter((id) => id.startsWith('e_A_elevA_'))).toHaveLength(3);
    expect(r.cost).toBeCloseTo(r.distanceM + ELEVATOR_BOARDING_COST + 3 * ELEVATOR_FLOOR_COST, 0);
    expect(r.durationMin).toBeCloseTo((r.distanceM / WALKING_SPEED_M_PER_S + ELEVATOR_WAIT_S + 3 * ELEVATOR_FLOOR_S) / 60, 1);
  });

  it('counts floors without a floor 0', () => {
    expect(elevatorFloors({ level_from: 1, level_to: 3 })).toBe(2);
    expect(elevatorFloors({ level_from: -1, level_to: 1 })).toBe(1);
    expect(elevatorFloors({ level_from: 2, level_to: -2 })).toBe(3);
    expect(elevatorFloors({})).toBe(1);
  });
});

describe('routing never compares floor numbers (AGENTS.md)', () => {
  const pairs: [string, string][] = [
    [GATE, ROOM_408], [GATE, ROOM_201], [ROOM_201, GATE], [GATE, 'n_B_1_hall'],
    ['n_A_1_hall', 'n_A_4_hall'], [ROOM_408, ROOM_201], ['n_B_1_main', 'n_A_1_main'],
  ];

  /** Everything except floorChanges, which prints floor numbers for people to read. */
  const comparable = (r: RouteResult) => {
    if (!r.found) return r;
    const { floorChanges: _ignored, ...rest } = r;
    return rest;
  };

  it('gives the same routes after every level value is deleted from the data', () => {
    const stripped = structuredClone(campus);
    let removed = 0;
    for (const { feature } of stripped.features) {
      const p = (feature as AnyFeature).properties;
      for (const key of ['level', 'level_from', 'level_to', 'levels', 'ground_levels']) {
        if (key in p) {
          delete p[key];
          removed++;
        }
      }
    }
    expect(removed).toBeGreaterThan(0);
    const nodes = stripped.features.map((f) => f.feature as AnyFeature).filter((f) => f.properties.kind === 'node');
    expect(nodes.every((n) => !('level' in n.properties))).toBe(true);
    const blind = buildGraph(stripped);

    for (const [from, to] of pairs) {
      for (const profile of ['shortest', 'step_free'] as const) {
        expect(comparable(findRoute(blind, from, to, profile)), `${from} → ${to} ${profile}`)
          .toEqual(comparable(findRoute(graph, from, to, profile)));
      }
    }
  });

  it('keeps level out of the graph and search code', async () => {
    for (const file of ['graph.ts', 'route.ts']) {
      const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
      const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/level/i);
    }
  });
});
