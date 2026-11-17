// Incremental Viterbi matcher (docs/MAP_MATCHING.md): accuracy against the nearest-projection baseline, stationary
// jitter, parallel walkways, U-turns, outliers, HMM restarts and the fixed-lag path.
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/graph.ts';
import { snapToRoutes } from '../../src/routing/fromPoint.ts';
import { createMatcherState, matchStep, smoothedPath } from '../../src/matching/hmm.ts';
import { buildMatchNetwork } from '../../src/matching/network.ts';
import type { MatchResult, SensorFix } from '../../src/matching/types.ts';
import { fixesOf, polylineDist, gridCampus, lngLat, makeCampus, netXY, stand, truthInNet, walk, type TruthPoint, type XY } from './fixtures.ts';

const run = (net: ReturnType<typeof buildMatchNetwork>, fixes: SensorFix[]): MatchResult[] => {
  const state = createMatcherState();
  return fixes.map((f) => matchStep(net, state, f));
};

describe('matchStep on a synthetic grid', () => {
  const campus = gridCampus(10, 10, 25);
  const g = buildGraph(campus);
  const net = buildMatchNetwork(g);
  // A zigzag through the grid: east, north, east, north, west …
  const path: XY[] = [[0, 0], [100, 0], [100, 50], [175, 50], [175, 125], [75, 125], [75, 200], [200, 200]];
  const truth = walk(path, 1.4);

  // "Right street": the shown point lies on the walked polyline (within 2 m) and within 25 m of the truth. Collinear
  // neighbouring edges of the same street count as right, a parallel or crossing street as wrong.
  const walked = path.map((q) => truthInNet(net, { x: q[0], y: q[1] }));
  const onWalk = (x: number, y: number, tx: number, ty: number) => polylineDist(walked, x, y) <= 2 && Math.hypot(x - tx, y - ty) <= 25;

  it('matches the right street more often than the nearest projection', () => {
    let hmmOk = 0;
    let nearOk = 0;
    let total = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const fixes = fixesOf(truth, seed, { sigmaM: 7, accuracyM: 10 });
      const results = run(net, fixes);
      results.forEach((r, k) => {
        const [tx, ty] = truthInNet(net, truth[k]!);
        const near = snapToRoutes(g, [fixes[k]!.lng, fixes[k]!.lat])!;
        const [nx, ny] = netXY(net, near.foot[0], near.foot[1]);
        total++;
        if (onWalk(r.x, r.y, tx, ty)) hmmOk++;
        if (onWalk(nx, ny, tx, ty)) nearOk++;
      });
    }
    const hmmRate = hmmOk / total;
    const nearRate = nearOk / total;
    // Measured when written: HMM 0.94, nearest projection 0.66.
    expect(hmmRate).toBeGreaterThan(nearRate + 0.1);
    expect(hmmRate).toBeGreaterThan(0.8);
  });

  it('gives a lagged, time-ordered best path no longer than the window', () => {
    const state = createMatcherState();
    const fixes = fixesOf(truth.slice(0, 40), 9, { sigmaM: 6, accuracyM: 8 });
    let last: MatchResult | null = null;
    for (const f of fixes) last = matchStep(net, state, f);
    const path20 = smoothedPath(state);
    expect(path20.length).toBe(20);
    for (let k = 1; k < path20.length; k++) expect(path20[k]!.tMs).toBeGreaterThan(path20[k - 1]!.tMs);
    const lagged = smoothedPath(state, 4000);
    expect(lagged[lagged.length - 1]!.tMs).toBe(last!.tMs - 4000);
    expect(last!.lagged!.tMs).toBe(last!.tMs - 4000);
    expect(last!.lagged!.edgeId).toBe(lagged[lagged.length - 1]!.edgeId);
  });
});

describe('stationary mode', () => {
  const net = buildMatchNetwork(buildGraph(gridCampus(5, 5, 30)));

  it('holds the shown position while the walker stands still', () => {
    const truth: TruthPoint[] = [...walk([[0, 15], [0, 45]], 1.3), ...stand([0, 45], 40, 24000)];
    const fixes = fixesOf(truth, 3, { sigmaM: 6, accuracyM: 10 });
    const results = run(net, fixes);
    const still = results.slice(-35);
    expect(still.every((r) => r.stationary)).toBe(true);
    const x0 = still[0]!.x;
    const y0 = still[0]!.y;
    const jitter = Math.max(...still.map((r) => Math.hypot(r.x - x0, r.y - y0)));
    const raw = fixes.slice(-35).map((f) => netXY(net, f.lng, f.lat));
    const rawJitter = Math.max(...raw.map(([x, y]) => Math.hypot(x - raw[0]![0], y - raw[0]![1])));
    expect(jitter).toBe(0);
    expect(rawJitter).toBeGreaterThan(10);
    // Held on the street the walker stopped on, near where they stopped.
    const [tx, ty] = truthInNet(net, { x: 0, y: 45 });
    expect(Math.hypot(x0 - tx, y0 - ty)).toBeLessThan(8);
  });

  it('leaves stationary mode once the walker moves on', () => {
    const truth: TruthPoint[] = [...stand([0, 15], 10, 0), ...walk([[0, 15], [0, 90]], 1.4, 10000)];
    const results = run(net, fixesOf(truth, 4, { sigmaM: 4, accuracyM: 6 }));
    expect(results[8]!.stationary).toBe(true);
    expect(results[results.length - 1]!.stationary).toBe(false);
    const [tx, ty] = truthInNet(net, truth[truth.length - 1]!);
    expect(Math.hypot(results[results.length - 1]!.x - tx, results[results.length - 1]!.y - ty)).toBeLessThan(8);
  });
});

