// Routing checklist (SPEC-v0.2 3.7, R1~R16) and the extra defects found in the
// v0.1 audit (R17~R21, docs/v0.2/audit-routing.md). Every item is a plain `it`
// that asserts the v0.2 behaviour.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aStar } from 'ngraph.path';
import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.ts';
import {
  ELEVATOR_ALIGHT_SEC,
  ELEVATOR_BOARD_SEC,
  ELEVATOR_HOP_SEC,
  DOWNHILL_STAIRS_FACTOR,
  FEWEST_STEPS_STAIRS_PENALTY_SEC,
  FLIGHT_SEC_MAX,
  FLIGHT_SEC_MIN,
  FLOOR_FLIGHT_SEC,
  OUTDOOR_STAIRS_MIN_SEC,
  OUTDOOR_STAIRS_SEC_PER_M,
  PORTAL_SEC,
  PROFILES,
  RAMP_FACTOR,
  STEP_SEC,
  stairsTimeSec,
  straight,
  UNKNOWN_STEP_FREE_PENALTY_SEC,
  WALK_SPEED_MPS,
  buildGraph,
  carId,
  findNearest,
  findRoute,
  isStepFreePassable,
  validateCampus,
  type CampusGraph,
  type GraphLinkData,
  type GraphNodeData,
  type LoadedCampus,
  type NodeFeature,
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
  override,
  parallelStairsRamp,
  pos,
  prng,
  randomCampus,
  restrooms,
  stripLevels,
  tower7,
  triangle,
  withOverrides,
} from './fixtures/audit.ts';

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
    blocked: (_a, _b, link) => link.data.blocked[profile],
  });
  return finder.find(from, to).map((n) => String(n.id));
}

/** Plain Dijkstra over the graph links, independent of ngraph.path. Infinity when unreachable. */
function dijkstraCost(g: CampusGraph, from: string, to: string | ReadonlySet<string>, profile: Profile): number {
  const isTarget = typeof to === 'string' ? (id: string) => id === to : (id: string) => to.has(id);
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
    if (isTarget(best)) return bestD;
    done.add(best);
    for (const link of g.graph.getLinks(best) ?? []) {
      if (String(link.fromId) !== best || link.data.blocked[profile]) continue;
      const id = String(link.toId);
      const d = bestD + link.data.cost[profile];
      if (d < (dist.get(id) ?? Infinity)) dist.set(id, d);
    }
  }
}

/** Everything except the display-only parts of the steps (floor names in text and levels). */
function comparable(r: RouteResult) {
  if (!r.found) return r;
  return { ...r, steps: r.steps.map(({ kind, distanceM, timeSec, edgeIds }) => ({ kind, distanceM, timeSec, edgeIds })) };
}

function sentences(r: Route): string[] {
  return r.steps.map((s) => s.text);
}

/** The walk links of one campus edge, in the given direction. */
function walkLinks(g: CampusGraph, from: string, to: string, edgeId: string) {
  return [...(g.graph.getLinks(from) ?? [])].filter(
    (l) => l.fromId === from && l.toId === to && l.data.kind === 'walk' && l.data.edge.id === edgeId,
  );
}

/** Every node and the ids of its links, in iteration order: the whole observable graph state. */
function snapshot(g: CampusGraph) {
  const nodes: [string, string[] | null][] = [];
  g.graph.forEachNode((n) => {
    nodes.push([String(n.id), n.links === null ? null : [...n.links].map((l) => l.id)]);
  });
  return { nodeCount: g.graph.getNodeCount(), linkCount: g.graph.getLinkCount(), nodes };
}

const isRestroom = (n: NodeFeature) => n.properties.node_type === 'restroom';
const BASIC_DIR = fileURLToPath(new URL('../fixtures/campus-basic', import.meta.url));
const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

