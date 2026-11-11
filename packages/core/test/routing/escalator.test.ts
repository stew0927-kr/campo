// Escalators, moving walkways and measured time calibration (task 4.5,
// docs/v0.2/escalator-calibration.md 1~3: SPEC-v0.2 2.7, 3.8, 3.9).
// Numbered after the routing checklist and audit items (R1~R21 in audit.test.ts).
//
// Imports go to the modules directly, not through src/index.ts, so these tests
// only depend on routing code.
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ELEVATOR_ALIGHT_SEC,
  ELEVATOR_BOARD_SEC,
  ESCALATOR_BOARD_SEC,
  ESCALATOR_MIN_SEC,
  ESCALATOR_SLOPE_DEG,
  ESCALATOR_SPEED_MPS,
  FEWEST_STEPS_ESCALATOR_PENALTY_SEC,
  FEWEST_STEPS_STAIRS_PENALTY_SEC,
  PROFILES,
  WALK_SPEED_MPS,
  isStepFreePassable,
  penaltySec,
  stairsTimeSec,
  type Profile,
} from '../../src/costs.ts';
import { buildGraph, carId, predictedTimeSec, straight, type CampusGraph, type GraphLinkData } from '../../src/graph.ts';
import { findRoute, type Route } from '../../src/route.ts';
import { loadCampus } from '../../src/node/index.ts';
import type { Conveying, LoadedCampus } from '../../src/types.ts';
import { building, campus, edge, node, override, prng, randomCampus, stripLevels, tower7, TOWER } from './fixtures/audit.ts';

const BASIC_DIR = fileURLToPath(new URL('../fixtures/campus-basic', import.meta.url));

// campus-basic (fixture added for task 4.5)
const ESC_1 = 'n_A_1_esc';
const ESC_2 = 'n_A_2_esc';
const ESC_UP = 'e_A_1_esc__A_2_esc_up'; // forward, drawn 1층 → 2층
const ESC_DOWN = 'e_A_1_esc__A_2_esc_down'; // backward, drawn 1층 → 2층 too
const OUT_STAIRS = 'e_out_0002__out_0003'; // outdoor steps, bidirectional
const OUT_ESC = 'e_out_0002__out_0003_esc'; // outdoor escalator, forward, parallel to OUT_STAIRS
const OUT_LOW = 'n_out_0002';
const OUT_HIGH = 'n_out_0003';
const RAMP = 'e_out_0004__out_0005'; // the step-free way round the hill
const HALL_1 = 'n_A_1_hall';
const HALL_2 = 'n_A_2_hall';
const STAIRS_12 = 'e_A_1_stair__A_2_stair';
const ELEVATOR_ID = 'A_elevA';

let basic: LoadedCampus;
let g: CampusGraph;
beforeAll(async () => {
  basic = await loadCampus(BASIC_DIR);
  g = buildGraph(basic);
});

function route(graph: CampusGraph, from: string, to: string, profile: Profile): Route {
  const r = findRoute(graph, from, to, profile);
  if (!r.found) throw new Error(`expected a route ${from} → ${to} (${profile}): ${r.message}`);
  return r;
}

/** The walk links of one campus edge, from → to. */
function walkLinks(graph: CampusGraph, from: string, to: string, edgeId: string) {
  return [...(graph.graph.getLinks(from) ?? [])].filter(
    (l) => l.fromId === from && l.toId === to && l.data.kind === 'walk' && l.data.edge.id === edgeId,
  );
}

function linkTime(graph: CampusGraph, from: string, to: string, edgeId: string): number {
  const links = walkLinks(graph, from, to, edgeId);
  expect(links, `${edgeId} ${from} → ${to}`).toHaveLength(1);
  return links[0]!.data.timeSec;
}

/** Every link with its costs, in build order: what calibration may and may not change. */
function linkTable(graph: CampusGraph) {
  const rows: { id: string; kind: GraphLinkData['kind']; timeSec: number; cost: Record<Profile, number>; blocked: Record<Profile, boolean> }[] = [];
  graph.graph.forEachLink((l) => {
    rows.push({ id: String(l.id), kind: l.data.kind, timeSec: l.data.timeSec, cost: { ...l.data.cost }, blocked: { ...l.data.blocked } });
  });
  return rows;
}

/** Plain Dijkstra over the graph links, independent of ngraph.path. */
function dijkstraCost(graph: CampusGraph, from: string, to: string, profile: Profile): number {
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
    for (const link of graph.graph.getLinks(best) ?? []) {
      if (String(link.fromId) !== best || link.data.blocked[profile]) continue;
      const d = bestD + link.data.cost[profile];
      if (d < (dist.get(String(link.toId)) ?? Infinity)) dist.set(String(link.toId), d);
    }
  }
}

function entry(estimate_sec: number) {
  return { prior_sec: 1, median_sec: estimate_sec, n: 3, estimate_sec, updated_at: '2026-11-12' };
}

const escalatorSec = (planM: number) =>
  Math.max(planM / Math.cos((ESCALATOR_SLOPE_DEG * Math.PI) / 180) / ESCALATOR_SPEED_MPS + ESCALATOR_BOARD_SEC, ESCALATOR_MIN_SEC);

// ---- escalatorBank: three floors joined only by escalators (no elevator) ----

const E = {
  hall: (l: number) => `n_E_${l}_hall`,
  esc: (l: number) => `n_E_${l}_esc`,
  up: (l: number) => `e_E_${l}_esc__E_${l + 1}_esc_up`,
  down: (l: number) => `e_E_${l}_esc__E_${l + 1}_esc_down`,
  hallToEsc: (l: number) => `e_E_${l}_hall__E_${l}_esc`,
} as const;

