import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ELEVATOR_ALIGHT_SEC,
  ELEVATOR_BOARD_SEC,
  ELEVATOR_HOP_SEC,
  OUTDOOR_STAIRS_SEC_PER_M,
  PORTAL_SEC,
  WALK_SPEED_MPS,
  buildGraph,
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
const kinds = (r: Route) => r.steps.map((s) => s.kind);
const texts = (r: Route) => r.steps.map((s) => s.text);

describe('findRoute: gate → A동 4층 408호', () => {
  it('shortest climbs the outdoor stairs and enters at 4F', () => {
    const r = route(GATE, ROOM_408, 'shortest');
    expect(r.edgeIds).toEqual(['e_out_0001__out_0002', 'e_out_0002__out_0003', 'e_portal_A_4_north', 'e_A_4_north__A_4_408door']);
    expect(r.nodes).toEqual([GATE, 'n_out_0002', 'n_out_0003', 'n_A_4_north', ROOM_408]);
    expect(r.stairsCount).toBe(1);
    expect(kinds(r)).toEqual(['walk', 'stairs', 'portal', 'walk']);
    expect(texts(r)).toContain('A동 4층 출입구로 들어가세요');
  });

  it('step_free takes no stairs and still enters through the 4F portal', () => {
    const r = route(GATE, ROOM_408, 'step_free');
    expect(r.stairsCount).toBe(0);
    expect(r.edgeIds).not.toContain('e_out_0002__out_0003');
    expect(r.edgeIds).toContain('e_out_0004__out_0005'); // the ramp round the hill
    expect(r.edgeIds).toContain('e_portal_A_4_north');
    expect(r.edgeIds.some((id) => edgeOf(id).properties.highway === 'steps')).toBe(false);
    expect(kinds(r)).toEqual(['walk', 'ramp', 'walk', 'portal', 'walk']);
    expect(texts(r)).toContain('A동 4층 출입구로 들어가세요');
    expect(r.fallback).toBeNull();
  });

  it('reports distance, time and cost in seconds (SPEC-v0.2 3.1)', () => {
    const short = route(GATE, ROOM_408, 'shortest');
    const free = route(GATE, ROOM_408, 'step_free');
    expect(free.distanceM).toBeGreaterThan(short.distanceM);
    expect(free.timeSec).toBeGreaterThan(short.timeSec);
    // Outdoor stairs are priced by plan length only (2 s per metre; the edge's step_count of 24 is not used).
    // The rest is walking at 1.2 m/s, plus the portal.
    const stairs = short.steps.find((s) => s.kind === 'stairs')!;
    expect(stairs.timeSec).toBeCloseTo(stairs.distanceM * OUTDOOR_STAIRS_SEC_PER_M, 0);
    expect(short.timeSec).toBeCloseTo((short.distanceM - stairs.distanceM) / WALK_SPEED_MPS + stairs.timeSec + PORTAL_SEC, 0);
    expect(short.timeSec).toBeCloseTo(130.4, 1);
    // The steps add up to the total, and with no penalty on this route cost is the time.
    expect(short.steps.reduce((sum, s) => sum + s.timeSec, 0)).toBeCloseTo(short.timeSec, 0);
    expect(short.cost).toBe(short.timeSec);
    expect(free.cost).toBe(free.timeSec);
  });
});

describe('findRoute: gate → B동 2층 201호', () => {
  it('step_free rides the A동 elevator to 3F and crosses the bridge', () => {
    const r = route(GATE, ROOM_201, 'step_free');
    expect(r.edgeIds).toEqual(expect.arrayContaining(['e_portal_A_4_north', 'e_A_elevA_L3__A_elevA_L4', 'e_A_3_bridge__B_2_bridge']));
    expect(r.stairsCount).toBe(0);
    expect(kinds(r)).toEqual(['walk', 'ramp', 'walk', 'portal', 'walk', 'elevator', 'walk', 'bridge', 'walk']);
    expect(texts(r)).toEqual(expect.arrayContaining([
      'A동 4층 출입구로 들어가세요',
      '엘리베이터를 타고 3층으로 가세요',
      'A동 3층 연결통로를 건너 B동 2층으로 가세요',
    ]));
  });

  it('shortest goes in at B동 1층 and takes the stairs', () => {
    const r = route(GATE, ROOM_201, 'shortest');
    expect(r.stairsCount).toBe(1);
    expect(kinds(r)).toEqual(['walk', 'portal', 'walk', 'stairs', 'walk']);
    expect(texts(r)).toEqual(expect.arrayContaining(['B동 1층 출입구로 들어가세요', '계단으로 1층 올라가세요']));
  });
});

