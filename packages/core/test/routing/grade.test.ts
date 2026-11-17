// Grade-based costs (docs/ELEVATION_INTEGRATION.md): Tobler time by direction, per-profile grade penalties, the σ
// cut-off, and that data without elevation routes exactly as before.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  DOWNHILL_GRADE_PENALTY_FACTOR,
  GRADE_PENALTY_SEC_PER_M,
  RAMP_FACTOR,
  RAMP_PENALTY_SEC,
  STEEP_NOTE,
  WALK_SPEED_MPS,
  buildGraph,
  edgeGradePct,
  findRoute,
  gradeClass,
  gradePenaltySec,
  penaltySec,
  slopeTimeFactor,
  walkTimeSec,
  type CampusGraph,
  type Route,
  type WalkLinkData,
} from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';
import { campus, edge, node } from './fixtures/audit.ts';
import { FIXTURE_DIR } from '../edit/helpers.ts';

const OUT = { node_type: 'outdoor' };
const FOOT = { highway: 'footway', edge_type: 'outdoor' };
const P = 'n_out_P';
const Q = 'n_out_Q';
const HILL = 'e_out_P__out_Q';

/** P→Q: a direct 60 m footway `hill`, or a flat 100 m detour through M (two flat_exact footways). */
function hillCampus(hill: Record<string, unknown>) {
  return campus([
    node(P, [0, 0], OUT),
    node(Q, [60, 0], OUT),
    node('n_out_M', [30, 40], OUT),
    edge(HILL, P, Q, { ...FOOT, ...hill }),
    edge('e_out_P__out_M', P, 'n_out_M', { ...FOOT, flat_exact: true }),
    edge('e_out_M__out_Q', 'n_out_M', Q, { ...FOOT, flat_exact: true }),
  ]);
}

const route = (g: CampusGraph, from: string, to: string, profile: Parameters<typeof findRoute>[3]): Route => {
  const r = findRoute(g, from, to, profile);
  if (!r.found) throw new Error(r.message);
  return r;
};

function walk(g: CampusGraph, from: string, to: string, edgeId: string): WalkLinkData {
  let out: WalkLinkData | undefined;
  g.graph.forEachLink((l) => {
    if (l.fromId === from && l.toId === to && l.data.kind === 'walk' && l.data.edge.id === edgeId) out = l.data;
  });
  if (!out) throw new Error(`no walk link ${from} → ${to}`);
  return out;
}