describe('routing checklist (SPEC-v0.2 3.7)', () => {
  // ---- R1 ----
  it('R1: elevator wait is paid once per ride (1→7 minus 1→2 is five hops)', () => {
    const g = buildGraph(tower7());
    // step_free so 1→2 cannot take the stairs; halls and stops share positions on every floor,
    // so the walking part of both routes is identical and cancels out.
    const up6 = route(g, TOWER.hall(1), TOWER.hall(7), 'step_free');
    const up1 = route(g, TOWER.hall(1), TOWER.hall(2), 'step_free');
    expect(up6.distanceM).toBe(up1.distanceM);
    // timeSec is rounded to 0.1 s.
    expect(up6.timeSec - up1.timeSec).toBeCloseTo(5 * ELEVATOR_HOP_SEC, 0);
    expect(up6.timeSec).toBeCloseTo(up6.distanceM / WALK_SPEED_MPS + ELEVATOR_BOARD_SEC + 6 * ELEVATOR_HOP_SEC + ELEVATOR_ALIGHT_SEC, 0);
    // Structure: the wait sits on the single board link of each stop, never on a hop.
    for (let l = 1; l <= 7; l++) {
      const links = [...(g.graph.getLinks(TOWER.stop(l)) ?? [])];
      expect(links.filter((k) => k.data.kind === 'board').map((k) => k.data.timeSec)).toEqual([ELEVATOR_BOARD_SEC]);
    }
    g.graph.forEachLink((link) => {
      if (link.data.kind === 'hop') expect(link.data.timeSec).toBe(ELEVATOR_HOP_SEC);
    });
  });

  // ---- R2 ----
  it('R2: a one-way edge is not walked backwards', () => {
    const g = buildGraph(oneWay());
    expect(route(g, ONE_WAY.A, ONE_WAY.B, 'shortest').edgeIds).toEqual([ONE_WAY.EDGE]);
    for (const profile of PROFILES) {
      expect(findRoute(g, ONE_WAY.B, ONE_WAY.A, profile)).toMatchObject({ found: false, reason: 'no-route' });
    }
  });

  // ---- R3 ----
  it('R3: parallel steps + ramp between the same two points both survive', () => {
    const g = buildGraph(parallelStairsRamp());
    const pq = [...(g.graph.getLinks(PARALLEL.P) ?? [])].filter((l) => l.fromId === PARALLEL.P && l.toId === PARALLEL.Q);
    expect(pq.map((l) => (l.data.kind === 'walk' ? l.data.edge.id : l.data.kind)).sort()).toEqual([PARALLEL.RAMP, PARALLEL.STEPS].sort());
    // The 20 m ramp (20 s) beats the 20 m outdoor steps (2 s/m = 40 s) even in shortest; step_free must take the ramp.
    expect(route(g, PARALLEL.P, PARALLEL.Q, 'shortest').edgeIds).toEqual([PARALLEL.RAMP]);
    expect(route(g, PARALLEL.Q, PARALLEL.P, 'shortest').edgeIds).toEqual([PARALLEL.RAMP]);
    expect(route(g, PARALLEL.P, PARALLEL.Q, 'step_free').edgeIds).toEqual([PARALLEL.RAMP]);
    expect(route(g, PARALLEL.Q, PARALLEL.P, 'step_free').edgeIds).toEqual([PARALLEL.RAMP]);
    // Close the ramp: the parallel steps link is still there and shortest uses it.
    const closed = buildGraph(parallelStairsRamp(), { overrides: [override(PARALLEL.RAMP)] });
    expect(route(closed, PARALLEL.P, PARALLEL.Q, 'shortest').edgeIds).toEqual([PARALLEL.STEPS]);
    expect(route(closed, PARALLEL.Q, PARALLEL.P, 'shortest').edgeIds).toEqual([PARALLEL.STEPS]);
  });

  // ---- R4 ----
  it('R4: A* cost equals Dijkstra cost on 200 seeded random graphs', () => {
    let compared = 0;
    let reachable = 0;
    let fellBack = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { campus, nodeIds } = randomCampus(seed);
      const g = buildGraph(campus);
      const rnd = prng(seed * 7919);
      for (let k = 0; k < 5; k++) {
        const from = nodeIds[Math.floor(rnd() * nodeIds.length)]!;
        const to = nodeIds[Math.floor(rnd() * nodeIds.length)]!;
        for (const profile of PROFILES) {
          const r = findRoute(g, from, to, profile);
          const d = dijkstraCost(g, from, to, profile);
          const label = `seed ${seed} ${from} → ${to} ${profile}`;
          compared++;
          if (d !== Infinity) {
            expect(r.found, label).toBe(true);
            // Route.cost is rounded to 0.1.
            expect(Math.abs((r as Route).cost - d), label).toBeLessThanOrEqual(0.05 + 1e-9);
            expect((r as Route).fallback, label).toBeNull();
            reachable++;
            continue;
          }
          const fallbackCost = profile === 'step_free' ? dijkstraCost(g, from, to, 'fewest_steps') : Infinity;
          if (fallbackCost === Infinity) {
            expect(r.found, label).toBe(false);
          } else {
            expect(r.found, label).toBe(true);
            expect((r as Route).fallback?.profile, label).toBe('fewest_steps');
            expect(Math.abs((r as Route).cost - fallbackCost), label).toBeLessThanOrEqual(0.05 + 1e-9);
            fellBack++;
          }
        }
      }
    }
    expect(compared).toBe(3000);
    expect(reachable).toBeGreaterThan(800);
    expect(fellBack).toBeGreaterThan(0);
  });

  it('R4: the heuristic never overestimates: no link is faster in plan than heuristicSpeedMps', async () => {
    const graphs = [
      buildGraph(await loadCampus(BASIC_DIR)), buildGraph(tower7()), buildGraph(parallelStairsRamp()),
      buildGraph(bridgeOffset({ stairsAtEnd: true })), ...Array.from({ length: 200 }, (_, s) => buildGraph(randomCampus(s + 1).campus)),
    ];
    let fasterThanWalking = 0;
    for (const g of graphs) {
      expect(g.heuristicSpeedMps).toBeGreaterThanOrEqual(WALK_SPEED_MPS);
      g.graph.forEachLink((link) => {
        const planM = straight(g.graph.getNode(link.fromId)!.data.position, g.graph.getNode(link.toId)!.data.position);
        for (const profile of PROFILES) {
          expect(planM / g.heuristicSpeedMps, `${link.id} ${profile}`).toBeLessThanOrEqual(link.data.cost[profile] + 1e-9);
        }
        if (planM / WALK_SPEED_MPS > link.data.timeSec + 1e-9) fasterThanWalking++;
      });
    }
    // The guard matters: plain distance / WALK_SPEED_MPS would overestimate on these links (stairs, far-apart stops).
    expect(fasterThanWalking).toBeGreaterThan(50);
    // Flat graphs with stops of one elevator in one place (I5) keep the walking speed.
    for (const c of [restrooms(), bridgeOffset(), expressElevator(), nullCorridor(), triangle()]) {
      expect(buildGraph(c).heuristicSpeedMps).toBeCloseTo(WALK_SPEED_MPS, 9);
    }
    // campus-basic: exactly the fastest link, the 2-step flight e_B_2_steps__B_2_bridge walked downhill (≈ 7 m in 0.73 s).
    const basic = graphs[0]!;
    let fastest = 0;
    let fastestId = '';
    basic.graph.forEachLink((link) => {
      const planM = straight(basic.graph.getNode(link.fromId)!.data.position, basic.graph.getNode(link.toId)!.data.position);
      if (planM / link.data.timeSec > fastest) {
        fastest = planM / link.data.timeSec;
        fastestId = link.data.kind === 'walk' ? `${link.data.edge.id} ${String(link.fromId)}` : link.data.kind;
      }
    });
    expect(basic.heuristicSpeedMps).toBe(fastest);
    expect(fastestId).toBe('e_B_2_steps__B_2_bridge n_B_2_steps');
  });

  // ---- R5 ----
  it('R5: route nodes run from start to end', () => {
    const g = buildGraph(tower7());
    const r = route(g, TOWER.hall(1), TOWER.hall(7), 'step_free');
    expect(r.nodes[0]).toBe(TOWER.hall(1));
    expect(r.nodes.at(-1)).toBe(TOWER.hall(7));
    expect(r.edgeIds[0]).toBe(TOWER.hallToStop(1));
    expect(r.edgeIds.at(-1)).toBe(TOWER.hallToStop(7));
    expect(route(buildGraph(oneWay()), ONE_WAY.A, ONE_WAY.B, 'shortest').nodes).toEqual([ONE_WAY.A, ONE_WAY.B]);
  });

  // ---- R6 ----
  it('R6: one unit, seconds: elevator 1→7 has timeSec 67 (40 + 6×4 + 3) and cost in the same unit', () => {
    const g = buildGraph(tower7());
    const r = route(g, TOWER.stop(1), TOWER.stop(7), 'shortest');
    expect(r.timeSec).toBe(67);
    expect(ELEVATOR_BOARD_SEC + 6 * ELEVATOR_HOP_SEC + ELEVATOR_ALIGHT_SEC).toBe(67);
    // shortest has no preference penalties, so cost and time agree.
    expect(r.cost).toBe(r.timeSec);
  });

  it('R6: timeSec does not include the step_free penalty (cost − timeSec = 60 s for one unknown corridor)', () => {
    const g = buildGraph(nullCorridor());
    const r = route(g, NULL_CORRIDOR.OUT, NULL_CORRIDOR.ROOM_NULL, 'step_free');
    // Walking at WALK_SPEED_MPS plus PORTAL_SEC; UNKNOWN_STEP_FREE_PENALTY_SEC only in cost.
    expect(r.timeSec).toBeCloseTo(r.distanceM / WALK_SPEED_MPS + PORTAL_SEC, 0);
    expect(r.cost - r.timeSec).toBeCloseTo(UNKNOWN_STEP_FREE_PENALTY_SEC, 0);
    expect(r.uncertainSegments).toEqual([{ edgeId: NULL_CORRIDOR.EDGE_NULL, from: NULL_CORRIDOR.HALL, to: NULL_CORRIDOR.ROOM_NULL }]);
    // The same corridor costs nothing extra in shortest and is not reported there.
    const s = route(g, NULL_CORRIDOR.OUT, NULL_CORRIDOR.ROOM_NULL, 'shortest');
    expect(s.cost).toBe(s.timeSec);
    expect(s.uncertainSegments).toEqual([]);
  });

  it('R6: time is in seconds (ramp × RAMP_FACTOR, steps by stairsTimeSec) and the old constants are gone', () => {
    const g = buildGraph(parallelStairsRamp());
    const [ramp] = walkLinks(g, PARALLEL.P, PARALLEL.Q, PARALLEL.RAMP);
    const [steps] = walkLinks(g, PARALLEL.P, PARALLEL.Q, PARALLEL.STEPS);
    if (ramp?.data.kind !== 'walk' || steps?.data.kind !== 'walk') throw new Error('missing walk links');
    expect(ramp.data.timeSec).toBeCloseTo((ramp.data.lengthM / WALK_SPEED_MPS) * RAMP_FACTOR, 9);
    // Outdoor steps: plan length only (2 s/m), their step_count 12 is ignored.
    expect(steps.data.timeSec).toBeCloseTo(steps.data.lengthM * OUTDOOR_STAIRS_SEC_PER_M, 9);
    for (const old of ['STEPS_LENGTH_FACTOR', 'STEPS_FLIGHT_COST', 'RAMP_LENGTH_FACTOR', 'PORTAL_EXTRA_COST',
      'ELEVATOR_BOARDING_COST', 'ELEVATOR_FLOOR_COST', 'WALKING_SPEED_M_PER_S', 'ELEVATOR_WAIT_S', 'ELEVATOR_FLOOR_S',
      'elevatorFloors', 'elevatorRideCost', 'walkCost', 'STAIRS_FACTOR']) {
      expect(Object.keys(core), old).not.toContain(old);
    }
  });

  // ---- R6: stairs time (stairsTimeSec, SPEC-v0.2 3.1) ----
  const landings = ['stair_landing', 'stair_landing'] as const;
  const outdoorEnds = ['outdoor', 'outdoor'] as const;
  type StairsCase = Omit<Parameters<typeof stairsTimeSec>[0], 'traversal'>;
  const up = (c: StairsCase) => stairsTimeSec({ ...c, traversal: 'along' });

  it('R6: stairsTimeSec outdoor: plan length × OUTDOOR_STAIRS_SEC_PER_M (2 s/m), at least 10 s; step_count and flight_sec are ignored', () => {
    expect([OUTDOOR_STAIRS_SEC_PER_M, OUTDOOR_STAIRS_MIN_SEC]).toEqual([2, 10]);
    const outdoor = (m: number, extra: { step_count?: number; flight_sec?: number } = {}) =>
      up({ edge: { edge_type: 'outdoor', ...extra }, endNodeTypes: outdoorEnds, planLengthM: m });
    expect(outdoor(0)).toBe(OUTDOOR_STAIRS_MIN_SEC);
    expect(outdoor(2)).toBe(OUTDOOR_STAIRS_MIN_SEC);
    expect(outdoor(5)).toBe(10);
    expect(outdoor(30)).toBe(60);
    expect(outdoor(34.5)).toBe(69);
    // campus-basic e_out_0002__out_0003: 34.5 m with 24 steps is 69 s, not 24 × 0.55.
    expect(outdoor(34.5, { step_count: 24 })).toBe(69);
    expect(outdoor(2, { step_count: 40, flight_sec: 25 })).toBe(OUTDOOR_STAIRS_MIN_SEC);
    // Even between two landings: outdoor is outdoor.
    expect(up({ edge: { edge_type: 'outdoor', step_count: 20, flight_sec: 25 }, endNodeTypes: landings, planLengthM: 3 })).toBe(OUTDOOR_STAIRS_MIN_SEC);
  });

  it('R6: stairsTimeSec indoor flight: step_count × STEP_SEC, else flight_sec (clamped to 0..30), else FLOOR_FLIGHT_SEC', () => {
    expect(FLOOR_FLIGHT_SEC).toBe(18);
    expect([FLIGHT_SEC_MIN, FLIGHT_SEC_MAX]).toEqual([0, 30]);
    // step_count wins over flight_sec, and no walking time is added.
    expect(up({ edge: { edge_type: 'indoor', step_count: 20, flight_sec: 25 }, endNodeTypes: landings, planLengthM: 9 })).toBeCloseTo(20 * STEP_SEC, 9);
    // A step_count that is not a positive finite number counts as missing.
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(up({ edge: { edge_type: 'indoor', step_count: bad }, endNodeTypes: landings, planLengthM: 1 }), String(bad)).toBe(FLOOR_FLIGHT_SEC);
    }
    const flight = (flight_sec?: number, planLengthM = 1.1) =>
      up({ edge: flight_sec === undefined ? { edge_type: 'indoor' } : { edge_type: 'indoor', flight_sec }, endNodeTypes: landings, planLengthM });
    expect(flight()).toBe(FLOOR_FLIGHT_SEC);
    expect(flight(undefined, 0)).toBe(FLOOR_FLIGHT_SEC); // plan length does not matter
    expect(flight(20)).toBe(20);
    expect(flight(0)).toBe(0);
    expect(flight(30)).toBe(30);
    expect(flight(45)).toBe(FLIGHT_SEC_MAX);
    expect(flight(-5)).toBe(FLIGHT_SEC_MIN);
    expect(flight(Number.NaN)).toBe(FLOOR_FLIGHT_SEC);
  });

  it('R6: stairsTimeSec other steps edges (not outdoor, not an indoor flight): step_count × STEP_SEC, else the plan-length formula', () => {
    const other: StairsCase[] = [
      { edge: { edge_type: 'indoor', flight_sec: 25 }, endNodeTypes: ['corridor', 'corridor'], planLengthM: 2 },
      { edge: { edge_type: 'indoor' }, endNodeTypes: ['stair_landing', undefined], planLengthM: 2 },
      { edge: { edge_type: 'portal' }, endNodeTypes: landings, planLengthM: 2 },
      { edge: {}, endNodeTypes: landings, planLengthM: 2 },
    ];
    for (const c of other) {
      expect(up(c), JSON.stringify(c)).toBe(OUTDOOR_STAIRS_MIN_SEC); // flight_sec is ignored here
      expect(up({ ...c, planLengthM: 12 }), JSON.stringify(c)).toBe(24);
      expect(up({ ...c, edge: { ...c.edge, step_count: 4 } }), JSON.stringify(c)).toBeCloseTo(4 * STEP_SEC, 9);
    }
  });

  it('R6: stairsTimeSec downhill is DOWNHILL_STAIRS_FACTOR (2/3) of every rule, in both directions of a bidirectional edge; no incline is up', () => {
    expect(DOWNHILL_STAIRS_FACTOR).toBeCloseTo(2 / 3, 12);
    const cases: [string, StairsCase, number][] = [
      ['outdoor (step_count ignored)', { edge: { edge_type: 'outdoor', step_count: 24 }, endNodeTypes: outdoorEnds, planLengthM: 34.5 }, 69],
      ['outdoor minimum', { edge: { edge_type: 'outdoor' }, endNodeTypes: outdoorEnds, planLengthM: 1 }, OUTDOOR_STAIRS_MIN_SEC],
      ['indoor flight step_count', { edge: { edge_type: 'indoor', step_count: 20 }, endNodeTypes: landings, planLengthM: 1 }, 20 * STEP_SEC],
      ['indoor flight flight_sec', { edge: { edge_type: 'indoor', flight_sec: 21 }, endNodeTypes: landings, planLengthM: 1 }, 21],
      ['indoor flight default', { edge: { edge_type: 'indoor' }, endNodeTypes: landings, planLengthM: 1 }, FLOOR_FLIGHT_SEC],
      ['other step_count', { edge: { edge_type: 'indoor', step_count: 2 }, endNodeTypes: ['corridor', 'corridor'], planLengthM: 7 }, 2 * STEP_SEC],
      ['other plan length', { edge: { edge_type: 'indoor' }, endNodeTypes: ['corridor', 'corridor'], planLengthM: 7 }, 14],
    ];
    for (const [label, c, upSec] of cases) {
      const t = (incline: 'up' | 'down' | undefined, traversal: 'along' | 'against') => {
        const { incline: _drop, ...rest } = c.edge;
        return stairsTimeSec({ ...c, edge: incline === undefined ? rest : { ...rest, incline }, traversal });
      };
      // incline 'up': drawn from → to goes up, so walking it against the drawing goes down.
      expect(t('up', 'along'), label).toBeCloseTo(upSec, 9);
      expect(t('up', 'against'), label).toBeCloseTo(upSec * DOWNHILL_STAIRS_FACTOR, 9);
      expect(t('down', 'along'), label).toBeCloseTo(upSec * DOWNHILL_STAIRS_FACTOR, 9);
      expect(t('down', 'against'), label).toBeCloseTo(upSec, 9);
      expect(t(undefined, 'along'), label).toBeCloseTo(upSec, 9);
      expect(t(undefined, 'against'), label).toBeCloseTo(upSec, 9);
    }
    // In the graph: one link per direction of the bidirectional tower7 flights (incline 'up').
    const g = buildGraph(tower7({ elevator: false, stepCount: null }));
    const [upLink] = walkLinks(g, TOWER.landing(3), TOWER.landing(4), TOWER.stairEdge(3));
    const [downLink] = walkLinks(g, TOWER.landing(4), TOWER.landing(3), TOWER.stairEdge(3));
    expect(upLink!.data.timeSec).toBe(FLOOR_FLIGHT_SEC);
    expect(downLink!.data.timeSec).toBeCloseTo(FLOOR_FLIGHT_SEC * DOWNHILL_STAIRS_FACTOR, 9);
    expect(route(g, TOWER.landing(1), TOWER.landing(7), 'shortest').timeSec).toBe(6 * FLOOR_FLIGHT_SEC);
    expect(route(g, TOWER.landing(7), TOWER.landing(1), 'shortest').timeSec).toBeCloseTo(6 * FLOOR_FLIGHT_SEC * DOWNHILL_STAIRS_FACTOR, 1);
    // Without incline both directions take the up time.
    const flat = structuredClone(tower7({ elevator: false, stepCount: null }));
    for (const { feature } of flat.features) delete (feature as { properties: Record<string, unknown> }).properties['incline'];
    expect(route(buildGraph(flat), TOWER.landing(7), TOWER.landing(1), 'shortest').timeSec).toBe(6 * FLOOR_FLIGHT_SEC);
  });

  it('R6: every steps link is priced by stairsTimeSec in its own direction (plus PORTAL_SEC on a portal)', async () => {
    const graphs = [
      buildGraph(await loadCampus(BASIC_DIR)), buildGraph(tower7()), buildGraph(tower7({ stepCount: null })),
      buildGraph(bridgeOffset({ stairsAtEnd: true })), ...Array.from({ length: 20 }, (_, s) => buildGraph(randomCampus(s + 1).campus)),
    ];
    let checked = 0;
    let downhill = 0;
    let outdoorWithSteps = 0;
    for (const g of graphs) {
      g.graph.forEachLink((link) => {
        if (link.data.kind !== 'walk' || link.data.edge.properties.highway !== 'steps') return;
        const { edge, lengthM, timeSec } = link.data;
        const p = edge.properties;
        if (p.edge_type === 'outdoor' && p.step_count !== undefined) {
          outdoorWithSteps++;
          expect(timeSec, edge.id).toBeGreaterThanOrEqual(OUTDOOR_STAIRS_MIN_SEC * DOWNHILL_STAIRS_FACTOR - 1e-9);
        }
        const endNodeTypes = [g.nodes.get(p.from)!.properties.node_type, g.nodes.get(p.to)!.properties.node_type] as const;
        const traversal = link.fromId === p.from ? 'along' : 'against';
        const portal = p.edge_type === 'portal' ? PORTAL_SEC : 0;
        expect(timeSec, edge.id).toBe(stairsTimeSec({ edge: p, endNodeTypes, planLengthM: lengthM, traversal }) + portal);
        if ((traversal === 'along' && p.incline === 'down') || (traversal === 'against' && p.incline === 'up')) downhill++;
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(60);
    expect(downhill).toBeGreaterThan(10);
    expect(outdoorWithSteps).toBeGreaterThan(5); // outdoor step_count is present and ignored
    // campus-basic: the measured B동 1→2층 flight (flight_sec 20, incline up) is 20 s up, 13.3 s down.
    const basic = graphs[0]!;
    expect(walkLinks(basic, 'n_B_1_stair', 'n_B_2_stair', 'e_B_1_stair__B_2_stair')[0]!.data.timeSec).toBe(20);
    expect(walkLinks(basic, 'n_B_2_stair', 'n_B_1_stair', 'e_B_1_stair__B_2_stair')[0]!.data.timeSec).toBeCloseTo(20 * DOWNHILL_STAIRS_FACTOR, 9);
  });

  it('R6: the stairs constants live only in costs.ts and are used only inside the one function stairsTimeSec', () => {
    const NAMES = ['STEP_SEC', 'FLOOR_FLIGHT_SEC', 'FLIGHT_SEC_MIN', 'FLIGHT_SEC_MAX', 'OUTDOOR_STAIRS_SEC_PER_M',
      'OUTDOOR_STAIRS_MIN_SEC', 'DOWNHILL_STAIRS_FACTOR'];
    const strip = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const costs = strip(readFileSync(join(SRC_DIR, 'costs.ts'), 'utf8'));
    const start = costs.indexOf('export function stairsTimeSec(');
    expect(start).toBeGreaterThan(-1);
    // The function body: from its first '{' after the parameter list to the matching '}'.
    let i = costs.indexOf('{', costs.indexOf(')', costs.indexOf('}: StairsTimeInput', start)));
    let depth = 0;
    const bodyStart = i;
    for (; i < costs.length; i++) {
      if (costs[i] === '{') depth++;
      else if (costs[i] === '}' && --depth === 0) break;
    }
    const body = costs.slice(bodyStart, i + 1);
    const rest = costs.slice(0, start) + costs.slice(i + 1);
    for (const name of NAMES) {
      expect(body, name).toMatch(new RegExp(`\\b${name}\\b`));
      // Outside the function: only its declaration.
      expect(rest.match(new RegExp(`\\b${name}\\b`, 'g')), name).toEqual([name]);
      expect(rest, name).toMatch(new RegExp(`export const ${name} = `));
    }
    // No other routing source declares or uses them; graph.ts calls stairsTimeSec exactly once.
    const others = ['graph.ts', 'route.ts', 'route-text.ts', ...readdirSync(join(SRC_DIR, 'routing'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts')).map((f) => join('routing', f))];
    for (const f of others) {
      const code = strip(readFileSync(join(SRC_DIR, f), 'utf8'));
      for (const name of NAMES) expect(code, `${f} ${name}`).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(strip(readFileSync(join(SRC_DIR, 'graph.ts'), 'utf8')).match(/stairsTimeSec\(/g)).toHaveLength(1);
    expect(Object.keys(core).filter((k) => /stairs/i.test(k) && typeof (core as Record<string, unknown>)[k] === 'function')).toEqual(['stairsTimeSec']);
  });

  it('R6: with stairsTimeSec, campus-basic shortest gate → 408 takes the outdoor stairs (69 s by plan length, 130.4 s total) instead of the indoor stairwell (165.6 s)', async () => {
    const basic = await loadCampus(BASIC_DIR);
    const g = buildGraph(basic);
    const r = route(g, 'n_out_0001', 'n_A_4_408door', 'shortest');
    expect(r.edgeIds).toEqual(['e_out_0001__out_0002', 'e_out_0002__out_0003', 'e_portal_A_4_north', 'e_A_4_north__A_4_408door']);
    // 34.5 m × 2 s/m; its step_count 24 is not used.
    expect(r.steps.find((s) => s.kind === 'stairs')).toMatchObject({ timeSec: 69, edgeIds: ['e_out_0002__out_0003'] });
    expect(r.timeSec).toBeCloseTo(130.4, 1);
    // Without the outdoor stairs, shortest goes in at A동 1층 and climbs three indoor flights (3 × 18 s): slower.
    const indoor = route(buildGraph(basic, { overrides: [override('e_out_0002__out_0003')] }), 'n_out_0001', 'n_A_4_408door', 'shortest');
    expect(indoor.edgeIds).toEqual(expect.arrayContaining(['e_portal_A_1_main', 'e_A_1_stair__A_2_stair', 'e_A_2_stair__A_3_stair', 'e_A_3_stair__A_4_stair']));
    expect(indoor.timeSec).toBeCloseTo(165.6, 1);
    expect(indoor.timeSec).toBeGreaterThan(r.timeSec);
    // step_free goes round by the ramp: longer, slower, no stairs.
    const free = route(g, 'n_out_0001', 'n_A_4_408door', 'step_free');
    expect(free.stairsCount).toBe(0);
    expect(free.timeSec).toBeGreaterThan(r.timeSec);
  });

  // ---- R7 ----
  it('R7: step_free: null indoor corridor does not block the step_free route', () => {
    const g = buildGraph(nullCorridor());
    const r = route(g, NULL_CORRIDOR.OUT, NULL_CORRIDOR.ROOM_NULL, 'step_free');
    expect(r.fallback).toBeNull();
    expect(r.edgeIds).toContain(NULL_CORRIDOR.EDGE_NULL);
  });

  it('R7: indoor corridor without a step_free value does not block the step_free route', () => {
    const g = buildGraph(nullCorridor());
    const r = route(g, NULL_CORRIDOR.OUT, NULL_CORRIDOR.ROOM_MISSING, 'step_free');
    expect(r.fallback).toBeNull();
    expect(r.edgeIds).toContain(NULL_CORRIDOR.EDGE_MISSING);
    expect(r.uncertainSegments.map((u) => u.edgeId)).toEqual([NULL_CORRIDOR.EDGE_MISSING]);
  });

  // ---- R8 ----
  it('R8: an elevator marked broken in overrides is blocked in all profiles', () => {
    const overrides = [1, 2, 3, 4, 5, 6].map((l) => override(TOWER.elevatorEdge(l)));
    const g = buildGraph(tower7(), { overrides });
    const usesElevator = (r: Route) => r.edgeIds.some((id) => id.startsWith('e_T_elevA_'));
    const shortest = route(g, TOWER.hall(1), TOWER.hall(7), 'shortest');
    expect(usesElevator(shortest)).toBe(false);
    expect(shortest.stairsCount).toBe(6);
    expect(usesElevator(route(g, TOWER.hall(1), TOWER.hall(7), 'fewest_steps'))).toBe(false);
    // step_free has no step-free way left, so it falls back to the stairs and says so.
    const free = route(g, TOWER.hall(1), TOWER.hall(7), 'step_free');
    expect(usesElevator(free)).toBe(false);
    expect(free.fallback).toMatchObject({ profile: 'fewest_steps', stairsCount: 6 });
    // Without the overrides the same graph data rides the elevator.
    expect(usesElevator(route(buildGraph(tower7()), TOWER.hall(1), TOWER.hall(7), 'step_free'))).toBe(true);
  });

  it('R8: a stop override blocks boarding and alighting there; the car still passes that floor', () => {
    const g = buildGraph(tower7(), { overrides: [override(TOWER.stop(4))] });
    const through = route(g, TOWER.hall(1), TOWER.hall(7), 'step_free');
    expect(through.fallback).toBeNull();
    expect(through.timeSec).toBeCloseTo(through.distanceM / WALK_SPEED_MPS + 67, 0);
    const to4 = route(g, TOWER.hall(1), TOWER.hall(4), 'step_free');
    expect(to4.fallback?.profile).toBe('fewest_steps');
    expect(to4.nodes).not.toContain(TOWER.stop(4));
    for (const link of g.graph.getLinks(TOWER.stop(4)) ?? []) {
      for (const profile of PROFILES) expect(link.data.blocked[profile], `${link.id} ${profile}`).toBe(true);
    }
  });

  it('R8: overrides default to campus.overrides; only unexpired entries block, malformed ones are ignored', () => {
    const now = new Date('2026-11-11T09:00:00Z');
    const entries: unknown[] = [
      override(TOWER.elevatorEdge(3), { status: 'whatever', until: '2026-11-11T10:00:00Z' }), // active, any status
      override(TOWER.elevatorEdge(1), { until: '2026-11-11T08:59:59Z' }), // expired
      override(TOWER.elevatorEdge(2), { until: 'not a date' }),
      { feature_id: 42, until: '2099-01-01T00:00:00Z' },
      null,
      'garbage',
    ];
    const g = buildGraph(withOverrides(tower7(), entries), { now });
    const r = route(g, TOWER.stop(1), TOWER.stop(2), 'step_free');
    expect(r.edgeIds).toEqual([TOWER.elevatorEdge(1)]);
    expect([...g.closed]).toEqual([TOWER.elevatorEdge(3)]);
    expect(route(g, TOWER.hall(1), TOWER.hall(7), 'step_free').fallback?.profile).toBe('fewest_steps');
    // Later, the active entry expires too.
    expect(buildGraph(withOverrides(tower7(), entries), { now: new Date('2026-11-12T00:00:00Z') }).closed.size).toBe(0);
    // An explicit list replaces campus.overrides; junk instead of a list blocks nothing.
    expect(buildGraph(withOverrides(tower7(), entries), { now, overrides: [] }).closed.size).toBe(0);
    for (const junk of [undefined, null, 'x', 7, { feature_id: TOWER.stop(1) }]) {
      expect(buildGraph(withOverrides(tower7(), junk), { now }).closed.size).toBe(0);
    }
  });

  // ---- R9 ----
  it('R9: a multi-floor ride stays in the car (no alight and re-board on the way)', () => {
    // No step_count: 16 s per flight, so even shortest rides 1F → 7F (with 20 steps the stairs win by 0.6 s).
    const g = buildGraph(tower7({ stepCount: null }));
    const ride = [1, 2, 3, 4, 5, 6].map(TOWER.elevatorEdge);
    for (const profile of PROFILES) {
      const r = route(g, TOWER.hall(1), TOWER.hall(7), profile);
      expect(r.edgeIds, profile).toEqual([TOWER.hallToStop(1), ...ride, TOWER.hallToStop(7)]);
      expect(r.nodes, profile).toEqual([TOWER.hall(1), TOWER.stop(1), ...[2, 3, 4, 5, 6, 7].map(TOWER.stop), TOWER.hall(7)]);
      expect(r.steps.filter((s) => s.kind === 'elevator').map((s) => s.text), profile).toEqual(['엘리베이터를 타고 7층으로 가세요']);
    }
    // Each stop has exactly one board link (stop → car), so getting off and back on pays the wait again.
    const boards = [...(g.graph.getLinks(TOWER.stop(4)) ?? [])].filter((l) => l.data.kind === 'board');
    expect(boards).toHaveLength(1);
    expect(boards[0]!.toId).toBe(carId(TOWER.stop(4)));
  });

  // ---- R10 ----
  it('R10: tower7, bridgeOffset and campus-basic give the same routes after every level value is deleted', async () => {
    const basicPairs: [string, string][] = [
      ['n_out_0001', 'n_A_4_408door'], ['n_out_0001', 'n_B_2_201door'], ['n_B_2_201door', 'n_out_0001'], ['n_out_0001', 'n_B_1_hall'],
      ['n_A_1_hall', 'n_A_4_hall'], ['n_A_4_408door', 'n_B_2_201door'], ['n_B_1_main', 'n_A_1_main'],
    ];
    const cases: [LoadedCampus, [string, string][]][] = [
      [await loadCampus(BASIC_DIR), basicPairs],
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
        for (const profile of PROFILES) {
          expect(comparable(findRoute(blind, from, to, profile)), `${from} → ${to} ${profile}`)
            .toEqual(comparable(findRoute(seeing, from, to, profile)));
        }
      }
    }
  });

  // ---- R11 ----
  it('R11: same start and end gives a zero route; unknown ids give unknown-node', () => {
    const g = buildGraph(tower7());
    for (const profile of PROFILES) {
      expect(findRoute(g, TOWER.hall(3), TOWER.hall(3), profile)).toEqual({
        found: true, profile, nodes: [TOWER.hall(3)], edgeIds: [], cost: 0, timeSec: 0, distanceM: 0, stairsCount: 0,
        steps: [], uncertainSegments: [], fallback: null,
      });
    }
    const missing = findRoute(g, 'n_nowhere', TOWER.hall(1), 'shortest');
    expect(missing).toMatchObject({ found: false, reason: 'unknown-node' });
    expect(missing.found === false && missing.message).toContain('n_nowhere');
    expect(findRoute(g, TOWER.hall(1), 'n_nowhere', 'step_free')).toMatchObject({ found: false, reason: 'unknown-node' });
    // Graph-only ids (the virtual elevator car) are not campus nodes either.
    expect(findRoute(g, carId(TOWER.stop(1)), TOWER.hall(1), 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
    expect(findNearest(g, 'n_nowhere', isRestroom, 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
  });

  // ---- R12 ----
  it('R12: findNearest picks the restroom with the lowest travel cost, not the straight-line nearest', () => {
    const g = buildGraph(restrooms());
    const seen: unknown[] = [];
    const wheelchairRestroom = (n: NodeFeature) => {
      seen.push(n);
      return n.properties.node_type === 'restroom' && n.properties.wheelchair === 'yes';
    };
    for (const profile of PROFILES) {
      const r = findNearest(g, RESTROOMS.START, wheelchairRestroom, profile);
      if (!r.found) throw new Error(r.message);
      expect(r.targetId, profile).toBe(RESTROOMS.SAME_FLOOR);
      expect(r.nodes, profile).toEqual([RESTROOMS.START, RESTROOMS.SAME_FLOOR]);
      expect(r.profile).toBe(profile);
      expect(r).toMatchObject(route(g, RESTROOMS.START, RESTROOMS.SAME_FLOOR, profile));
    }
    // The predicate gets campus NodeFeatures (never the graph-only car or sink).
    expect(seen.length).toBeGreaterThan(0);
    for (const n of seen as NodeFeature[]) {
      expect(n.geometry.type).toBe('Point');
      expect(g.nodes.get(n.id)).toBe(n);
    }
    // A closed restroom is not a target: the upstairs one is next.
    const closed = buildGraph(restrooms(), { overrides: [override(RESTROOMS.SAME_FLOOR)] });
    expect(findNearest(closed, RESTROOMS.START, isRestroom, 'step_free')).toMatchObject({ found: true, targetId: RESTROOMS.UPSTAIRS });
    // Standing on a match: zero route to it.
    expect(findNearest(g, RESTROOMS.SAME_FLOOR, isRestroom, 'shortest')).toMatchObject({ found: true, targetId: RESTROOMS.SAME_FLOOR, cost: 0, edgeIds: [] });
    // Nothing matches.
    expect(findNearest(g, RESTROOMS.START, () => false, 'shortest')).toMatchObject({ found: false, reason: 'no-route' });
  });

  it('R12: findNearest leaves no sink residue in the shared graph and does not disturb findRoute', () => {
    const g = buildGraph(restrooms());
    const before = snapshot(g);
    const routeBefore = findRoute(g, RESTROOMS.START, RESTROOMS.UPSTAIRS, 'step_free');
    for (const profile of PROFILES) {
      expect(findNearest(g, RESTROOMS.START, isRestroom, profile).found).toBe(true);
    }
    expect(snapshot(g)).toEqual(before);
    expect(g.graph.getNode('~sink')).toBeUndefined();
    expect(findRoute(g, RESTROOMS.START, RESTROOMS.UPSTAIRS, 'step_free')).toEqual(routeBefore);
    expect(findRoute(g, RESTROOMS.START, '~sink', 'shortest')).toMatchObject({ found: false, reason: 'unknown-node' });
  });

  it('R12: findNearest cost equals the cheapest Dijkstra cost over all matching nodes on 200 random graphs', () => {
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { campus, nodeIds } = randomCampus(seed);
      const g = buildGraph(campus);
      const rnd = prng(seed * 104729);
      const targets = new Set(nodeIds.filter(() => rnd() < 0.3));
      const from = nodeIds[Math.floor(rnd() * nodeIds.length)]!;
      for (const profile of ['shortest', 'fewest_steps'] as const) {
        const d = dijkstraCost(g, from, targets, profile);
        const r = findNearest(g, from, (n) => targets.has(n.id), profile);
        const label = `seed ${seed} ${from} ${profile}`;
        if (d === Infinity) {
          expect(r.found, label).toBe(false);
          continue;
        }
        if (!r.found) throw new Error(`${label}: ${r.message}`);
        expect(targets.has(r.targetId), label).toBe(true);
        expect(r.nodes.at(-1), label).toBe(r.targetId);
        expect(Math.abs(r.cost - d), label).toBeLessThanOrEqual(0.05 + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  });

  // ---- R13 ----
  it('R13: a target reached only through blocked links is "no route", not the [target] array ngraph returns', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }), { overrides: [override(BRIDGE.C_END_EDGE)] });
    for (const profile of PROFILES) {
      expect(rawFind(g, BRIDGE.A_HALL, BRIDGE.C_HALL, profile), profile).toEqual([BRIDGE.C_HALL]);
      expect(findRoute(g, BRIDGE.A_HALL, BRIDGE.C_HALL, profile), profile).toMatchObject({ found: false, reason: 'no-route' });
    }
  });

  it('R13: the v0.1 "no route" test really hits the [target] case (campus-basic GATE → n_B_1_hall)', async () => {
    const basic = await loadCampus(BASIC_DIR);
    const g = buildGraph(basic);
    // ngraph alone answers with a one-element "path"; findRoute must not take it for a route.
    expect(rawFind(g, 'n_out_0001', 'n_B_1_hall', 'step_free')).toEqual(['n_B_1_hall']);
    // v0.2: step_free now falls back (R15) to a real path that starts at the gate.
    const r = route(g, 'n_out_0001', 'n_B_1_hall', 'step_free');
    expect(r.fallback?.profile).toBe('fewest_steps');
    expect(r.nodes[0]).toBe('n_out_0001');
    // Close both ways in (B동 1층 portal and the stairs from 2층): every profile gets the [target] case.
    const closed = buildGraph(basic, { overrides: [override('e_portal_B_1_main'), override('e_B_1_stair__B_2_stair')] });
    for (const profile of PROFILES) {
      expect(rawFind(closed, 'n_out_0001', 'n_B_1_hall', profile), profile).toEqual(['n_B_1_hall']);
      expect(findRoute(closed, 'n_out_0001', 'n_B_1_hall', profile), profile).toMatchObject({ found: false, reason: 'no-route' });
    }
  });

  // ---- R14 ----
  it('R14: direction-dependent costs are read per link (from → to), not swapped', () => {
    const g = buildGraph(triangle());
    // Make A→B expensive in this direction only; B→A stays 30 m / 1.2 m/s = 25 s.
    for (const link of g.graph.getLinks(TRIANGLE.A) ?? []) {
      if (link.fromId === TRIANGLE.A && link.toId === TRIANGLE.B) {
        for (const profile of PROFILES) link.data.cost[profile] = 1000;
      }
    }
    for (const profile of PROFILES) {
      expect(route(g, TRIANGLE.A, TRIANGLE.B, profile).nodes, profile).toEqual([TRIANGLE.A, TRIANGLE.C, TRIANGLE.B]);
      const back = route(g, TRIANGLE.B, TRIANGLE.A, profile);
      expect(back.nodes, profile).toEqual([TRIANGLE.B, TRIANGLE.A]);
      expect(back.cost, profile).toBeLessThan(26);
    }
    // board (stop → car) carries the wait, alight (car → stop) the 3 s getting out.
    const t = buildGraph(tower7());
    const stop = TOWER.stop(1);
    const links = [...(t.graph.getLinks(stop) ?? [])];
    expect(links.find((l) => l.fromId === stop && l.toId === carId(stop))!.data)
      .toMatchObject({ kind: 'board', timeSec: ELEVATOR_BOARD_SEC, cost: { shortest: ELEVATOR_BOARD_SEC } });
    expect(links.find((l) => l.fromId === carId(stop) && l.toId === stop)!.data)
      .toMatchObject({ kind: 'alight', timeSec: ELEVATOR_ALIGHT_SEC, cost: { shortest: ELEVATOR_ALIGHT_SEC } });
    const oneFloor = ELEVATOR_BOARD_SEC + ELEVATOR_HOP_SEC + ELEVATOR_ALIGHT_SEC;
    // step_free: one floor by the 20-step stairs (11 s + walking) would beat the elevator in shortest.
    expect(route(t, TOWER.stop(1), TOWER.stop(2), 'step_free').cost).toBe(oneFloor);
    expect(route(t, TOWER.stop(2), TOWER.stop(1), 'step_free').cost).toBe(oneFloor);
  });

  // ---- R15 ----
  it('R15: fewest_steps profile finds the route and counts the unavoidable steps (600 s penalty in cost only)', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }));
    const r = route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'fewest_steps');
    expect(r.stairsCount).toBe(1);
    expect(r.fallback).toBeNull();
    expect(Number.isFinite(r.cost)).toBe(true);
    expect(r.cost - r.timeSec).toBeCloseTo(FEWEST_STEPS_STAIRS_PENALTY_SEC, 0);
  });

  it('R15: step_free with no route falls back to fewest_steps and says how many steps cannot be avoided', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }));
    const r = route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free');
    expect(r.profile).toBe('step_free');
    expect(r.fallback).toEqual({
      profile: 'fewest_steps',
      stairsCount: 1,
      barrierCount: 0,
      message: '계단 없는 경로가 없어 계단이 가장 적은 경로를 안내합니다. 계단 1곳을 피할 수 없습니다.',
    });
    // The route itself is the fewest_steps route; only profile (requested) and fallback differ.
    const { profile: _p, fallback: _f, ...fewest } = route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'fewest_steps');
    expect(r).toMatchObject(fewest);
    expect(JSON.stringify(r)).toContain('계단 1곳을 피할 수 없습니다');
    // When even fewest_steps has nothing, it is plain no-route.
    expect(findRoute(buildGraph(oneWay()), ONE_WAY.B, ONE_WAY.A, 'step_free')).toMatchObject({ found: false, reason: 'no-route' });
  });

  // ---- R16 ----
  it('R16: routing uses a bridge between floors with different numbers (A동 3층 ↔ C동 5층)', () => {
    const g = buildGraph(bridgeOffset());
    for (const profile of PROFILES) {
      expect(route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, profile).edgeIds, profile).toContain(BRIDGE.EDGE);
      expect(route(g, BRIDGE.C_HALL, BRIDGE.A_HALL, profile).edgeIds, profile).toContain(BRIDGE.EDGE);
    }
  });

  it('R16: a bridge that ends in steps is blocked for step_free and still used by shortest', () => {
    const g = buildGraph(bridgeOffset({ stairsAtEnd: true }));
    // No step-free way: step_free can only offer the fewest_steps fallback over that flight.
    expect(route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free').fallback).toMatchObject({ profile: 'fewest_steps', stairsCount: 1 });
    expect(dijkstraCost(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free')).toBe(Infinity);
    const r = route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'shortest');
    expect(r.edgeIds).toEqual(expect.arrayContaining([BRIDGE.EDGE, BRIDGE.C_END_EDGE]));
    expect(r.stairsCount).toBe(1);
  });

  it('R16: bridge sentence reads "A동 3층 연결통로를 건너 C동 5층으로" (문장)', () => {
    const g = buildGraph(bridgeOffset());
    const there = route(g, BRIDGE.A_HALL, BRIDGE.C_HALL, 'step_free');
    expect(there.steps.filter((s) => s.kind === 'bridge').map((s) => s.text)).toEqual(['A동 3층 연결통로를 건너 C동 5층으로 가세요']);
    const back = route(g, BRIDGE.C_HALL, BRIDGE.A_HALL, 'step_free');
    expect(back.steps.filter((s) => s.kind === 'bridge').map((s) => s.text)).toEqual(['C동 5층 연결통로를 건너 A동 3층으로 가세요']);
    expect(there.steps.find((s) => s.kind === 'bridge')).toMatchObject({ fromLevel: 3, toLevel: 5, edgeIds: [BRIDGE.EDGE] });
  });

  // ---- R17 (outside the checklist) ----
  it('R17: express elevator cost unchanged when levels are stripped', () => {
    const seeing = buildGraph(expressElevator());
    const blind = buildGraph(stripLevels(expressElevator()).campus);
    for (const profile of PROFILES) {
      expect(comparable(findRoute(blind, EXPRESS.HALL1, EXPRESS.HALL7, profile)), profile)
        .toEqual(comparable(findRoute(seeing, EXPRESS.HALL1, EXPRESS.HALL7, profile)));
    }
    // One elevator edge is one hop, whatever level_from / level_to say.
    const r = route(seeing, 'n_X_elevA_L1', 'n_X_elevA_L7', 'shortest');
    expect(r.timeSec).toBe(ELEVATOR_BOARD_SEC + ELEVATOR_HOP_SEC + ELEVATOR_ALIGHT_SEC);
    expect(r.edgeIds).toEqual([EXPRESS.EDGE]);
  });

  it('R17: no level reads in routing source (graph.ts, route.ts, costs.ts, src/routing/**; route-text.ts exempt)', () => {
    // route-text.ts prints floor names for people (SPEC-v0.2 3.6) and is the only exemption.
    const EXEMPT = new Set(['route-text.ts']);
    const files = ['graph.ts', 'route.ts', 'costs.ts'].map((f) => join(SRC_DIR, f));
    for (const f of files) expect(existsSync(f), f).toBe(true);
    const routingDir = join(SRC_DIR, 'routing');
    expect(existsSync(routingDir)).toBe(true);
    for (const f of readdirSync(routingDir, { recursive: true, encoding: 'utf8' })) {
      if (f.endsWith('.ts')) files.push(join(routingDir, f));
    }
    expect(files.length).toBeGreaterThan(3);
    for (const file of files) {
      if (EXEMPT.has(file.split(/[\\/]/).at(-1)!)) continue;
      const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/level/i);
    }
  });

  // ---- R18 (outside the checklist): stair sentences, SPEC-v0.2 3.6 ----
  it('R18: stairs are not merged across a landing where a corridor branches off (갈림)', () => {
    // tower7: every landing joins its floor's hall, so 1F → 4F is three separate flights.
    const g = buildGraph(tower7({ elevator: false }));
    const r = route(g, TOWER.hall(1), TOWER.hall(4), 'shortest');
    expect(r.stairsCount).toBe(3);
    expect(sentences(r).filter((s) => s.includes('계단'))).toEqual([
      '계단으로 1층 올라가세요', '계단으로 1층 올라가세요', '계단으로 1층 올라가세요',
    ]);
  });

  it('R18: merged stairs use the direction word from incline, read against travel direction (방향어)', () => {
    // Only floors 1 and 7 join the stairwell, so 1F → 7F is one uninterrupted climb.
    const g = buildGraph(tower7({ elevator: false, stairBranches: false }));
    const up = route(g, TOWER.hall(1), TOWER.hall(7), 'shortest');
    expect(sentences(up)).toContain('계단으로 6층 올라가세요');
    expect(up.steps.filter((s) => s.kind === 'stairs')).toHaveLength(1);
    expect(sentences(route(g, TOWER.hall(7), TOWER.hall(1), 'shortest'))).toContain('계단으로 6층 내려가세요');
    // Without any level values the words still come from incline (and the floor count from the six flights).
    const blind = buildGraph(stripLevels(tower7({ elevator: false, stairBranches: false })).campus);
    expect(sentences(route(blind, TOWER.hall(1), TOWER.hall(7), 'shortest'))).toContain('계단으로 6층 올라가세요');
    expect(sentences(route(blind, TOWER.hall(7), TOWER.hall(1), 'shortest'))).toContain('계단으로 6층 내려가세요');
  });

  it('R18: without incline the direction comes from the display floor names, else it is left out', () => {
    const noIncline = structuredClone(tower7({ elevator: false, stairBranches: false }));
    for (const { feature } of noIncline.features) {
      const p = (feature as { properties: Record<string, unknown> }).properties;
      delete p['incline'];
    }
    const g = buildGraph(noIncline);
    expect(sentences(route(g, TOWER.hall(1), TOWER.hall(7), 'shortest'))).toContain('계단으로 6층 올라가세요');
    expect(sentences(route(g, TOWER.hall(7), TOWER.hall(1), 'shortest'))).toContain('계단으로 6층 내려가세요');
    const blind = buildGraph(stripLevels(noIncline).campus);
    expect(sentences(route(blind, TOWER.hall(1), TOWER.hall(7), 'shortest'))).toContain('계단으로 6층 이동하세요');
  });

  // ---- R19 (outside the checklist) ----
  it('R19: a ramp marked step_free: false (has a step or sill) is blocked for step_free', () => {
    expect(isStepFreePassable({ highway: 'ramp', step_free: false })).toBe(false);
    expect(isStepFreePassable({ highway: 'elevator', step_free: false })).toBe(false);
    expect(isStepFreePassable({ highway: 'ramp', step_free: null })).toBe(true);
    expect(isStepFreePassable({ highway: 'steps', step_free: true })).toBe(false);
    const g = buildGraph(parallelStairsRamp({ rampStepFree: false }));
    expect(dijkstraCost(g, PARALLEL.P, PARALLEL.Q, 'step_free')).toBe(Infinity);
    // fewest_steps takes the ramp (no stairs) and the fallback names the sill it cannot avoid.
    const r = route(g, PARALLEL.P, PARALLEL.Q, 'step_free');
    expect(r.edgeIds).toEqual([PARALLEL.RAMP]);
    expect(r.fallback).toEqual({
      profile: 'fewest_steps', stairsCount: 0, barrierCount: 1,
      message: '계단 없는 경로가 없어 턱이 있는 구간을 지나는 경로를 안내합니다. 턱이 있는 구간 1곳을 피할 수 없습니다.',
    });
  });

  it('R19: an elevator marked step_free: false is blocked for step_free too', () => {
    const c = structuredClone(tower7());
    for (const { feature } of c.features) {
      const p = (feature as { properties: Record<string, unknown> }).properties;
      if (p['highway'] === 'elevator') p['step_free'] = false;
    }
    const g = buildGraph(c);
    expect(dijkstraCost(g, TOWER.hall(1), TOWER.hall(7), 'step_free')).toBe(Infinity);
    expect(route(g, TOWER.hall(1), TOWER.hall(7), 'step_free').fallback).toMatchObject({ profile: 'fewest_steps', stairsCount: 0, barrierCount: 6 });
  });

  // ---- R20 (outside the checklist) ----
  it('R20: an edge whose line does not reach its nodes is priced from the node positions (no clamp); validation reports it', () => {
    const misplaced = buildGraph(offsetEdge());
    const drawnRight = buildGraph(offsetEdge({ misplaced: false }));
    const [link] = walkLinks(misplaced, OFFSET.A, OFFSET.B, OFFSET.EDGE);
    if (link?.data.kind !== 'walk') throw new Error('missing walk link');
    expect(link.data.lengthM).toBeCloseTo(100, 0);
    const r = route(misplaced, OFFSET.A, OFFSET.B, 'shortest');
    expect(r).toEqual(route(drawnRight, OFFSET.A, OFFSET.B, 'shortest'));
    expect(r.distanceM).toBeCloseTo(100, 0);
    expect(r.timeSec).toBeCloseTo(100 / WALK_SPEED_MPS, 0);
    // The data error is validation's job (E4 endpoint-mismatch), not something routing hides.
    const errors = validateCampus(offsetEdge()).errors.filter((e) => e.featureId === OFFSET.EDGE).map((e) => e.code);
    expect(errors).toContain('endpoint-mismatch');
    expect(validateCampus(offsetEdge({ misplaced: false })).errors.filter((e) => e.featureId === OFFSET.EDGE)).toEqual([]);
  });

  it('R20: a bent line costs the same as a straight one (length is node to node)', () => {
    const straightLine = buildGraph(oneWay());
    const bent = structuredClone(oneWay());
    const e = bent.features.map((f) => f.feature as { id: string; geometry: { coordinates: unknown[] } }).find((f) => f.id === ONE_WAY.EDGE)!;
    e.geometry.coordinates = [pos([0, 0]), pos([15, 40]), pos([30, 0])];
    expect(route(buildGraph(bent), ONE_WAY.A, ONE_WAY.B, 'shortest')).toEqual(route(straightLine, ONE_WAY.A, ONE_WAY.B, 'shortest'));
  });

  // ---- R21 (outside the checklist) ----
  it('R21: an unknown profile name is rejected with unknown-profile instead of a route with NaN cost', () => {
    const g = buildGraph(oneWay());
    const bad = 'wheelchair' as Profile;
    expect(findRoute(g, ONE_WAY.A, ONE_WAY.B, bad)).toEqual({
      found: false, profile: 'wheelchair', reason: 'unknown-profile', message: '알 수 없는 길찾기 방식입니다: "wheelchair"',
    });
    expect(findNearest(g, ONE_WAY.A, () => true, bad)).toMatchObject({ found: false, reason: 'unknown-profile' });
    // Checked before the node ids.
    expect(findRoute(g, 'n_nowhere', ONE_WAY.B, bad)).toMatchObject({ found: false, reason: 'unknown-profile' });
  });
});