describe('findRoute: no route, fallback and one-way edges', () => {
  it('step_free to a place behind a sill falls back to fewest_steps and says what it could not avoid (R15)', () => {
    // v0.1 said "no route" here. B동 1층's only way in is the portal e_portal_B_1_main, step_free: false.
    const r = route(GATE, 'n_B_1_hall', 'step_free');
    expect(r.profile).toBe('step_free'); // what was asked for
    expect(r.fallback).toMatchObject({ profile: 'fewest_steps', stairsCount: 0, barrierCount: 1 });
    expect(r.fallback!.message).toContain('턱이 있는 구간 1곳');
    expect(r.edgeIds).toContain('e_portal_B_1_main');
    expect(findRoute(graph, GATE, 'n_B_1_hall', 'shortest')).toMatchObject({ found: true });
  });

  it('returns "no route" when closed doors leave no way at all', () => {
    // B동 is reached through its 1F portal, the A동 3F bridge, or the C동 bridge that ends in two steps; with all closed there is no way in.
    const until = '2026-12-31T00:00:00+09:00';
    const closed = buildGraph(campus, {
      now: new Date('2026-11-11T00:00:00+09:00'),
      overrides: [
        { feature_id: 'e_portal_B_1_main', status: 'closed', until, report_id: 'rp-1' },
        { feature_id: 'e_A_3_bridge__B_2_bridge', status: 'closed', until, report_id: 'rp-2' },
        { feature_id: 'e_C_5_east__B_2_steps', status: 'closed', until, report_id: 'rp-3' },
      ],
    });
    for (const profile of ['step_free', 'shortest'] as const) {
      expect(findRoute(closed, GATE, 'n_B_1_hall', profile)).toMatchObject({
        found: false,
        profile,
        reason: 'no-route',
        message: expect.stringContaining('경로가 없습니다'),
      });
    }
  });

  it('respects one-way edges', () => {
    const oneWay = structuredClone(campus);
    const portal = oneWay.features.map((f) => f.feature as AnyFeature).find((f) => f.id === 'e_portal_A_4_north');
    portal.properties.bidirectional = false; // n_A_4_north → n_out_0003 only: exit, no entry
    const g = buildGraph(oneWay);
    // No way in through the 4F door any more: step_free has to use the 1F portal (a sill), so it is a fallback.
    const inbound = route(GATE, ROOM_408, 'step_free', g);
    expect(inbound.edgeIds).not.toContain('e_portal_A_4_north');
    expect(inbound.fallback).toMatchObject({ profile: 'fewest_steps' });
    // Going out through it is still allowed, and stays a clean step-free route.
    const outbound = route(ROOM_408, GATE, 'step_free', g);
    expect(outbound.edgeIds).toContain('e_portal_A_4_north');
    expect(outbound.fallback).toBeNull();
  });

  it('returns unknown-node for ids that are not nodes', () => {
    expect(findRoute(graph, GATE, 'n_nowhere', 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
    expect(findRoute(graph, 'bldg_A', GATE, 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
  });
});

describe('elevator', () => {
  it('an elevator edge whose ends are not stops is left out of the graph and reported in graph.warnings', () => {
    expect(graph.warnings).toEqual([]);
    const bad = structuredClone(campus);
    const edge = bad.features.map((f) => f.feature).find((f) => f.id === 'e_A_elevA_L1__A_elevA_L2') as AnyFeature;
    edge.properties.from = 'n_A_1_hall';
    const g = buildGraph(bad);
    expect(g.warnings).toHaveLength(1);
    expect(g.warnings[0]).toContain('e_A_elevA_L1__A_elevA_L2');
    expect(g.warnings[0]).toContain('엘리베이터 도구로 다시 만드세요');
  });

  it('pays the boarding time once per ride, not once per floor', () => {
    const r = route('n_A_1_hall', 'n_A_4_hall', 'step_free');
    expect(kinds(r)).toEqual(['walk', 'elevator', 'walk']);
    expect(texts(r)).toContain('엘리베이터를 타고 4층으로 가세요');
    expect(r.edgeIds.filter((id) => id.startsWith('e_A_elevA_'))).toHaveLength(3);
    // board once, one hop per elevator edge, alight once: 40 + 3 × 4 + 3
    expect(r.timeSec).toBeCloseTo(r.distanceM / WALK_SPEED_MPS + ELEVATOR_BOARD_SEC + 3 * ELEVATOR_HOP_SEC + ELEVATOR_ALIGHT_SEC, 0);
    expect(r.cost).toBe(r.timeSec);
  });
});

describe('routing never compares floor numbers (AGENTS.md)', () => {
  const pairs: [string, string][] = [
    [GATE, ROOM_408], [GATE, ROOM_201], [ROOM_201, GATE], [GATE, 'n_B_1_hall'],
    ['n_A_1_hall', 'n_A_4_hall'], [ROOM_408, ROOM_201], ['n_B_1_main', 'n_A_1_main'],
  ];

  /** Everything except the steps' display text and floor names, which print floor numbers for people to read. */
  const comparable = (r: RouteResult) => {
    if (!r.found) return r;
    const { steps, ...rest } = r;
    return { ...rest, stepKinds: steps.map((s) => s.kind), stepTimes: steps.map((s) => s.timeSec) };
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