describe('parallel walkways', () => {
  // Two footways 12 m apart joined only at their ends (200 m long).
  const campus = makeCampus(
    [
      { id: 'a0', at: [0, 0] }, { id: 'a1', at: [100, 0] }, { id: 'a2', at: [200, 0] },
      { id: 'b0', at: [0, 12] }, { id: 'b1', at: [100, 12] }, { id: 'b2', at: [200, 12] },
    ],
    [
      { id: 'a01', from: 'a0', to: 'a1' }, { id: 'a12', from: 'a1', to: 'a2' },
      { id: 'b01', from: 'b0', to: 'b1' }, { id: 'b12', from: 'b1', to: 'b2' },
      { id: 'w', from: 'a0', to: 'b0' }, { id: 'e', from: 'a2', to: 'b2' },
    ],
  );
  const g = buildGraph(campus);
  const net = buildMatchNetwork(g);

  it('does not jump to the other walkway when a few fixes drift toward it', () => {
    const truth = walk([[0, 0], [200, 0]], 1.4);
    const fixes = fixesOf(truth, 5, { sigmaM: 2, accuracyM: 8 });
    // Fixes 60–64 drift 10 m north, past the middle between the two walkways.
    for (let k = 60; k < 65; k++) {
      const [lng, lat] = lngLat([truth[k]!.x, 10]);
      fixes[k] = { ...fixes[k]!, lng, lat };
    }
    const results = run(net, fixes);
    const nearJumps = fixes.filter((f) => snapToRoutes(g, [f.lng, f.lat])!.edgeId.startsWith('b')).length;
    const hmmJumps = results.filter((r) => r.edgeId !== null && r.edgeId.startsWith('b')).length;
    expect(nearJumps).toBeGreaterThanOrEqual(4);
    expect(hmmJumps).toBe(0);
    expect(results.every((r) => !r.free)).toBe(true);
  });
});

describe('U-turn', () => {
  // A street with side branches every 20 m.
  const nodes = [];
  const edges = [];
  for (let i = 0; i <= 6; i++) {
    nodes.push({ id: `s${i}`, at: [i * 20, 0] as XY }, { id: `n${i}`, at: [i * 20, 30] as XY });
    edges.push({ id: `side${i}`, from: `s${i}`, to: `n${i}` });
    if (i > 0) edges.push({ id: `st${i}`, from: `s${i - 1}`, to: `s${i}` });
  }
  const net = buildMatchNetwork(buildGraph(makeCampus(nodes, edges)));

  it('follows the walker back after turning around', () => {
    const truth = walk([[0, 0], [100, 0], [10, 0]], 1.3);
    const fixes = fixesOf(truth, 6, { sigmaM: 5, accuracyM: 8 });
    const results = run(net, fixes);
    const turn = truth.findIndex((p) => p.headingDeg > 180);
    const after = results.slice(turn + 8);
    const errors = after.map((r, k) => {
      const [tx, ty] = truthInNet(net, truth[turn + 8 + k]!);
      return Math.hypot(r.x - tx, r.y - ty);
    });
    const raw = fixes.slice(turn + 8).map((f, k) => {
      const [tx, ty] = truthInNet(net, truth[turn + 8 + k]!);
      const [fx, fy] = netXY(net, f.lng, f.lat);
      return Math.hypot(fx - tx, fy - ty);
    });
    const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
    // Measured when written: mean 4.3 m (raw fixes 7.1 m), worst 11.1 m (raw 14.8 m), last 3.5 m.
    expect(mean(errors)).toBeLessThan(mean(raw));
    expect(mean(errors)).toBeLessThan(5.5);
    expect(Math.max(...errors)).toBeLessThan(15);
    expect(errors[errors.length - 1]!).toBeLessThan(6);
    expect(after.some((r) => r.restarted || r.free)).toBe(false);
    expect(after.every((r) => r.edgeId !== null && r.edgeId.startsWith('st'))).toBe(true);
  });
});