interface BankOptions {
  /** A corridor leaves the 2층 landing between the two escalators (default true). */
  branchAtMiddle?: boolean;
  /** conveying of the up edges (default forward). */
  up?: Conveying;
  /** Add a parallel backward (down) edge next to each up edge (default true). */
  downPair?: boolean;
  /** 2층 → 3층 is plain stairs instead of escalators (default false). */
  stairsTo3?: boolean;
  /** incline on the escalator edges (default 'up'; null leaves it out). */
  incline?: 'up' | null;
}

/**
 * "E동": landings n_E_{1,2,3}_esc stacked 7 m apart in plan, joined by
 * escalators drawn from the lower floor (incline up). Halls on 1층 and 3층
 * (and 2층 if branchAtMiddle) join the landing by a corridor.
 */
function escalatorBank({ branchAtMiddle = true, up = 'forward', downPair = true, stairsTo3 = false, incline = 'up' }: BankOptions = {}): LoadedCampus {
  const specs: Parameters<typeof campus>[0] = [building('bldg_E', 'E동', 'E', [1, 2, 3])];
  const inc = incline === null ? {} : { incline };
  for (const l of [1, 2, 3]) {
    const where = { building_id: 'bldg_E', level: l };
    specs.push(node(E.esc(l), [0, 7 * (l - 1)], { node_type: 'corridor', ...where }));
    if (l !== 2 || branchAtMiddle) {
      specs.push(node(E.hall(l), [-5, 7 * (l - 1)], { node_type: 'corridor', ...where }));
      specs.push(edge(E.hallToEsc(l), E.hall(l), E.esc(l)));
    }
  }
  for (const l of [1, 2]) {
    const levels = { level_from: l, level_to: l + 1 };
    if (l === 2 && stairsTo3) {
      specs.push(edge('e_E_2_esc__E_3_esc_stairs', E.esc(2), E.esc(3), { highway: 'steps', step_free: false, ...levels, ...inc }));
      continue;
    }
    specs.push(edge(E.up(l), E.esc(l), E.esc(l + 1), {
      highway: 'steps', step_free: false, conveying: up, bidirectional: up === 'reversible', ...levels, ...inc,
    }));
    if (downPair) {
      specs.push(edge(E.down(l), E.esc(l), E.esc(l + 1), {
        highway: 'steps', step_free: false, conveying: 'backward', bidirectional: false, ...levels, ...inc,
      }));
    }
  }
  return campus(specs);
}

/** Outdoor A (0,0) and B (30,0) joined by one footway or corridor edge with `conveying` (a moving walkway). */
function movingWalkway(conveying: Conveying, bidirectional: boolean): LoadedCampus {
  return campus([
    node('n_out_WA', [0, 0], { node_type: 'outdoor' }),
    node('n_out_WB', [30, 0], { node_type: 'outdoor' }),
    edge('e_out_WA__out_WB', 'n_out_WA', 'n_out_WB', { highway: 'footway', edge_type: 'outdoor', conveying, bidirectional }),
  ]);
}

function setProps(c: LoadedCampus, id: string, patch: Record<string, unknown>): LoadedCampus {
  const copy = structuredClone(c);
  const f = copy.features.map((x) => x.feature as { id: string; properties: Record<string, unknown> }).find((x) => x.id === id);
  if (!f) throw new Error(`no feature ${id}`);
  Object.assign(f.properties, patch);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete f.properties[k];
  return copy;
}