describe('grade rules in costs.ts', () => {
  it('gradeClass: ≤ 5 % gentle, ≤ 8 % caution, above steep, by size', () => {
    expect([0, 5, -5, 5.01, 8, -8, 8.01, -12].map(gradeClass)).toEqual(['gentle', 'gentle', 'gentle', 'caution', 'caution', 'caution', 'steep', 'steep']);
  });

  it('edgeGradePct: flat_exact 0, elev_diff_m over the plan length before grade_pct, sign by traversal, none on steps / elevators, none when σ is too large', () => {
    expect(edgeGradePct({ highway: 'footway', flat_exact: true, elev_diff_m: 3 }, 50, 'along')).toBe(0);
    expect(edgeGradePct({ highway: 'footway', elev_diff_m: 3, grade_pct: 99 }, 50, 'along')).toBeCloseTo(6, 12);
    expect(edgeGradePct({ highway: 'footway', elev_diff_m: 3 }, 50, 'against')).toBeCloseTo(-6, 12);
    expect(edgeGradePct({ highway: 'ramp', grade_pct: 4 }, 0, 'against')).toBe(-4);
    expect(edgeGradePct({ highway: 'steps', elev_diff_m: 3 }, 50, 'along')).toBeNull();
    expect(edgeGradePct({ highway: 'elevator', elev_diff_m: 3 }, 50, 'along')).toBeNull();
    expect(edgeGradePct({ highway: 'footway' }, 50, 'along')).toBeNull();
    // σ 2 m over 50 m is 4 points (> GRADE_MAX_SIGMA_PCT 3): not trusted.
    expect(edgeGradePct({ highway: 'footway', elev_diff_m: 3, elev_sigma_m: 2 }, 50, 'along')).toBeNull();
    expect(edgeGradePct({ highway: 'footway', elev_diff_m: 3, elev_sigma_m: 1 }, 50, 'along')).toBeCloseTo(6, 12);
  });

  it('slopeTimeFactor is Tobler normalised to the flat: 1 at 0 %, slower uphill, faster gently downhill', () => {
    expect(slopeTimeFactor(0)).toBe(1);
    expect(slopeTimeFactor(5)).toBeCloseTo(Math.exp(0.175), 12);
    expect(slopeTimeFactor(8)).toBeCloseTo(Math.exp(0.28), 12);
    expect(slopeTimeFactor(-5)).toBeCloseTo(Math.exp(-0.175), 12);
    expect(slopeTimeFactor(-10)).toBeCloseTo(1, 12);
    expect(walkTimeSec({ highway: 'footway' }, 60, 10)).toBeCloseTo((60 / WALK_SPEED_MPS) * Math.exp(0.35), 9);
    // A ramp with a known grade uses the slope, not RAMP_FACTOR; without one it is as before.
    expect(walkTimeSec({ highway: 'ramp' }, 30, 0)).toBeCloseTo(30 / WALK_SPEED_MPS, 12);
    expect(walkTimeSec({ highway: 'ramp' }, 30)).toBeCloseTo((30 / WALK_SPEED_MPS) * RAMP_FACTOR, 12);
  });

  it('grade penalties per metre: by class, profile and direction; a ramp with a known grade drops RAMP_PENALTY_SEC', () => {
    const up = { gradePct: 10, lengthM: 60 };
    const down = { gradePct: -10, lengthM: 60 };
    expect(gradePenaltySec(up, 'wheelchair')).toBe(GRADE_PENALTY_SEC_PER_M.wheelchair.steep * 60);
    expect(gradePenaltySec(down, 'wheelchair')).toBe(GRADE_PENALTY_SEC_PER_M.wheelchair.steep * 60 * DOWNHILL_GRADE_PENALTY_FACTOR);
    expect(gradePenaltySec({ gradePct: 6, lengthM: 10 }, 'elevator_first')).toBe(GRADE_PENALTY_SEC_PER_M.elevator_first.caution * 10);
    expect(gradePenaltySec({ gradePct: 4.9, lengthM: 100 }, 'wheelchair')).toBe(0);
    expect(gradePenaltySec(up, 'shortest')).toBe(0);
    const ramp = { highway: 'ramp' as const, step_free: true };
    expect(penaltySec(ramp, 'wheelchair')).toBe(RAMP_PENALTY_SEC);
    expect(penaltySec(ramp, 'wheelchair', { gradePct: 4, lengthM: 30 })).toBe(0);
    expect(penaltySec(ramp, 'elevator_first', { gradePct: 7, lengthM: 30 })).toBe(GRADE_PENALTY_SEC_PER_M.elevator_first.caution * 30);
    // fewest_steps (the step_free fallback) prices slopes like step_free; steps stay the stairs penalty.
    expect(penaltySec({ highway: 'footway', step_free: true }, 'fewest_steps', up)).toBe(GRADE_PENALTY_SEC_PER_M.fewest_steps.steep * 60);
  });

  it('costs.ts, graph.ts and route.ts read no floor numbers', async () => {
    for (const file of ['costs.ts', 'graph.ts', 'route.ts']) {
      const source = await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8');
      const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/level/i);
    }
  });
});