describe('outliers, gaps and restarts', () => {
  const net = buildMatchNetwork(buildGraph(gridCampus(6, 6, 25)));
  const truth = walk([[0, 0], [125, 0], [125, 60]], 1.4);

  it('ignores a fix with 100 m accuracy (no observation)', () => {
    const fixes = fixesOf(truth, 7, { sigmaM: 3, accuracyM: 6 });
    const [lng, lat] = [fixes[30]!.lng + 0.002, fixes[30]!.lat + 0.001]; // ~200 m away
    fixes[30] = { ...fixes[30]!, lng, lat, accuracyM: 100 };
    const state = createMatcherState();
    const results = fixes.map((f) => matchStep(net, state, f));
    expect(results[30]!.skipped).toBe(true);
    expect(results[30]!.x).toBe(results[29]!.x);
    expect(results[30]!.edgeId).toBe(results[29]!.edgeId);
    expect(results.some((r) => r.restarted)).toBe(false);
    expect(results.filter((r) => r.skipped)).toHaveLength(1);
  });

  it('ignores a NaN fix', () => {
    const state = createMatcherState();
    const fixes = fixesOf(truth.slice(0, 5), 8, { sigmaM: 3, accuracyM: 6 });
    fixes.forEach((f) => matchStep(net, state, f));
    const r = matchStep(net, state, { tMs: 5000, lat: Number.NaN, lng: Number.NaN, accuracyM: 5 });
    expect(r.skipped).toBe(true);
    expect(Number.isFinite(r.x)).toBe(true);
  });

  it('restarts from the fix alone when no transition is possible', () => {
    const state = createMatcherState();
    fixesOf(truth.slice(0, 5), 9, { sigmaM: 2, accuracyM: 5 }).forEach((f) => matchStep(net, state, f));
    // 2 s later, 120 m away: faster than vMax.
    const far = fixesOf([{ tMs: 6000, x: 0, y: 125, headingDeg: 0, speedMps: 1 }], 10, { sigmaM: 0.5, accuracyM: 5 })[0]!;
    const r = matchStep(net, state, far);
    expect(r.restarted).toBe(true);
    expect(r.edgeId).not.toBeNull();
    expect(r.lagged).toBeNull();
  });

  it('inflates sigma for a jump faster than vMax', () => {
    const state = createMatcherState();
    fixesOf(truth.slice(0, 3), 11, { sigmaM: 1, accuracyM: 6 }).forEach((f) => matchStep(net, state, f));
    const jump = fixesOf([{ tMs: 3000, x: 20, y: 0, headingDeg: 90, speedMps: 1.4 }], 12, { sigmaM: 0.1, accuracyM: 6 })[0]!;
    const r = matchStep(net, state, jump);
    expect(r.sigmaM).toBeCloseTo(18, 5);
  });

  it('treats a negative GPS speed (iOS: -1 = unknown) as missing, not as standing still (QA regression)', () => {
    const fixes = fixesOf(truth, 7, { sigmaM: 3, accuracyM: 6 }).map((f) => ({ ...f, speedMps: -1, headingDeg: -1 }));
    const state = createMatcherState();
    const results = fixes.map((f) => matchStep(net, state, f));
    expect(results.filter((r) => r.stationary)).toHaveLength(0);
    // The shown point keeps up with the walker instead of being held at the start.
    const first = results[0]!;
    const last = results[results.length - 1]!;
    expect(Math.hypot(last.x - first.x, last.y - first.y)).toBeGreaterThan(100);
  });

  it('ignores a fix whose latitude / longitude is out of range or whose accuracy is negative (QA regression)', () => {
    const state = createMatcherState();
    expect(matchStep(net, state, { tMs: 0, lat: 95, lng: 200, accuracyM: 5 }).skipped).toBe(true);
    const good = fixesOf(truth.slice(0, 3), 14, { sigmaM: 2, accuracyM: 5 });
    good.forEach((f) => matchStep(net, state, f));
    const before = state.last!;
    const r = matchStep(net, state, { ...good[2]!, tMs: 3000, lat: -91 });
    expect(r.skipped).toBe(true);
    expect(r.x).toBe(before.x);
    expect(matchStep(net, state, { ...good[2]!, tMs: 3000, accuracyM: -1 }).skipped).toBe(true);
    // The next good fix carries on without a restart.
    expect(matchStep(net, state, fixesOf(truth.slice(3, 4), 15, { sigmaM: 2, accuracyM: 5 })[0]!).restarted).toBe(false);
  });

  it('survives repeated 50 m+ GPS jumps: finite output, bounded path, no stuck state (QA regression)', () => {
    const state = createMatcherState();
    const fixes = fixesOf(truth, 3, { sigmaM: 3, accuracyM: 6 });
    const results = fixes.map((f, i) => matchStep(net, state, i % 7 === 3 ? { ...f, lat: f.lat + 0.0006 } : f)); // ~67 m north
    expect(results.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.confidence))).toBe(true);
    expect(smoothedPath(state).length).toBeLessThanOrEqual(state.W);
    // Back on the walk at the end.
    expect(results[results.length - 1]!.edgeId).not.toBeNull();
  });

  it('replays the same trace to the same results (no clock, no randomness)', () => {
    const fixes = fixesOf(truth, 13, { sigmaM: 8, accuracyM: 12 });
    expect(run(net, fixes)).toEqual(run(net, fixes));
  });
});