describe('escalators (SPEC-v0.2 2.7, 3.8)', () => {
  it('R22: a down (backward) escalator is never ridden up: A동 1→2층 backward edge links 2층 → 1층 only', () => {
    // Both edges are drawn n_A_1_esc → n_A_2_esc; conveying decides the direction.
    expect(walkLinks(g, ESC_1, ESC_2, ESC_UP)).toHaveLength(1);
    expect(walkLinks(g, ESC_2, ESC_1, ESC_UP)).toHaveLength(0);
    expect(walkLinks(g, ESC_1, ESC_2, ESC_DOWN)).toHaveLength(0);
    expect(walkLinks(g, ESC_2, ESC_1, ESC_DOWN)).toHaveLength(1);
    // Going up, no profile ever uses the down escalator, even with the up one closed.
    const upClosed = buildGraph(basic, { overrides: [override(ESC_UP)] });
    for (const profile of PROFILES) {
      for (const graph of [g, upClosed]) {
        const r = route(graph, ESC_1, ESC_2, profile);
        expect(r.edgeIds, profile).not.toContain(ESC_DOWN);
      }
    }
    expect(route(g, ESC_1, ESC_2, 'shortest').edgeIds).toEqual([ESC_UP]);
    expect(route(upClosed, ESC_1, ESC_2, 'shortest').edgeIds).not.toContain(ESC_UP);
    // Going down it is the down escalator, and never the up one.
    expect(route(g, ESC_2, ESC_1, 'shortest').edgeIds).toEqual([ESC_DOWN]);
    const downClosed = buildGraph(basic, { overrides: [override(ESC_DOWN)] });
    expect(route(downClosed, ESC_2, ESC_1, 'shortest').edgeIds).not.toContain(ESC_UP);
    // The outdoor escalator (forward) is never ridden down the hill.
    for (const profile of PROFILES) expect(route(g, OUT_HIGH, OUT_LOW, profile).edgeIds, profile).not.toContain(OUT_ESC);
  });

  it('R23: conveying sets the links and bidirectional is not read: forward from → to, backward to → from, reversible both', () => {
    const cases: [Conveying, boolean, [boolean, boolean]][] = [
      ['forward', false, [true, false]], ['forward', true, [true, false]],
      ['backward', false, [false, true]], ['backward', true, [false, true]],
      ['reversible', true, [true, true]], ['reversible', false, [true, true]],
    ];
    for (const [conveying, bidirectional, [along, against]] of cases) {
      const c = setProps(basic, ESC_DOWN, { conveying, bidirectional });
      const graph = buildGraph(c);
      const label = `${conveying} bidirectional ${bidirectional}`;
      expect(walkLinks(graph, ESC_1, ESC_2, ESC_DOWN).length, label).toBe(along ? 1 : 0);
      expect(walkLinks(graph, ESC_2, ESC_1, ESC_DOWN).length, label).toBe(against ? 1 : 0);
    }
    // Without conveying the edge is a plain flight again: bidirectional decides.
    const plain = buildGraph(setProps(basic, ESC_DOWN, { conveying: undefined, bidirectional: true }));
    expect(walkLinks(plain, ESC_1, ESC_2, ESC_DOWN)).toHaveLength(1);
    expect(walkLinks(plain, ESC_2, ESC_1, ESC_DOWN)).toHaveLength(1);
    // A value that is not one of the three is treated as missing (unvalidated data).
    const junk = buildGraph(setProps(basic, ESC_DOWN, { conveying: 'sideways', bidirectional: true }));
    expect(walkLinks(junk, ESC_1, ESC_2, ESC_DOWN)).toHaveLength(1);
    expect(walkLinks(junk, ESC_2, ESC_1, ESC_DOWN)).toHaveLength(1);

    // Moving walkway (footway + conveying): direction from conveying, time is walking time.
    const walkway = buildGraph(movingWalkway('forward', true));
    const [link] = walkLinks(walkway, 'n_out_WA', 'n_out_WB', 'e_out_WA__out_WB');
    expect(link!.data.timeSec).toBeCloseTo(30 / WALK_SPEED_MPS, 1);
    expect(walkLinks(walkway, 'n_out_WB', 'n_out_WA', 'e_out_WA__out_WB')).toHaveLength(0);
    for (const profile of PROFILES) {
      expect(findRoute(walkway, 'n_out_WB', 'n_out_WA', profile), profile).toMatchObject({ found: false, reason: 'no-route' });
      const r = route(walkway, 'n_out_WA', 'n_out_WB', profile);
      expect(r.cost, profile).toBe(r.timeSec); // not steps: no penalty in any profile
      expect([r.stairsCount, r.escalatorCount], profile).toEqual([0, 0]);
    }
    const both = buildGraph(movingWalkway('reversible', false));
    expect(walkLinks(both, 'n_out_WB', 'n_out_WA', 'e_out_WA__out_WB')).toHaveLength(1);
    expect(route(both, 'n_out_WB', 'n_out_WA', 'shortest').steps.map((s) => s.text)).toEqual(['30m 걸어가세요 (운행 방향이 바뀔 수 있습니다)']);
  });

  it('R23: a reversible escalator links both ways and its sentence says the direction can change', () => {
    const graph = buildGraph(escalatorBank({ up: 'reversible', downPair: false, branchAtMiddle: false }));
    const up = route(graph, E.hall(1), E.hall(3), 'shortest');
    expect(up.edgeIds).toEqual([E.hallToEsc(1), E.up(1), E.up(2), E.hallToEsc(3)]);
    expect(up.steps.map((s) => s.text)).toContain('에스컬레이터를 타고 3층으로 올라가세요 (운행 방향이 바뀔 수 있습니다)');
    const down = route(graph, E.hall(3), E.hall(1), 'shortest');
    expect(down.edgeIds).toEqual([E.hallToEsc(3), E.up(2), E.up(1), E.hallToEsc(1)]);
    expect(down.steps.map((s) => s.text)).toContain('에스컬레이터를 타고 1층으로 내려가세요 (운행 방향이 바뀔 수 있습니다)');
    // forward / backward escalators carry no such note.
    const fixed = route(g, ESC_2, ESC_1, 'shortest');
    expect(fixed.steps.map((s) => s.text)).toEqual(['에스컬레이터를 타고 1층으로 내려가세요']);
  });

  it('R24: step_free blocks every escalator link, even one wrongly marked step_free: true', () => {
    let escalatorLinks = 0;
    g.graph.forEachLink((l) => {
      if (l.data.kind !== 'walk' || l.data.edge.properties.conveying === undefined) return;
      escalatorLinks++;
      expect(l.data.blocked.step_free, l.data.edge.id).toBe(true);
      expect(l.data.blocked.shortest, l.data.edge.id).toBe(false);
      expect(l.data.blocked.fewest_steps, l.data.edge.id).toBe(false);
    });
    expect(escalatorLinks).toBe(3); // A동 up, A동 down, outdoor
    expect(isStepFreePassable({ highway: 'steps', step_free: true, conveying: 'forward' } as never)).toBe(false);
    const wrong = buildGraph(setProps(basic, ESC_UP, { step_free: true }));
    expect(walkLinks(wrong, ESC_1, ESC_2, ESC_UP)[0]!.data.blocked.step_free).toBe(true);
    // A동 1→2층 step_free takes the elevator: no escalator, no fallback.
    for (const graph of [g, wrong]) {
      const r = route(graph, ESC_1, ESC_2, 'step_free');
      expect(r.fallback).toBeNull();
      expect(r.edgeIds).not.toContain(ESC_UP);
      expect(r.edgeIds).toContain('e_A_elevA_L1__A_elevA_L2');
      expect(r.escalatorCount).toBe(0);
    }
    // Outdoor: up the hill step_free goes round by the ramp.
    expect(route(g, OUT_LOW, OUT_HIGH, 'step_free').edgeIds).toContain(RAMP);
  });

  it('R25: fewest_steps prefers an escalator (60 s penalty) to stairs (600 s): parallel outdoor pair', () => {
    expect(FEWEST_STEPS_ESCALATOR_PENALTY_SEC).toBe(60);
    expect(FEWEST_STEPS_STAIRS_PENALTY_SEC).toBe(600);
    expect(penaltySec({ highway: 'steps', step_free: false, conveying: 'forward' }, 'fewest_steps')).toBe(60);
    expect(penaltySec({ highway: 'steps', step_free: false }, 'fewest_steps')).toBe(600);
    expect(penaltySec({ highway: 'steps', step_free: false, conveying: 'forward' }, 'shortest')).toBe(0);
    expect(penaltySec({ highway: 'footway', step_free: true, conveying: 'forward' }, 'fewest_steps')).toBe(0);
    // The escalator link and the stairs link between the same two outdoor points.
    const [esc] = walkLinks(g, OUT_LOW, OUT_HIGH, OUT_ESC);
    const [stairs] = walkLinks(g, OUT_LOW, OUT_HIGH, OUT_STAIRS);
    expect(esc!.data.cost.fewest_steps - esc!.data.timeSec).toBeCloseTo(60, 9);
    expect(stairs!.data.cost.fewest_steps - stairs!.data.timeSec).toBeCloseTo(600, 9);
    // The ramp round the hill (≈ 130 s) still beats the escalator (≈ 83 s + 60 s) in fewest_steps; close it.
    expect(route(g, OUT_LOW, OUT_HIGH, 'fewest_steps').edgeIds).toContain(RAMP);
    const noRamp = buildGraph(basic, { overrides: [override(RAMP)] });
    const fewest = route(noRamp, OUT_LOW, OUT_HIGH, 'fewest_steps');
    expect(fewest.edgeIds).toEqual([OUT_ESC]);
    expect(fewest.cost - fewest.timeSec).toBeCloseTo(60, 1);
    expect([fewest.stairsCount, fewest.escalatorCount]).toEqual([0, 1]);
    // shortest takes the faster stairs (69 s) over the escalator (≈ 83 s).
    expect(route(noRamp, OUT_LOW, OUT_HIGH, 'shortest').edgeIds).toEqual([OUT_STAIRS]);
  });

  it('R25: fewest_steps prefers an escalator to stairs indoors (A동 1→2층, elevator closed)', () => {
    const noLift = buildGraph(basic, { overrides: [override('n_A_elevA_L1')] });
    // From the 1층 landing the stairs are right there: shortest climbs them.
    const shortest = route(noLift, 'n_A_1_stair', 'n_A_2_stair', 'shortest');
    expect(shortest.edgeIds).toEqual([STAIRS_12]);
    const fewest = route(noLift, 'n_A_1_stair', 'n_A_2_stair', 'fewest_steps');
    expect(fewest.edgeIds).toContain(ESC_UP);
    expect(fewest.edgeIds).not.toContain(STAIRS_12);
    expect(fewest.cost - fewest.timeSec).toBeCloseTo(FEWEST_STEPS_ESCALATOR_PENALTY_SEC, 1);
    expect([fewest.stairsCount, fewest.escalatorCount]).toEqual([0, 1]);
    // With the elevator running, fewest_steps rides it (no penalty at all).
    expect(route(g, 'n_A_1_stair', 'n_A_2_stair', 'fewest_steps').edgeIds).toContain('e_A_elevA_L1__A_elevA_L2');
  });

  it('R25: the step_free fallback counts escalators apart from stairs and names them ("에스컬레이터 N곳")', () => {
    const onlyEscalators = route(buildGraph(escalatorBank()), E.hall(1), E.hall(3), 'step_free');
    expect(onlyEscalators.fallback).toEqual({
      profile: 'fewest_steps', stairsCount: 0, escalatorCount: 2, barrierCount: 0,
      message: '계단 없는 경로가 없어 에스컬레이터를 타는 경로를 안내합니다. 에스컬레이터 2곳을 피할 수 없습니다.',
    });
    expect([onlyEscalators.stairsCount, onlyEscalators.escalatorCount]).toEqual([0, 2]);
    const mixed = route(buildGraph(escalatorBank({ stairsTo3: true })), E.hall(1), E.hall(3), 'step_free');
    expect(mixed.fallback).toEqual({
      profile: 'fewest_steps', stairsCount: 1, escalatorCount: 1, barrierCount: 0,
      message: '계단 없는 경로가 없어 계단이 가장 적은 경로를 안내합니다. 계단 1곳, 에스컬레이터 1곳을 피할 수 없습니다.',
    });
    expect([mixed.stairsCount, mixed.escalatorCount]).toEqual([1, 1]);
  });

  it('R26: shortest takes whichever is faster: the escalator indoors (A동 1→2층), the stairs outdoors', () => {
    const viaEscalator = route(g, HALL_1, HALL_2, 'shortest');
    expect(viaEscalator.edgeIds).toEqual(['e_A_1_hall__A_1_esc', ESC_UP, 'e_A_2_hall__A_2_esc']);
    expect(viaEscalator.cost).toBe(viaEscalator.timeSec);
    const noEscalator = route(buildGraph(basic, { overrides: [override(ESC_UP)] }), HALL_1, HALL_2, 'shortest');
    expect(noEscalator.edgeIds).toContain(STAIRS_12);
    expect(viaEscalator.timeSec).toBeLessThan(noEscalator.timeSec);
    // Outdoors the escalator (≈ 83 s) is slower than the 34.5 m flight (69 s).
    const outdoor = route(g, OUT_LOW, OUT_HIGH, 'shortest');
    expect(outdoor.edgeIds).toEqual([OUT_STAIRS]);
    const noStairs = route(buildGraph(basic, { overrides: [override(OUT_STAIRS)] }), OUT_LOW, OUT_HIGH, 'shortest');
    expect(noStairs.edgeIds).toEqual([OUT_ESC]);
    expect(outdoor.timeSec).toBeLessThan(noStairs.timeSec);
  });

  it('R27: escalator time is max(plan / cos 30° / 0.5 m/s + 3 s, 8 s): about 19 s for one indoor floor, no downhill factor', () => {
    expect([ESCALATOR_SPEED_MPS, ESCALATOR_BOARD_SEC, ESCALATOR_MIN_SEC, ESCALATOR_SLOPE_DEG]).toEqual([0.5, 3, 8, 30]);
    const t = (planLengthM: number, traversal: 'along' | 'against' = 'along', extra: Record<string, unknown> = {}) => stairsTimeSec({
      edge: { edge_type: 'indoor', conveying: 'forward', incline: 'up', ...extra },
      endNodeTypes: ['stair_landing', 'stair_landing'],
      planLengthM,
      traversal,
    });
    // One floor of about 4 m: plan ≈ 6.9 m → ≈ 19 s.
    expect(t(6.9)).toBeCloseTo(6.9 / Math.cos(Math.PI / 6) / 0.5 + 3, 9);
    expect(t(6.9)).toBeCloseTo(18.9, 1);
    expect(t(6.7)).toBeCloseTo(18.5, 1);
    // Too short in plan: the minimum.
    expect(t(0)).toBe(ESCALATOR_MIN_SEC);
    expect(t(1)).toBe(ESCALATOR_MIN_SEC);
    expect(t(2.6)).toBeCloseTo(9.0, 1);
    // No downhill factor; step_count, flight_sec and the edge type are not read.
    expect(t(6.9, 'against')).toBe(t(6.9));
    expect(t(6.9, 'along', { incline: 'down' })).toBe(t(6.9));
    expect(t(6.9, 'along', { step_count: 30, flight_sec: 25 })).toBe(t(6.9));
    expect(t(6.9, 'along', { edge_type: 'outdoor' })).toBe(t(6.9));
    for (const conveying of ['backward', 'reversible']) expect(t(6.9, 'along', { conveying })).toBe(t(6.9));

    // campus-basic A동 1→2층: about 6.7 m in plan, about 18.4 s, both escalators, both directions they run.
    const [upLink] = walkLinks(g, ESC_1, ESC_2, ESC_UP);
    if (upLink?.data.kind !== 'walk') throw new Error('missing link');
    expect(upLink.data.lengthM).toBeGreaterThan(6.6);
    expect(upLink.data.lengthM).toBeLessThan(6.9);
    expect(upLink.data.timeSec).toBeCloseTo(escalatorSec(upLink.data.lengthM), 9);
    expect(upLink.data.timeSec).toBeGreaterThan(18);
    expect(upLink.data.timeSec).toBeLessThan(19.5);
    expect(linkTime(g, ESC_2, ESC_1, ESC_DOWN)).toBe(upLink.data.timeSec);
    // The outdoor escalator (34.5 m in plan): same rule, not the outdoor stairs rule.
    const [out] = walkLinks(g, OUT_LOW, OUT_HIGH, OUT_ESC);
    if (out?.data.kind !== 'walk') throw new Error('missing link');
    expect(out.data.timeSec).toBeCloseTo(escalatorSec(out.data.lengthM), 9);
    expect(out.data.timeSec).toBeCloseTo(82.7, 0);
  });

  it('R28: escalator steps are their own kind, merged like stairs, with incline / floor / no direction words', () => {
    const r = route(g, HALL_1, HALL_2, 'shortest');
    expect(r.steps.map((s) => s.kind)).toEqual(['walk', 'escalator', 'walk']);
    expect(r.steps[1]).toMatchObject({ edgeIds: [ESC_UP], fromLevel: 1, toLevel: 2, text: '에스컬레이터를 타고 2층으로 올라가세요' });
    expect(r.stairsCount).toBe(0);
    expect(r.escalatorCount).toBe(1);

    // Two escalators through a landing with no other exit: one sentence. The parallel down
    // escalators touching that landing do not split it.
    const chained = buildGraph(escalatorBank({ branchAtMiddle: false }));
    const up = route(chained, E.hall(1), E.hall(3), 'shortest');
    expect(up.steps.map((s) => [s.kind, s.text])).toEqual([
      ['walk', '5m 걸어가세요'], ['escalator', '에스컬레이터를 타고 3층으로 올라가세요'], ['walk', '5m 걸어가세요'],
    ]);
    expect(up.steps[1]!.edgeIds).toEqual([E.up(1), E.up(2)]);
    expect([up.stairsCount, up.escalatorCount]).toEqual([0, 2]);
    // Down by the backward edges: drawn upward with incline up, ridden against the drawing → 내려가세요.
    const down = route(chained, E.hall(3), E.hall(1), 'shortest');
    expect(down.edgeIds).toEqual([E.hallToEsc(3), E.down(2), E.down(1), E.hallToEsc(1)]);
    expect(down.steps.map((s) => s.text)).toContain('에스컬레이터를 타고 1층으로 내려가세요');
    // A corridor at the 2층 landing splits the ride into two sentences (same rule as stairs).
    const branched = route(buildGraph(escalatorBank()), E.hall(1), E.hall(3), 'shortest');
    expect(branched.steps.filter((s) => s.kind === 'escalator').map((s) => s.text)).toEqual([
      '에스컬레이터를 타고 2층으로 올라가세요', '에스컬레이터를 타고 3층으로 올라가세요',
    ]);
    // An escalator next to plain stairs: separate steps.
    const mixed = route(buildGraph(escalatorBank({ stairsTo3: true })), E.hall(1), E.hall(3), 'shortest');
    expect(mixed.steps.map((s) => s.kind)).toEqual(['walk', 'escalator', 'stairs', 'walk']);
    expect(mixed.steps.map((s) => s.text).slice(1, 3)).toEqual(['에스컬레이터를 타고 2층으로 올라가세요', '계단으로 1층 올라가세요']);

    // Direction words: incline first, then display floors, else none.
    const blind = buildGraph(stripLevels(escalatorBank({ branchAtMiddle: false })).campus);
    expect(route(blind, E.hall(1), E.hall(3), 'shortest').steps.map((s) => s.text)).toContain('에스컬레이터를 타고 올라가세요');
    expect(route(blind, E.hall(3), E.hall(1), 'shortest').steps.map((s) => s.text)).toContain('에스컬레이터를 타고 내려가세요');
    const noIncline = escalatorBank({ branchAtMiddle: false, incline: null });
    expect(route(buildGraph(noIncline), E.hall(3), E.hall(1), 'shortest').steps.map((s) => s.text)).toContain('에스컬레이터를 타고 1층으로 내려가세요');
    expect(route(buildGraph(stripLevels(noIncline).campus), E.hall(1), E.hall(3), 'shortest').steps.map((s) => s.text))
      .toContain('에스컬레이터를 타고 이동하세요');
    // Outdoors there are no floors: the incline alone.
    const outdoor = route(buildGraph(basic, { overrides: [override(OUT_STAIRS)] }), OUT_LOW, OUT_HIGH, 'shortest');
    expect(outdoor.steps.map((s) => [s.kind, s.text])).toEqual([['escalator', '에스컬레이터를 타고 올라가세요']]);
    // Steps still add up to the route.
    for (const x of [r, up, down, branched, mixed, outdoor]) {
      expect(x.steps.flatMap((s) => s.edgeIds)).toEqual(x.edgeIds);
      expect(x.steps.reduce((a, s) => a + s.timeSec, 0)).toBeCloseTo(x.timeSec, 0);
    }
  });
});