describe('routing on a hill', () => {
  it('a 10 % hill: shortest takes it (slower uphill than down), wheelchair / elevator_first / step_free go round', () => {
    const g = buildGraph(hillCampus({ elev_diff_m: 6, elev_sigma_m: 0.3 }));
    const upLink = walk(g, P, Q, HILL);
    const downLink = walk(g, Q, P, HILL);
    expect(upLink.gradePct).toBeCloseTo(10, 1);
    expect(downLink.gradePct).toBeCloseTo(-10, 1);
    expect(upLink.timeSec).toBeGreaterThan(downLink.timeSec);
    expect(upLink.timeSec).toBeCloseTo((upLink.lengthM / WALK_SPEED_MPS) * slopeTimeFactor(upLink.gradePct!), 9);
    expect(upLink.cost.wheelchair - upLink.timeSec).toBeCloseTo(GRADE_PENALTY_SEC_PER_M.wheelchair.steep * upLink.lengthM, 6);
    expect(downLink.cost.wheelchair - downLink.timeSec).toBeCloseTo(upLink.cost.wheelchair - upLink.timeSec - (1 - DOWNHILL_GRADE_PENALTY_FACTOR) * GRADE_PENALTY_SEC_PER_M.wheelchair.steep * upLink.lengthM, 6);

    const short = route(g, P, Q, 'shortest');
    expect(short.edgeIds).toEqual([HILL]);
    expect(short.slopeSegments).toEqual([{ edgeId: HILL, from: P, to: Q, gradePct: 10, gradeClass: 'steep' }]);
    expect(short.cost).toBe(short.timeSec);
    for (const profile of ['wheelchair', 'elevator_first', 'step_free'] as const) {
      expect(route(g, P, Q, profile).edgeIds, profile).toEqual(['e_out_P__out_M', 'e_out_M__out_Q']);
      expect(route(g, Q, P, profile).edgeIds, `${profile} downhill`).toEqual(['e_out_M__out_Q', 'e_out_P__out_M']);
      expect(route(g, P, Q, profile).slopeSegments).toEqual([]);
    }
  });

  it('a 6 % (caution) hill: wheelchair and elevator_first go round, step_free does not mind', () => {
    const g = buildGraph(hillCampus({ elev_diff_m: 3.6 }));
    expect(route(g, P, Q, 'step_free').edgeIds).toEqual([HILL]);
    expect(route(g, P, Q, 'step_free').slopeSegments[0]?.gradeClass).toBe('caution');
    expect(route(g, P, Q, 'wheelchair').edgeIds).toHaveLength(2);
    expect(route(g, P, Q, 'elevator_first').edgeIds).toHaveLength(2);
    // Caution only: the sentence says nothing about the slope.
    expect(route(g, P, Q, 'step_free').steps.map((s) => s.text)).toEqual(['60m 걸어가세요']);
  });

  it('route-text: a walk over a steep part says 경사가 급한 길, both ways; flat detours do not', () => {
    const g = buildGraph(hillCampus({ elev_diff_m: 6, elev_sigma_m: 0.3 }));
    for (const [from, to] of [[P, Q], [Q, P]] as const) {
      const [step] = route(g, from, to, 'shortest').steps;
      expect(step?.text).toBe(`60m 걸어가세요 (${STEEP_NOTE})`);
      expect(step?.text).toContain('경사가 급한 길');
      expect(step?.steep).toBe(true);
    }
    for (const step of route(g, P, Q, 'wheelchair').steps) expect(step.steep).toBeUndefined();
  });

  it('a grade with too large a σ is ignored: the hill is priced as a plain footway', () => {
    const g = buildGraph(hillCampus({ elev_diff_m: 6, elev_sigma_m: 3 }));
    const link = walk(g, P, Q, HILL);
    expect(link.gradePct).toBeNull();
    expect(link.timeSec).toBeCloseTo(link.lengthM / WALK_SPEED_MPS, 9);
    expect(route(g, P, Q, 'wheelchair').edgeIds).toEqual([HILL]);
  });

  it('a measured time replaces the predicted slope time, the grade penalty stays', () => {
    const c = hillCampus({ elev_diff_m: 6 });
    const g = buildGraph(c, { calibration: { [`edge:${HILL}`]: { prior_sec: 71, median_sec: 80, n: 3, estimate_sec: 80, updated_at: '2026-11-15' } } });
    const link = walk(g, P, Q, HILL);
    expect(link.timeSec).toBe(80);
    expect(link.cost.wheelchair).toBeCloseTo(80 + GRADE_PENALTY_SEC_PER_M.wheelchair.steep * link.lengthM, 6);
  });

  it('a ramp with a known gentle grade: slope time and no flat ramp penalty', () => {
    const g = buildGraph(hillCampus({ highway: 'ramp', elev_diff_m: 2.4 }));
    const link = walk(g, P, Q, HILL);
    expect(link.gradePct).toBeCloseTo(4, 1);
    expect(link.cost.wheelchair).toBe(link.timeSec);
    expect(link.cost.elevator_first).toBe(link.timeSec);
  });
});

describe('backward compatibility', () => {
  it('without elevation fields every walk link has no grade and the old time; flat_exact gives the very same costs', async () => {
    const loaded = await loadCampus(FIXTURE_DIR);
    const g = buildGraph(loaded, { calibration: {} });
    // campus-basic carries one flat_exact footway and one explicit break-line; strip both and compare every link.
    const stripped = {
      ...loaded,
      features: loaded.features.map(({ file, feature }) => {
        const f = JSON.parse(JSON.stringify(feature)) as { properties: Record<string, unknown> };
        delete f.properties['flat_exact'];
        delete f.properties['is_breakline'];
        return { file, feature: f };
      }),
    };
    const plain = buildGraph(stripped, { calibration: {} });
    const links = (x: CampusGraph) => {
      const out: unknown[] = [];
      x.graph.forEachLink((l) => {
        out.push([l.fromId, l.toId, l.data.timeSec, l.data.cost, l.data.blocked]);
      });
      return out;
    };
    expect(links(g)).toEqual(links(plain));
    let flat = 0;
    g.graph.forEachLink((l) => {
      if (l.data.kind !== 'walk') return;
      if (l.data.edge.properties.flat_exact) flat++;
      expect(l.data.gradePct === null || l.data.edge.properties.flat_exact === true).toBe(true);
    });
    expect(flat).toBe(2);
  });
});
