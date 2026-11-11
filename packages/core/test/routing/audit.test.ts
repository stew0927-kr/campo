// v0.1 routing audit against the checklist in SPEC-v0.2 3.7 (R1~R16) and the
// extra defects found while reading the code (R17~). Nothing in src/ is changed.
//
// - plain `it`      : v0.1 already does what v0.2 requires.
// - `it.fails`      : v0.1 is wrong; the body asserts the v0.2 expectation, so it
//                     fails today (and vitest reports it as an expected failure).
//                     When v0.2 fixes it, the test starts passing and `it.fails`
//                     turns red: flip it to `it` then.
// v0.2-only APIs (timeSec, findNearest, fewest_steps, overrides) do not exist yet,
// so they are reached through `any`; the call shape may change in v0.2, the
// expectation should not.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aStar } from 'ngraph.path';
import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.ts';
import {
  ELEVATOR_BOARDING_COST,
  ELEVATOR_FLOOR_COST,
  ELEVATOR_FLOOR_S,
  buildGraph,
  carId,
  findRoute,
  type CampusGraph,
  type GraphLinkData,
  type GraphNodeData,
  type LoadedCampus,
  type Profile,
  type Route,
  type RouteResult,
} from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';
import {
  BRIDGE,
  EXPRESS,
  NULL_CORRIDOR,
  OFFSET,
  ONE_WAY,
  PARALLEL,
  RESTROOMS,
  TOWER,
  TRIANGLE,
  bridgeOffset,
  expressElevator,
  nullCorridor,
  offsetEdge,
  oneWay,
  parallelStairsRamp,
  pos,
  prng,
  randomCampus,
  restrooms,
  stripLevels,
  tower7,
  triangle,
} from './fixtures/audit.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const PROFILES_V01: Profile[] = ['shortest', 'step_free'];

function route(g: CampusGraph, from: string, to: string, profile: Profile): Route {
  const r = findRoute(g, from, to, profile);
  if (!r.found) throw new Error(`expected a route ${from} → ${to} (${profile}): ${r.message}`);
  return r;
}

/** The raw ngraph.path aStar result (target → source order), configured like route.ts. */
function rawFind(g: CampusGraph, from: string, to: string, profile: Profile): string[] {
  const finder = aStar<GraphNodeData, GraphLinkData>(g.graph, {
    oriented: true,
    distance: (_a, _b, link) => link.data.cost[profile],
    blocked: (_a, _b, link) => link.data.cost[profile] === Infinity,
  });
  return finder.find(from, to).map((n) => String(n.id));
}

/** Plain Dijkstra over the graph links, independent of ngraph.path. Infinity when unreachable. */
function dijkstraCost(g: CampusGraph, from: string, to: string, profile: Profile): number {
  const dist = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();
  for (;;) {
    let best: string | undefined;
    let bestD = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    if (best === undefined) return Infinity;
    if (best === to) return bestD;
    done.add(best);
    for (const link of g.graph.getLinks(best) ?? []) {
      if (String(link.fromId) !== best) continue;
      const c = link.data.cost[profile];
      if (c === Infinity) continue;
      const id = String(link.toId);
      if (bestD + c < (dist.get(id) ?? Infinity)) dist.set(id, bestD + c);
    }
  }
}

/** Everything except floorChanges, which prints floor numbers for people to read. */
function comparable(r: RouteResult) {
  if (!r.found) return r;
  const { floorChanges: _ignored, ...rest } = r;
  return rest;
}

/** Sentences of a route, wherever v0.1 (floorChanges) or v0.2 (instructions) puts them. */
function sentences(r: RouteResult): string[] {
  const any = r as Any;
  return [...(any.floorChanges ?? []), ...(any.instructions ?? [])].map((s: unknown) => (typeof s === 'string' ? s : JSON.stringify(s)));
}

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