describe('measured time calibration (SPEC-v0.2 3.9)', () => {
  it('R29: calibration replaces timeSec only; every link keeps its penalty (cost − timeSec) and blocking', () => {
    const calibration: Record<string, unknown> = {
      [`edge:${ESC_UP}`]: entry(25),
      [`edge:${OUT_STAIRS}`]: entry(80),
      [`edge:${OUT_ESC}`]: entry(70),
      'edge:e_A_1_hall__A_1_esc': entry(9),
      [`elevator:${ELEVATOR_ID}`]: entry(55),
    };
    const cal = buildGraph(basic, { calibration });
    expect(linkTime(cal, ESC_1, ESC_2, ESC_UP)).toBe(25);
    expect(linkTime(cal, OUT_LOW, OUT_HIGH, OUT_STAIRS)).toBe(80);
    expect(linkTime(cal, OUT_LOW, OUT_HIGH, OUT_ESC)).toBe(70);
    expect(linkTime(cal, HALL_1, ESC_1, 'e_A_1_hall__A_1_esc')).toBe(9);
    // The other direction of a bidirectional edge has its own key (#backward) and is left alone.
    expect(linkTime(cal, OUT_HIGH, OUT_LOW, OUT_STAIRS)).toBe(linkTime(g, OUT_HIGH, OUT_LOW, OUT_STAIRS));
    expect(linkTime(cal, ESC_1, HALL_1, 'e_A_1_hall__A_1_esc')).toBe(linkTime(g, ESC_1, HALL_1, 'e_A_1_hall__A_1_esc'));

    const before = linkTable(g);
    const after = linkTable(cal);
    expect(after.map((r) => [r.id, r.kind])).toEqual(before.map((r) => [r.id, r.kind]));
    let changed = 0;
    after.forEach((row, i) => {
      const old = before[i]!;
      if (row.timeSec !== old.timeSec) changed++;
      expect(row.blocked, row.id).toEqual(old.blocked);
      for (const p of PROFILES) expect(row.cost[p] - row.timeSec, `${row.id} ${p}`).toBeCloseTo(old.cost[p] - old.timeSec, 9);
    });
    expect(changed).toBe(4 + 4); // four walk links, four board links (one per A동 stop)
    // In a route: the escalator ride now takes 25 s; fewest_steps still pays its 60 s on top.
    const fewest = route(cal, ESC_1, ESC_2, 'fewest_steps');
    expect(fewest.edgeIds).toEqual([ESC_UP]);
    expect([fewest.timeSec, fewest.cost]).toEqual([25, 85]);
    const shortest = route(cal, ESC_1, ESC_2, 'shortest');
    expect([shortest.timeSec, shortest.cost]).toEqual([25, 25]);
    // The default is campus.calibration (calibration.json); an explicit option replaces it.
    expect(linkTable(buildGraph({ ...basic, calibration }))).toEqual(after);
    expect(linkTable(buildGraph({ ...basic, calibration }, { calibration: {} }))).toEqual(before);
  });

  it('R29: a calibrated time changes the route choice (a slow measured escalator loses to the stairs)', () => {
    expect(route(g, HALL_1, HALL_2, 'shortest').edgeIds).toContain(ESC_UP);
    const slow = buildGraph(basic, { calibration: { [`edge:${ESC_UP}`]: entry(40) } });
    const r = route(slow, HALL_1, HALL_2, 'shortest');
    expect(r.edgeIds).toContain(STAIRS_12);
    expect(r.edgeIds).not.toContain(ESC_UP);
  });

  it('R30: elevator calibration replaces the wait on that elevator\'s board links only (hop and alight unchanged)', () => {
    const cal = buildGraph(basic, { calibration: { [`elevator:${ELEVATOR_ID}`]: entry(70) } });
    const stops = [...cal.nodes.values()].filter((n) => n.properties.elevator_id === ELEVATOR_ID).map((n) => n.id);
    expect(stops).toHaveLength(4);
    let boards = 0;
    cal.graph.forEachLink((l) => {
      if (l.data.kind === 'board') {
        boards++;
        expect(stops).toContain(l.data.stopId);
        expect(l.data.timeSec).toBe(70);
        expect(l.data.cost).toEqual({ shortest: 70, step_free: 70, fewest_steps: 70 });
      }
      if (l.data.kind === 'alight') expect(l.data.timeSec).toBe(ELEVATOR_ALIGHT_SEC);
    });
    expect(boards).toBe(4);
    // Only the board links changed.
    const before = linkTable(g);
    linkTable(cal).forEach((row, i) => {
      if (row.kind !== 'board') expect(row, row.id).toEqual(before[i]);
    });
    const plain = route(g, HALL_1, 'n_A_4_hall', 'step_free');
    const measured = route(cal, HALL_1, 'n_A_4_hall', 'step_free');
    expect(measured.edgeIds).toEqual(plain.edgeIds);
    expect(measured.timeSec - plain.timeSec).toBeCloseTo(70 - ELEVATOR_BOARD_SEC, 1);
    // Another elevator's key, or an edge key on an elevator edge, leaves this one alone.
    const other = buildGraph(basic, { calibration: { 'elevator:T-EV1': entry(70), 'edge:e_A_elevA_L1__A_elevA_L2': entry(70) } });
    expect(linkTable(other)).toEqual(before);
    // And the key works on any elevator: tower7's.
    const t = buildGraph(tower7(), { calibration: { [`elevator:${TOWER.ELEVATOR_ID}`]: entry(20) } });
    const board = [...(t.graph.getLinks(TOWER.stop(3)) ?? [])].find((l) => l.data.kind === 'board')!;
    expect(board.toId).toBe(carId(TOWER.stop(3)));
    expect(board.data.timeSec).toBe(20);
  });

  it('R31: the #backward key calibrates the against-the-drawing link of a two-way edge only', () => {
    const cal = buildGraph(basic, { calibration: { [`edge:${OUT_STAIRS}#backward`]: entry(30) } });
    expect(linkTime(cal, OUT_HIGH, OUT_LOW, OUT_STAIRS)).toBe(30);
    expect(linkTime(cal, OUT_LOW, OUT_HIGH, OUT_STAIRS)).toBe(linkTime(g, OUT_LOW, OUT_HIGH, OUT_STAIRS));
    // A backward escalator is ridden against its drawing, so its measured key is #backward.
    const down = buildGraph(basic, { calibration: { [`edge:${ESC_DOWN}#backward`]: entry(22), [`edge:${ESC_DOWN}`]: entry(99) } });
    expect(linkTime(down, ESC_2, ESC_1, ESC_DOWN)).toBe(22);
    // A forward-only escalator has no backward link: its #backward key changes nothing.
    const none = buildGraph(basic, { calibration: { [`edge:${OUT_ESC}#backward`]: entry(5) } });
    expect(linkTable(none)).toEqual(linkTable(g));
  });

  it('R32: no calibration, or one with the wrong shape, gives exactly the uncalibrated graph and routes', () => {
    const before = linkTable(g);
    const key = `edge:${ESC_UP}`;
    const junk: unknown[] = [
      undefined, null, 'calibration', 7, true, [], [entry(25)], {},
      { [key]: null }, { [key]: 25 }, { [key]: 'x' }, { [key]: [] },
      { [key]: { estimate_sec: '25' } }, { [key]: { estimate_sec: 0 } }, { [key]: { estimate_sec: -3 } },
      { [key]: { estimate_sec: Number.NaN } }, { [key]: { estimate_sec: Number.POSITIVE_INFINITY } },
      { [key]: { median_sec: 25 } }, { 'edge:n_nowhere': entry(25), 'elevator:none': entry(25), 'stairs:x': entry(25), [ESC_UP]: entry(25) },
    ];
    for (const calibration of junk) {
      const label = JSON.stringify(calibration) ?? String(calibration);
      expect(linkTable(buildGraph(basic, { calibration })), label).toEqual(before);
      expect(linkTable(buildGraph({ ...basic, calibration })), label).toEqual(before);
    }
    // A valid entry next to junk ones is still used.
    expect(linkTime(buildGraph(basic, { calibration: { [key]: entry(25), x: null, [`edge:${OUT_ESC}`]: { estimate_sec: -1 } } }), ESC_1, ESC_2, ESC_UP)).toBe(25);
    // Routes are the same too.
    const r = findRoute(buildGraph(basic, { calibration: { [key]: { estimate_sec: 0 } } }), 'n_out_0001', 'n_A_4_408door', 'shortest');
    expect(r).toEqual(findRoute(g, 'n_out_0001', 'n_A_4_408door', 'shortest'));
  });

  it('R33: calibrated graphs keep A* exact: A* cost equals Dijkstra cost, and no link beats heuristicSpeedMps', () => {
    let compared = 0;
    let fasterThanWalking = 0;
    const check = (graph: CampusGraph, ids: string[], rnd: () => number, pairs: number) => {
      graph.graph.forEachLink((link) => {
        const planM = straight(graph.graph.getNode(link.fromId)!.data.position, graph.graph.getNode(link.toId)!.data.position);
        for (const p of PROFILES) expect(planM / graph.heuristicSpeedMps, String(link.id)).toBeLessThanOrEqual(link.data.cost[p] + 1e-9);
        if (planM / WALK_SPEED_MPS > link.data.timeSec + 1e-9) fasterThanWalking++;
      });
      for (let k = 0; k < pairs; k++) {
        const from = ids[Math.floor(rnd() * ids.length)]!;
        const to = ids[Math.floor(rnd() * ids.length)]!;
        for (const p of ['shortest', 'fewest_steps'] as const) {
          const d = dijkstraCost(graph, from, to, p);
          const r = findRoute(graph, from, to, p);
          const label = `${from} → ${to} ${p}`;
          if (d === Infinity) {
            expect(r.found, label).toBe(false);
          } else {
            expect(r.found, label).toBe(true);
            expect(Math.abs((r as Route).cost - d), label).toBeLessThanOrEqual(0.05 + 1e-9);
          }
          compared++;
        }
      }
    };
    /** Random estimates (0.2 s … 120 s) for about half of the edges in both directions, and every elevator. */
    const randomCalibration = (c: LoadedCampus, rnd: () => number) => {
      const cal: Record<string, unknown> = {};
      for (const { feature } of c.features) {
        const f = feature as { id: string; properties: Record<string, unknown> };
        if (f.properties['kind'] === 'edge') {
          if (rnd() < 0.5) cal[`edge:${f.id}`] = entry(0.2 + rnd() * 120);
          if (rnd() < 0.5) cal[`edge:${f.id}#backward`] = entry(0.2 + rnd() * 120);
        }
        const elevatorId = f.properties['elevator_id'];
        if (typeof elevatorId === 'string') cal[`elevator:${elevatorId}`] = entry(1 + rnd() * 90);
      }
      return cal;
    };
    const basicIds = [...g.nodes.keys()];
    for (let seed = 1; seed <= 20; seed++) {
      const rnd = prng(seed * 31337);
      check(buildGraph(basic, { calibration: randomCalibration(basic, rnd) }), basicIds, rnd, 10);
    }
    for (let seed = 1; seed <= 100; seed++) {
      const { campus: c, nodeIds } = randomCampus(seed);
      const rnd = prng(seed * 65537);
      check(buildGraph(c, { calibration: randomCalibration(c, rnd) }), nodeIds, rnd, 3);
    }
    expect(compared).toBe(20 * 10 * 2 + 100 * 3 * 2);
    // Calibration made links faster than walking, so the heuristic speed had to follow.
    expect(fasterThanWalking).toBeGreaterThan(100);
  });

  it('R34: predictedTimeSec reads the uncalibrated prior of a target from the graph', () => {
    const prior = buildGraph(basic, { calibration: {} });
    // Edge targets: the link timeSec in the asked direction (default forward = as drawn).
    expect(predictedTimeSec(prior, `edge:${ESC_UP}`)).toBe(linkTime(prior, ESC_1, ESC_2, ESC_UP));
    expect(predictedTimeSec(prior, `edge:${ESC_UP}`, 'forward')).toBeCloseTo(escalatorSec(6.67), 1);
    expect(predictedTimeSec(prior, `edge:${OUT_STAIRS}`, 'forward')).toBe(linkTime(prior, OUT_LOW, OUT_HIGH, OUT_STAIRS));
    expect(predictedTimeSec(prior, `edge:${OUT_STAIRS}`, 'forward')).toBeCloseTo(69, 0);
    expect(predictedTimeSec(prior, `edge:${OUT_STAIRS}`, 'backward')).toBe(linkTime(prior, OUT_HIGH, OUT_LOW, OUT_STAIRS));
    // These outdoor stairs have no incline, so both ways count as up (SPEC-v0.2 3.1 rule 4).
    expect(predictedTimeSec(prior, `edge:${OUT_STAIRS}`, 'backward')).toBe(predictedTimeSec(prior, `edge:${OUT_STAIRS}`, 'forward'));
    // The A동 1층 → 2층 flight has no incline either; the B동 one (incline up) is quicker going down.
    expect(predictedTimeSec(prior, 'edge:e_B_1_stair__B_2_stair', 'forward')).toBe(20);
    expect(predictedTimeSec(prior, 'edge:e_B_1_stair__B_2_stair', 'backward')).toBeCloseTo(20 * (2 / 3), 9);
    expect(predictedTimeSec(prior, `edge:${ESC_DOWN}`, 'backward')).toBe(linkTime(prior, ESC_2, ESC_1, ESC_DOWN));
    expect(predictedTimeSec(prior, 'edge:e_portal_A_4_north')).toBe(linkTime(prior, 'n_A_4_north', 'n_out_0003', 'e_portal_A_4_north'));
    // No link that way, or no such edge: undefined.
    expect(predictedTimeSec(prior, `edge:${ESC_UP}`, 'backward')).toBeUndefined();
    expect(predictedTimeSec(prior, `edge:${ESC_DOWN}`, 'forward')).toBeUndefined();
    expect(predictedTimeSec(prior, 'edge:e_nowhere')).toBeUndefined();
    // Elevator targets: the board link (the wait), ELEVATOR_BOARD_SEC.
    expect(predictedTimeSec(prior, `elevator:${ELEVATOR_ID}`)).toBe(ELEVATOR_BOARD_SEC);
    expect(predictedTimeSec(prior, 'elevator:nope')).toBeUndefined();
    // Elevator edges are timed per elevator, not per edge; anything else is not a target.
    expect(predictedTimeSec(prior, 'edge:e_A_elevA_L1__A_elevA_L2')).toBeUndefined();
    for (const bad of ['', ESC_UP, 'node:n_A_1_esc', 'edge:', 'elevator:', `edge:${ESC_UP}#backward`]) {
      expect(predictedTimeSec(prior, bad), bad).toBeUndefined();
    }
    // It reads whatever graph it gets: callers pass one built with { calibration: {} }.
    const cal = buildGraph(basic, { calibration: { [`edge:${ESC_UP}`]: entry(25), [`elevator:${ELEVATOR_ID}`]: entry(60) } });
    expect(predictedTimeSec(cal, `edge:${ESC_UP}`)).toBe(25);
    expect(predictedTimeSec(cal, `elevator:${ELEVATOR_ID}`)).toBe(60);
    expect(predictedTimeSec(buildGraph({ ...basic, calibration: { [`edge:${ESC_UP}`]: entry(25) } }, { calibration: {} }), `edge:${ESC_UP}`))
      .toBe(predictedTimeSec(prior, `edge:${ESC_UP}`));
  });
});