// Not checklist items: the other step sentences and how steps add up (SPEC-v0.2 3.6).
describe('route steps', () => {
  it('steps cover the whole route: distances, times and edge ids add up', async () => {
    const g = buildGraph(await loadCampus(BASIC_DIR));
    for (const profile of PROFILES) {
      const r = route(g, 'n_out_0001', 'n_B_2_201door', profile);
      expect(r.steps.flatMap((s) => s.edgeIds), profile).toEqual(r.edgeIds);
      expect(r.steps.reduce((a, s) => a + s.distanceM, 0), profile).toBeCloseTo(r.distanceM, 0);
      expect(r.steps.reduce((a, s) => a + s.timeSec, 0), profile).toBeCloseTo(r.timeSec, 0);
    }
  });

  it('portal, walk and elevator sentences (campus-basic, gate → B동 2층 201호, step_free)', async () => {
    const g = buildGraph(await loadCampus(BASIC_DIR));
    const r = route(g, 'n_out_0001', 'n_B_2_201door', 'step_free');
    expect(r.steps.map((s) => s.kind)).toEqual(['walk', 'ramp', 'walk', 'portal', 'walk', 'elevator', 'walk', 'bridge', 'walk']);
    const text = sentences(r);
    expect(text[3]).toBe('A동 4층 출입구로 들어가세요');
    expect(text[5]).toBe('엘리베이터를 타고 3층으로 가세요');
    expect(text[7]).toBe('A동 3층 연결통로를 건너 B동 2층으로 가세요');
    expect(text[0]).toMatch(/^\d+m 걸어가세요$/);
    expect(text[1]).toMatch(/^경사로를 따라 \d+m 가세요$/);
    const out = route(g, 'n_A_4_408door', 'n_out_0001', 'step_free');
    expect(sentences(out)).toContain('A동 4층 출입구로 나가세요');
  });
});