describe('v0.1 routing audit (SPEC-v0.2 3.7)', () => {
  // ---- R1 ----
  it('R1: elevator wait is paid once per ride (1→7 minus 1→2 is five floors of riding)', () => {
    const g = buildGraph(tower7());
    // step_free so 1→2 cannot take the stairs; halls and stops share positions on every floor,
    // so the walking part of both routes is identical and cancels out.
    const up6 = route(g, TOWER.hall(1), TOWER.hall(7), 'step_free');
    const up1 = route(g, TOWER.hall(1), TOWER.hall(2), 'step_free');
    expect(up6.distanceM).toBe(up1.distanceM);
    expect(up6.cost - up1.cost).toBeCloseTo(5 * ELEVATOR_FLOOR_COST, 6);
    // durationMin is rounded to 0.1 min, so each value can be off by 3 s: ±6 s on the difference.
    const diffSec = (up6.durationMin - up1.durationMin) * 60;
    expect(Math.abs(diffSec - 5 * ELEVATOR_FLOOR_S)).toBeLessThanOrEqual(6 + 1e-9);
  });

  // ---- R2 ----
  it('R2: a one-way edge is not walked backwards', () => {
    const g = buildGraph(oneWay());
    expect(route(g, ONE_WAY.A, ONE_WAY.B, 'shortest').edgeIds).toEqual([ONE_WAY.EDGE]);
    for (const profile of PROFILES_V01) {
      expect(findRoute(g, ONE_WAY.B, ONE_WAY.A, profile)).toMatchObject({ found: false, reason: 'no-route' });
    }
  });

  // ---- R3 ----
  it('R3: parallel steps + ramp between the same two points both survive', () => {
    const g = buildGraph(parallelStairsRamp());
    const pq = [...(g.graph.getLinks(PARALLEL.P) ?? [])].filter((l) => l.fromId === PARALLEL.P && l.toId === PARALLEL.Q);
    expect(pq.map((l) => (l.data as Any).edge.id).sort()).toEqual([PARALLEL.RAMP, PARALLEL.STEPS].sort());
    expect(route(g, PARALLEL.P, PARALLEL.Q, 'shortest').edgeIds).toEqual([PARALLEL.STEPS]);
    expect(route(g, PARALLEL.P, PARALLEL.Q, 'step_free').edgeIds).toEqual([PARALLEL.RAMP]);
    expect(route(g, PARALLEL.Q, PARALLEL.P, 'step_free').edgeIds).toEqual([PARALLEL.RAMP]);
  });

  // ---- R4 ----
  it('R4: A* cost equals Dijkstra cost on 200 seeded random graphs', () => {
    let compared = 0;
    let reachable = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { campus, nodeIds } = randomCampus(seed);
      const g = buildGraph(campus);
      const rnd = prng(seed * 7919);
      for (let k = 0; k < 5; k++) {
        const from = nodeIds[Math.floor(rnd() * nodeIds.length)]!;
        const to = nodeIds[Math.floor(rnd() * nodeIds.length)]!;
        for (const profile of PROFILES_V01) {
          const r = findRoute(g, from, to, profile);
          const d = dijkstraCost(g, from, to, profile);
          const label = `seed ${seed} ${from} → ${to} ${profile}`;
          if (d === Infinity) {
            expect(r.found, label).toBe(false);
          } else {
            expect(r.found, label).toBe(true);
            // Route.cost is rounded to 0.1.
            expect(Math.abs((r as Route).cost - d), label).toBeLessThanOrEqual(0.05 + 1e-9);
            reachable++;
          }
          compared++;
        }
      }
    }
    expect(compared).toBe(2000);
    expect(reachable).toBeGreaterThan(500);
  });

  // ---- R5 ----
  it('R5: route nodes run from start to end', () => {
    const g = buildGraph(tower7());
    const r = route(g, TOWER.hall(1), TOWER.hall(7), 'step_free');
    expect(r.nodeIds[0]).toBe(TOWER.hall(1));
    expect(r.nodeIds.at(-1)).toBe(TOWER.hall(7));
    expect(r.edgeIds[0]).toBe(TOWER.hallToStop(1));
    expect(r.edgeIds.at(-1)).toBe(TOWER.hallToStop(7));
    expect(route(buildGraph(oneWay()), ONE_WAY.A, ONE_WAY.B, 'shortest').nodeIds).toEqual([ONE_WAY.A, ONE_WAY.B]);
  });

  // ---- R6 ----
  it.fails('R6: one unit, seconds: elevator 1→7 has timeSec 67 (40 + 6×4 + 3) and cost in the same unit', () => {
    const g = buildGraph(tower7());
    const r = route(g, TOWER.stop(1), TOWER.stop(7), 'shortest') as Any;
    expect(typeof r.timeSec).toBe('number');
    expect(r.timeSec).toBeCloseTo(67, 0);
    // shortest has no preference penalties here, so cost and time must agree.
    expect(r.cost).toBeCloseTo(r.timeSec, 0);
  });

  it.fails('R6: timeSec does not include the step_free penalty (cost − timeSec = 60 s for one unknown corridor)', () => {
    const g = buildGraph(nullCorridor());
    const r = findRoute(g, NULL_CORRIDOR.OUT, NULL_CORRIDOR.ROOM_NULL, 'step_free') as Any;
    expect(r.found).toBe(true);
    // SPEC-v0.2 3.1: walking at WALK_SPEED_MPS 1.2 plus PORTAL_SEC 2; UNKNOWN_STEP_FREE_PENALTY_SEC 60 only in cost.
    expect(r.timeSec).toBeCloseTo(r.distanceM / 1.2 + 2, 0);
    expect(r.cost - r.timeSec).toBeCloseTo(60, 0);
  });

  // ---- R7 ----
  it.fails('R7: step_free: null indoor corridor does not block the step_free route', () => {
    const g = buildGraph(nullCorridor());
    const r = findRoute(g, NULL_CORRIDOR.OUT, NULL_CORRIDOR.ROOM_NULL, 'step_free');
    expect(r.found).toBe(true);
    expect((r as Route).edgeIds).toContain(NULL_CORRIDOR.EDGE_NULL);
  });

  it.fails('R7: indoor corridor without a step_free value does not block the step_free route', () => {
    const g = buildGraph(nullCorridor());
    const r = findRoute(g, NULL_CORRIDOR.OUT, NULL_CORRIDOR.ROOM_MISSING, 'step_free');
    expect(r.found).toBe(true);
    expect((r as Route).edgeIds).toContain(NULL_CORRIDOR.EDGE_MISSING);
  });

  // ---- R8 ----
  it.fails('R8: an elevator marked broken in overrides is blocked in both profiles', () => {
    const overrides = [
      ...[1, 2, 3, 4, 5, 6].map((l) => ({ feature_id: TOWER.elevatorEdge(l), status: 'out_of_service', until: '2099-01-01T00:00:00Z', report_id: 'r_audit_1' })),
      { feature_id: TOWER.ELEVATOR_ID, status: 'out_of_service', until: '2099-01-01T00:00:00Z', report_id: 'r_audit_1' },
    ];
    // Passed both to buildGraph and findRoute: v0.2 decides where overrides are merged.
    const g = (buildGraph as Any)(tower7(), { overrides });
    const find = (profile: string) => (findRoute as Any)(g, TOWER.hall(1), TOWER.hall(7), profile, { overrides });
    const shortest = find('shortest');
    expect(shortest.found).toBe(true);
    expect(shortest.edgeIds.some((id: string) => id.startsWith('e_T_elevA_'))).toBe(false);
    expect(shortest.stairCount).toBe(6);
    expect(find('step_free').found).toBe(false);
  });

  // ---- R9 ----
  it('R9: a multi-floor ride stays in the car (no alight and re-board on the way)', () => {
    const g = buildGraph(tower7());
    const ride = [1, 2, 3, 4, 5, 6].map(TOWER.elevatorEdge);
    for (const profile of PROFILES_V01) {
      const r = route(g, TOWER.hall(1), TOWER.hall(7), profile);
      expect(r.edgeIds, profile).toEqual([TOWER.hallToStop(1), ...ride, TOWER.hallToStop(7)]);
      expect(new Set(r.nodeIds).size, profile).toBe(r.nodeIds.length);
    }
    // Each stop has exactly one board link (stop → car), so getting off and back on pays the wait again.
    const boards = [...(g.graph.getLinks(TOWER.stop(4)) ?? [])].filter((l) => l.data.kind === 'board');
    expect(boards).toHaveLength(1);
    expect(boards[0]!.toId).toBe(carId(TOWER.stop(4)));
  });

  // ---- R10 ----
  it('R10: tower7 and bridgeOffset give the same routes after every level value is deleted', () => {
    const cases: [LoadedCampus, [string, string][]][] = [
      [tower7(), [[TOWER.hall(1), TOWER.hall(7)], [TOWER.hall(7), TOWER.hall(1)], [TOWER.hall(1), TOWER.hall(2)], [TOWER.stop(1), TOWER.stop(7)], [TOWER.landing(1), TOWER.landing(4)]]],
      [tower7({ elevator: false }), [[TOWER.hall(1), TOWER.hall(4)], [TOWER.hall(6), TOWER.hall(2)]]],
      [bridgeOffset(), [[BRIDGE.A_HALL, BRIDGE.C_HALL], [BRIDGE.C_HALL, BRIDGE.A_HALL]]],
      [bridgeOffset({ stairsAtEnd: true }), [[BRIDGE.A_HALL, BRIDGE.C_HALL], [BRIDGE.C_HALL, BRIDGE.A_HALL]]],
    ];
    for (const [campus, pairs] of cases) {
      const { campus: blindCampus, removed } = stripLevels(campus);
      expect(removed).toBeGreaterThan(0);
      const seeing = buildGraph(campus);
      const blind = buildGraph(blindCampus);
      for (const [from, to] of pairs) {
        for (const profile of PROFILES_V01) {
          expect(comparable(findRoute(blind, from, to, profile)), `${from} → ${to} ${profile}`)
            .toEqual(comparable(findRoute(seeing, from, to, profile)));
        }
      }
    }
  });

  // ---- R11 ----
  it('R11: same start and end gives a zero route; unknown ids give unknown-node', () => {
    const g = buildGraph(tower7());
    for (const profile of PROFILES_V01) {
      expect(findRoute(g, TOWER.hall(3), TOWER.hall(3), profile)).toMatchObject({
        found: true, nodeIds: [TOWER.hall(3)], edgeIds: [], cost: 0, distanceM: 0, durationMin: 0, stairCount: 0,
      });
    }
    const missing = findRoute(g, 'n_nowhere', TOWER.hall(1), 'shortest');
    expect(missing).toMatchObject({ found: false, reason: 'unknown-node' });
    expect((missing as Any).message).toContain('n_nowhere');
    expect(findRoute(g, TOWER.hall(1), 'n_nowhere', 'step_free')).toMatchObject({ found: false, reason: 'unknown-node' });
    // Graph-only ids (the virtual elevator car) are not campus nodes either.
    expect(findRoute(g, carId(TOWER.stop(1)), TOWER.hall(1), 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
  });

  // ---- R12 ----
  it.fails('R12: findNearest picks the restroom with the lowest travel cost, not the straight-line nearest', () => {
    const findNearest = (core as Any).findNearest;
    expect(typeof findNearest).toBe('function');
    const g = buildGraph(restrooms());
    const isRestroom = (n: Any) => (n?.properties ?? n)?.node_type === 'restroom';
    for (const profile of PROFILES_V01) {
      const r = findNearest(g, RESTROOMS.START, isRestroom, profile);
      expect(r.found).toBe(true);
      expect(r.nodeIds.at(-1)).toBe(RESTROOMS.SAME_FLOOR);
    }
  });

  // ---- R13 ----
  it('R13: a target reached only through blocked links is "no route", not the [target] array ngraph returns', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }));
    expect(rawFind(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free')).toEqual([BRIDGE.C_HALL]);
    expect(findRoute(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free')).toMatchObject({ found: false, reason: 'no-route' });
  });

  it('R13: the v0.1 "no route" test really hits the [target] case (campus-basic GATE → n_B_1_hall)', async () => {
    const basic = await loadCampus(fileURLToPath(new URL('../fixtures/campus-basic', import.meta.url)));
    const g = buildGraph(basic);
    // ngraph alone answers with a one-element "path"; route.ts:64 is what turns it into no-route.
    expect(rawFind(g, 'n_out_0001', 'n_B_1_hall', 'step_free')).toEqual(['n_B_1_hall']);
    expect(findRoute(g, 'n_out_0001', 'n_B_1_hall', 'step_free')).toMatchObject({ found: false, reason: 'no-route' });
  });

  // ---- R14 ----
  it('R14: direction-dependent costs are read per link (from → to), not swapped', () => {
    const g = buildGraph(triangle());
    // Make A→B expensive in this direction only; B→A stays 30 m.
    for (const link of g.graph.getLinks(TRIANGLE.A) ?? []) {
      if (link.fromId === TRIANGLE.A && link.toId === TRIANGLE.B) {
        link.data.cost.shortest = 1000;
        link.data.cost.step_free = 1000;
      }
    }
    for (const profile of PROFILES_V01) {
      expect(route(g, TRIANGLE.A, TRIANGLE.B, profile).nodeIds, profile).toEqual([TRIANGLE.A, TRIANGLE.C, TRIANGLE.B]);
      const back = route(g, TRIANGLE.B, TRIANGLE.A, profile);
      expect(back.nodeIds, profile).toEqual([TRIANGLE.B, TRIANGLE.A]);
      expect(back.cost, profile).toBeLessThan(31);
    }
    // board (stop → car) carries the wait, alight (car → stop) does not.
    const t = buildGraph(tower7());
    const stop = TOWER.stop(1);
    const links = [...(t.graph.getLinks(stop) ?? [])];
    expect(links.find((l) => l.fromId === stop && l.toId === carId(stop))!.data).toMatchObject({ kind: 'board', cost: { shortest: ELEVATOR_BOARDING_COST } });
    expect(links.find((l) => l.fromId === carId(stop) && l.toId === stop)!.data).toMatchObject({ kind: 'alight', cost: { shortest: 0 } });
    expect(route(t, TOWER.stop(1), TOWER.stop(2), 'shortest').cost).toBeCloseTo(ELEVATOR_BOARDING_COST + ELEVATOR_FLOOR_COST, 6);
    expect(route(t, TOWER.stop(2), TOWER.stop(1), 'shortest').cost).toBeCloseTo(ELEVATOR_BOARDING_COST + ELEVATOR_FLOOR_COST, 6);
  });

  // ---- R15 ----
  it.fails('R15: fewest_steps profile finds the route and counts the unavoidable steps (600 s penalty in cost only)', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }));
    const r = findRoute(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'fewest_steps' as Any) as Any;
    expect(r.found).toBe(true);
    expect(r.stairCount).toBe(1);
    expect(Number.isFinite(r.cost)).toBe(true);
    expect(r.cost - r.timeSec).toBeCloseTo(600, 0);
  });

  it.fails('R15: step_free with no route falls back to fewest_steps and says how many steps cannot be avoided', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }));
    const r = findRoute(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free') as Any;
    const text = JSON.stringify(r);
    expect(text).toContain('fewest_steps');
    expect(text).toContain('계단 1곳을 피할 수 없습니다');
  });

  // ---- R16 ----
  it('R16: routing uses a bridge between floors with different numbers (A동 3층 ↔ C동 5층)', () => {
    const g = buildGraph(bridgeOffset());
    for (const profile of PROFILES_V01) {
      expect(route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, profile).edgeIds, profile).toContain(BRIDGE.EDGE);
      expect(route(g, BRIDGE.C_HALL, BRIDGE.A_HALL, profile).edgeIds, profile).toContain(BRIDGE.EDGE);
    }
  });

  it('R16: a bridge that ends in steps is blocked for step_free and still used by shortest', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }));
    expect(findRoute(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free')).toMatchObject({ found: false, reason: 'no-route' });
    const r = route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'shortest');
    expect(r.edgeIds).toEqual(expect.arrayContaining([BRIDGE.EDGE, BRIDGE.C_END_EDGE]));
    expect(r.stairCount).toBe(1);
  });

  it.fails('R16: bridge sentence reads "A동 3층 연결통로를 건너 C동 5층으로" (문장)', () => {
    const g = buildGraph(bridgeOffset());
    const r = route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free');
    expect(sentences(r).some((s) => s.includes('A동 3층 연결통로를 건너 C동 5층으로'))).toBe(true);
  });

  // ---- R17 (outside the checklist) ----
  it.fails('R17: express elevator cost unchanged when levels are stripped', () => {
    const seeing = buildGraph(expressElevator());
    const blind = buildGraph(stripLevels(expressElevator()).campus);
    for (const profile of PROFILES_V01) {
      expect(comparable(findRoute(blind, EXPRESS.HALL1, EXPRESS.HALL7, profile)), profile)
        .toEqual(comparable(findRoute(seeing, EXPRESS.HALL1, EXPRESS.HALL7, profile)));
    }
  });

  it.fails('R17: no level reads in routing source (graph.ts, route.ts, costs.ts, src/routing/**; route-text.ts exempt)', () => {
    // route-text.ts prints floor names for people (SPEC-v0.2 3.6) and is the only exemption.
    const EXEMPT = new Set(['route-text.ts']);
    const files = ['graph.ts', 'route.ts', 'costs.ts'].map((f) => join(SRC_DIR, f)).filter((f) => existsSync(f));
    const routingDir = join(SRC_DIR, 'routing');
    if (existsSync(routingDir)) {
      for (const f of readdirSync(routingDir, { recursive: true, encoding: 'utf8' })) {
        if (f.endsWith('.ts')) files.push(join(routingDir, f));
      }
    }
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (EXEMPT.has(file.split(/[\\/]/).at(-1)!)) continue;
      const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/level/i);
    }
  });

  // ---- R18 (outside the checklist): stair sentences, SPEC-v0.2 3.6 ----
  it.fails('R18: stairs are not merged across a landing where a corridor branches off (갈림)', () => {
    // tower7: every landing joins its floor's hall, so 1F → 4F is three separate flights.
    const g = buildGraph(tower7({ elevator: false }));
    const r = route(g, TOWER.hall(1), TOWER.hall(4), 'shortest');
    expect(r.stairCount).toBe(3);
    expect(sentences(r).filter((s) => s.includes('계단'))).toHaveLength(3);
  });

  it.fails('R18: merged stairs use the direction word from incline, read against travel direction (방향어)', () => {
    // Only floors 1 and 7 join the stairwell, so 1F → 7F is one uninterrupted climb.
    const g = buildGraph(tower7({ elevator: false, stairBranches: false }));
    expect(sentences(route(g, TOWER.hall(1), TOWER.hall(7), 'shortest'))).toContain('계단으로 6층 올라가세요');
    expect(sentences(route(g, TOWER.hall(7), TOWER.hall(1), 'shortest'))).toContain('계단으로 6층 내려가세요');
  });

  // ---- R19 (outside the checklist) ----
  it.fails('R19: a ramp marked step_free: false (has a step or sill) is blocked for step_free', () => {
    const g = buildGraph(parallelStairsRamp({ rampStepFree: false }));
    expect(findRoute(g, PARALLEL.P, PARALLEL.Q, 'step_free')).toMatchObject({ found: false, reason: 'no-route' });
  });

  // ---- R20 (outside the checklist) ----
  it.fails('R20: an edge whose line does not reach its nodes is reported or left out, not silently priced by the clamp', () => {
    let threw = false;
    let g: CampusGraph | undefined;
    try {
      g = buildGraph(offsetEdge());
    } catch {
      threw = true;
    }
    if (threw) return;
    const issues = JSON.stringify((g as Any).issues ?? (g as Any).errors ?? (g as Any).warnings ?? []);
    const reported = issues.includes(OFFSET.EDGE);
    const used = [...(g!.graph.getLinks(OFFSET.A) ?? [])].some((l) => (l.data as Any).edge?.id === OFFSET.EDGE);
    expect(reported || !used).toBe(true);
  });

  // ---- R21 (outside the checklist) ----
  it.fails('R21: an unknown profile name is rejected instead of returning a route with NaN cost', () => {
    const g = buildGraph(oneWay());
    let threw = false;
    let r: RouteResult | undefined;
    try {
      r = findRoute(g, ONE_WAY.A, ONE_WAY.B, 'wheelchair' as Any);
    } catch {
      threw = true;
    }
    expect(threw || r?.found === false).toBe(true);
  });
});