// Not checklist items: these only prove the fixtures model what the R tests assume.
describe('audit fixtures', () => {
  it('tower7 has 6 elevator edges and 6 stair edges, one per neighbouring floor pair', () => {
    const edges = tower7().features.map((f) => f.feature as { properties: Record<string, unknown> }).filter((f) => f.properties['kind'] === 'edge');
    expect(edges.filter((e) => e.properties['highway'] === 'elevator')).toHaveLength(6);
    expect(edges.filter((e) => e.properties['highway'] === 'steps')).toHaveLength(6);
  });

  it('restrooms: the upstairs restroom is nearer in a straight line but costs more to reach', () => {
    const c = restrooms();
    const at = (id: string) => c.features.map((f) => f.feature as { id: string; geometry: { coordinates: [number, number] } }).find((f) => f.id === id)!.geometry.coordinates;
    const g = buildGraph(c);
    const straightTo = (id: string) => {
      const [a, b] = [at(RESTROOMS.START), at(id)];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    expect(straightTo(RESTROOMS.UPSTAIRS)).toBeLessThan(straightTo(RESTROOMS.SAME_FLOOR));
    for (const profile of PROFILES) {
      expect(route(g, RESTROOMS.START, RESTROOMS.SAME_FLOOR, profile).cost)
        .toBeLessThan(route(g, RESTROOMS.START, RESTROOMS.UPSTAIRS, profile).cost);
    }
  });

  it('offsetEdge: the edge line ends 99 m short of its to-node', () => {
    const e = offsetEdge().features.map((f) => f.feature as { id: string; geometry: { coordinates: unknown[] } }).find((f) => f.id === OFFSET.EDGE)!;
    expect(e.geometry.coordinates.at(-1)).toEqual(pos([1, 0]));
    expect(e.geometry.coordinates.at(-1)).not.toEqual(pos([100, 0]));
  });

  it('nullCorridor: one corridor has step_free null, another has no step_free key', () => {
    const edges = nullCorridor().features.map((f) => f.feature as { id: string; properties: Record<string, unknown> });
    expect(edges.find((f) => f.id === NULL_CORRIDOR.EDGE_NULL)!.properties['step_free']).toBeNull();
    expect('step_free' in edges.find((f) => f.id === NULL_CORRIDOR.EDGE_MISSING)!.properties).toBe(false);
  });
});