// Not checklist items: these only prove the fixtures model what the R tests assume.
describe('audit fixtures', () => {
  it('tower7 has 6 elevator edges and 6 stair edges, one per neighbouring floor pair', () => {
    const edges = tower7().features.map((f) => f.feature as Any).filter((f) => f.properties.kind === 'edge');
    expect(edges.filter((e) => e.properties.highway === 'elevator')).toHaveLength(6);
    expect(edges.filter((e) => e.properties.highway === 'steps')).toHaveLength(6);
  });

  it('restrooms: the upstairs restroom is nearer in a straight line but costs more to reach', () => {
    const c = restrooms();
    const at = (id: string) => (c.features.map((f) => f.feature as Any).find((f) => f.id === id)).geometry.coordinates;
    const g = buildGraph(c);
    const straightTo = (id: string) => {
      const [a, b] = [at(RESTROOMS.START), at(id)];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    expect(straightTo(RESTROOMS.UPSTAIRS)).toBeLessThan(straightTo(RESTROOMS.SAME_FLOOR));
    for (const profile of PROFILES_V01) {
      expect(route(g, RESTROOMS.START, RESTROOMS.SAME_FLOOR, profile).cost)
        .toBeLessThan(route(g, RESTROOMS.START, RESTROOMS.UPSTAIRS, profile).cost);
    }
  });

  it('offsetEdge: the edge line ends 99 m short of its to-node', () => {
    const e = offsetEdge().features.map((f) => f.feature as Any).find((f) => f.id === OFFSET.EDGE);
    expect(e.geometry.coordinates.at(-1)).toEqual(pos([1, 0]));
    expect(e.geometry.coordinates.at(-1)).not.toEqual(pos([100, 0]));
  });

  it('nullCorridor: one corridor has step_free null, another has no step_free key', () => {
    const edges = nullCorridor().features.map((f) => f.feature as Any);
    expect(edges.find((f) => f.id === NULL_CORRIDOR.EDGE_NULL).properties.step_free).toBeNull();
    expect('step_free' in edges.find((f) => f.id === NULL_CORRIDOR.EDGE_MISSING).properties).toBe(false);
  });
});
