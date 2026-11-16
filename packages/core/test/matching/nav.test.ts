// Indoor / outdoor navigation state machine (docs/MAP_MATCHING.md 5–7): portal entry and exit, false alarms,
// off-network suspicion, REROUTE with cooldown and stationary pause, barometric floor changes.
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/graph.ts';
import { toLat, toLng } from '../../src/matching/geo.ts';
import { createMatcherState, matchStep, setMatchScope } from '../../src/matching/hmm.ts';
import { buildNavRoute, initialNavState, navEventMessage, navStep, scopeForNav, type NavRoute } from '../../src/matching/nav.ts';
import { buildMatchNetwork, type MatchNetwork } from '../../src/matching/network.ts';
import type { MatchResult, NavEvent, NavMode, NavState, SensorFix } from '../../src/matching/types.ts';
import { fixesOf, gridCampus, makeCampus, stand, walk, type TruthPoint, type XY } from './fixtures.ts';

// A street along y = −10, a 10 m path north to the door at (0, 0), building B (x −30…30, y 5…60, floors 1–3, ground 1).
const campusB = makeCampus(
  [
    { id: 's_w', at: [-120, -10] }, { id: 's_mid', at: [0, -10] }, { id: 's_e', at: [120, -10] }, { id: 'o_door', at: [0, 0] },
    { id: 'b_ent', at: [0, 8], type: 'entrance', building: 'B', level: 1 },
    { id: 'b1_hall', at: [0, 40], type: 'corridor', building: 'B', level: 1 },
    { id: 'b1_st', at: [10, 40], type: 'stair_landing', building: 'B', level: 1 },
    { id: 'b2_st', at: [16, 40], type: 'stair_landing', building: 'B', level: 2 },
    { id: 'b2_hall', at: [0, 40], type: 'corridor', building: 'B', level: 2 },
    { id: 'b1_el', at: [-10, 40], type: 'elevator_stop', building: 'B', level: 1 },
    { id: 'b2_el', at: [-10, 40], type: 'elevator_stop', building: 'B', level: 2 },
  ],
  [
    { id: 'st_w', from: 's_w', to: 's_mid' }, { id: 'st_e', from: 's_mid', to: 's_e' }, { id: 'to_door', from: 's_mid', to: 'o_door' },
    { id: 'portal_B', from: 'o_door', to: 'b_ent', edgeType: 'portal' },
    { id: 'b1_in', from: 'b_ent', to: 'b1_hall', highway: 'corridor', edgeType: 'indoor' },
    { id: 'b1_to_st', from: 'b1_hall', to: 'b1_st', highway: 'corridor', edgeType: 'indoor' },
    { id: 'b_stairs', from: 'b1_st', to: 'b2_st', highway: 'steps', edgeType: 'indoor' },
    { id: 'b2_from_st', from: 'b2_st', to: 'b2_hall', highway: 'corridor', edgeType: 'indoor' },
    { id: 'b1_to_el', from: 'b1_hall', to: 'b1_el', highway: 'corridor', edgeType: 'indoor' },
    { id: 'b2_to_el', from: 'b2_hall', to: 'b2_el', highway: 'corridor', edgeType: 'indoor' },
    { id: 'b_elev', from: 'b1_el', to: 'b2_el', highway: 'elevator', edgeType: 'indoor' },
  ],
  [{ id: 'B', ring: [[-30, 5], [30, 5], [30, 60], [-30, 60]], levels: [1, 2, 3], ground: [1] }],
);
const netB = buildMatchNetwork(buildGraph(campusB));

interface Run {
  nav: NavState;
  events: NavEvent[];
  modes: NavMode[];
  results: MatchResult[];
}

/** Matcher + nav loop the way the app runs it: the nav mode picks the matcher's scope for the next fix. */
function drive(net: MatchNetwork, fixes: SensorFix[], nav0: NavState, route: NavRoute | null): Run {
  const state = createMatcherState();
  let nav = nav0;
  const events: NavEvent[] = [];
  const modes: NavMode[] = [];
  const results: MatchResult[] = [];
  for (const fix of fixes) {
    setMatchScope(state, scopeForNav(nav));
    const r = matchStep(net, state, fix);
    const step = navStep(nav, r, fix, { net, route });
    nav = step.nav;
    events.push(...step.events);
    modes.push(nav.mode);
    results.push(r);
  }
  return { nav, events, modes, results };
}

const modeChanges = (events: NavEvent[]) => events.flatMap((e) => (e.type === 'MODE_CHANGED' ? [e.to] : []));

/** Fixes with accuracy and noise by area: `bad(p)` decides where the GPS is poor. */
function mixedFixes(truth: TruthPoint[], seed: number, bad: (p: TruthPoint) => boolean, badAccuracyM = 35): SensorFix[] {
  const good = fixesOf(truth, seed, { sigmaM: 2.5, accuracyM: 5 });
  const poor = fixesOf(truth, seed + 1000, { sigmaM: 10, accuracyM: badAccuracyM });
  return truth.map((p, k) => (bad(p) ? poor[k]! : good[k]!));
}

describe('portal: outdoor → approaching → portal → indoor', () => {
  it('enters the building along the planned route, resets dH at the portal', () => {
    const truth = [...walk([[-90, -10], [0, -10], [0, 0], [0, 8], [0, 40]], 1.3), ...stand([0, 40], 15, 200000)];
    let k = 0;
    for (const p of truth) p.tMs = 1000 * k++;
    const fixes = mixedFixes(truth, 21, (p) => p.y >= 6).map((f) => ({ ...f, baroDeltaM: 50 }));
    const route = buildNavRoute(netB, ['s_w', 's_mid', 'o_door', 'b_ent', 'b1_hall']);
    const run = drive(netB, fixes, initialNavState(0), route);
    expect(modeChanges(run.events)).toEqual(['APPROACHING', 'PORTAL', 'INDOOR']);
    expect(run.nav.mode).toBe('INDOOR');
    expect(run.nav.buildingId).toBe('B');
    expect(run.nav.level).toBe(1);
    expect(run.nav.floor.refBaroM).toBe(50);
    expect(run.events.some((e) => e.type === 'FLOOR_CHANGED' || e.type === 'REROUTE')).toBe(false);
    // Indoors the matcher takes candidates from floor 1 of B only.
    expect(scopeForNav(run.nav)).toEqual({ kind: 'floor', buildingId: 'B', level: 1 });
    const entered = run.events.find((e) => e.type === 'MODE_CHANGED' && e.to === 'INDOOR')!;
    expect(navEventMessage(entered)).toBe('건물 안으로 들어오셨습니다.');
  });

  it('enters by the lagged path alone when indoor GPS stays usable (no GPS-loss fallback)', () => {
    const truth = walk([[-90, -10], [0, -10], [0, 0], [0, 8], [0, 40]], 1.3);
    const fixes = mixedFixes(truth, 24, (p) => p.y >= 6, 15).map((f, k) => (truth[k]!.y >= 6 ? { ...f, accuracyM: 15 } : f));
    const route = buildNavRoute(netB, ['s_w', 's_mid', 'o_door', 'b_ent', 'b1_hall']);
    const run = drive(netB, fixes, initialNavState(0), route);
    expect(modeChanges(run.events)).toEqual(['APPROACHING', 'PORTAL', 'INDOOR']);
    const portalAt = run.events.find((e) => e.type === 'MODE_CHANGED' && e.to === 'PORTAL')!.tMs;
    const indoorAt = run.events.find((e) => e.type === 'MODE_CHANGED' && e.to === 'INDOOR')!.tMs;
    expect(indoorAt - portalAt).toBeGreaterThanOrEqual(2000);
  });

  it('returns to OUTDOOR after a false alarm (GPS dropped near the door, then good outside)', () => {
    const truth = walk([[-80, -10], [80, -10]], 1.3);
    const fixes = mixedFixes(truth, 22, (p) => p.x >= -8 && p.x < 0);
    const run = drive(netB, fixes, initialNavState(0), null);
    expect(modeChanges(run.events)).toEqual(['APPROACHING', 'PORTAL', 'OUTDOOR']);
    expect(run.nav.mode).toBe('OUTDOOR');
    expect(run.nav.buildingId).toBeNull();
  });

  it('leaves through the portal: indoor → portal → outdoor', () => {
    const truth = walk([[0, 40], [0, 8], [0, 0], [0, -10], [60, -10]], 1.3);
    const fixes = mixedFixes(truth, 23, (p) => p.y > 6);
    const run = drive(netB, fixes, initialNavState(0, 'INDOOR', { buildingId: 'B', level: 1 }), null);
    expect(modeChanges(run.events)).toEqual(['PORTAL', 'OUTDOOR']);
    expect(run.nav.mode).toBe('OUTDOOR');
    expect(run.nav.level).toBeNull();
    const out = run.events.find((e) => e.type === 'MODE_CHANGED' && e.to === 'OUTDOOR')!;
    expect(navEventMessage(out)).toBe('건물 밖으로 나오셨습니다.');
  });
});

describe('off route and off network', () => {
  const grid = gridCampus(8, 8, 25);
  const net = buildMatchNetwork(buildGraph(grid));
  const eastRoute = buildNavRoute(net, Array.from({ length: 8 }, (_, i) => `g_${i}_0`));

  it('raises REROUTE once, then waits out the 15 s cooldown', () => {
    // The route goes east along y = 0; the walker goes north instead, then east along y = 175.
    const truth = walk([[0, 0], [0, 175], [175, 175]], 1.4);
    const run = drive(net, fixesOf(truth, 31, { sigmaM: 3, accuracyM: 5 }), initialNavState(0), eastRoute);
    const reroutes = run.events.filter((e) => e.type === 'REROUTE');
    expect(reroutes.length).toBeGreaterThanOrEqual(2);
    expect(reroutes.every((e) => e.reason === 'off_route')).toBe(true);
    const first = reroutes[0]!.tMs;
    // Off-route (> 20 m) from about 14 s, plus 8 s.
    expect(first).toBeGreaterThanOrEqual(20000);
    expect(first).toBeLessThanOrEqual(26000);
    expect(reroutes.filter((e) => e.tMs < first + 15000)).toHaveLength(1);
    for (let i = 1; i < reroutes.length; i++) expect(reroutes[i]!.tMs - reroutes[i - 1]!.tMs).toBeGreaterThanOrEqual(15000);
    expect(navEventMessage(reroutes[0]!)).toBe('경로를 벗어나셨습니다. 새 경로를 찾고 있습니다.');
  });

  it('pauses the off-route timer while the walker stands still', () => {
    // 7 s off-route, 30 s standing, then on: no REROUTE before walking resumes.
    const truth = [...walk([[0, 0], [0, 30]], 1.4), ...stand([0, 30], 30, 22000), ...walk([[0, 30], [0, 100]], 1.4, 52000)];
    const run = drive(net, fixesOf(truth, 32, { sigmaM: 3, accuracyM: 5 }), initialNavState(0), eastRoute);
    const reroutes = run.events.filter((e) => e.type === 'REROUTE');
    expect(run.results.slice(30, 50).every((r) => r.stationary)).toBe(true);
    expect(reroutes.length).toBeGreaterThanOrEqual(1);
    expect(reroutes[0]!.tMs).toBeGreaterThan(52000);
  });

  it('suspects off-network walking, raises REROUTE, and comes back to OUTDOOR', () => {
    // East past the grid's edge (x = 175) into an open field, then back.
    const truth = walk([[100, 0], [300, 0], [100, 0]], 1.4);
    const run = drive(net, fixesOf(truth, 33, { sigmaM: 3, accuracyM: 5 }), initialNavState(0), null);
    expect(modeChanges(run.events)).toEqual(['OFF_NETWORK_SUSPECT', 'OUTDOOR']);
    const reroutes = run.events.filter((e) => e.type === 'REROUTE');
    expect(reroutes.length).toBeGreaterThanOrEqual(1);
    expect(reroutes[0]!.reason).toBe('off_network');
    const suspect = run.events.find((e) => e.type === 'MODE_CHANGED' && e.to === 'OFF_NETWORK_SUSPECT')!;
    expect(reroutes[0]!.tMs - suspect.tMs).toBeGreaterThanOrEqual(10000);
    expect(run.nav.mode).toBe('OUTDOOR');
  });
});

describe('barometric floor change', () => {
  const hall = netB.nodeIndex.get('b1_hall')!;
  const x = netB.nodeX[hall]!;
  const y = netB.nodeY[hall]!;
  const result = (tMs: number, edgeId: string): MatchResult => ({
    tMs, edgeId, t: 0.5, x, y, lat: toLat(netB.frame, y), lng: toLng(netB.frame, x), free: false, confidence: 0.9,
    stationary: false, skipped: false, switched: false, restarted: false, sigmaM: 30, networkDistM: 0, lagged: null,
  });
  const fixAt = (tMs: number, baroDeltaM: number): SensorFix => ({ tMs, lat: toLat(netB.frame, y), lng: toLng(netB.frame, x), accuracyM: 40, baroDeltaM });

  /** 5 s flat, a climb of `rise` m at `rate` m/s, then 6 s flat; heights from `offset`. */
  function climb(rise: number, rate: number, offset: number, edgeId: string) {
    const samples: [number, number, string][] = [];
    let t = 0;
    for (let k = 0; k < 5; k++) samples.push([t, offset, 'b1_in']), (t += 1000);
    const dur = Math.ceil(rise / rate);
    for (let k = 1; k <= dur; k++) samples.push([t, offset + Math.min(rise, k * rate), edgeId]), (t += 1000);
    for (let k = 0; k < 6; k++) samples.push([t, offset + rise, 'b2_from_st']), (t += 1000);
    let nav = initialNavState(0, 'INDOOR', { buildingId: 'B', level: 1 });
    const events: NavEvent[] = [];
    for (const [tMs, h, e] of samples) {
      const step = navStep(nav, result(tMs, e), fixAt(tMs, h), { net: netB, route: null });
      nav = step.nav;
      events.push(...step.events);
    }
    return { nav, events, climbEndMs: (5 + dur - 1) * 1000 };
  }

  it('confirms the floor once the climb has settled for 2 s (stairs)', () => {
    const { nav, events, climbEndMs } = climb(3.9, 0.3, 12, 'b_stairs');
    const floors = events.filter((e) => e.type === 'FLOOR_CHANGED');
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ buildingId: 'B', fromLevel: 1, toLevel: 2, via: 'stairs' });
    expect(floors[0]!.tMs).toBeGreaterThanOrEqual(climbEndMs + 2000);
    expect(nav.level).toBe(2);
    expect(scopeForNav(nav)).toEqual({ kind: 'floor', buildingId: 'B', level: 2 });
    expect(navEventMessage(floors[0]!)).toBe('계단으로 2층에 도착하셨습니다.');
  });

  it('tells an elevator by its vertical speed', () => {
    const { events } = climb(7.8, 1.5, 12, 'b1_to_el');
    const floors = events.filter((e) => e.type === 'FLOOR_CHANGED');
    expect(floors).toHaveLength(1);
    expect(floors[0]).toMatchObject({ fromLevel: 1, toLevel: 3, via: 'elevator' });
  });

  it('reads height differences only: an offset of the reference changes nothing', () => {
    const a = climb(3.9, 0.3, 0, 'b_stairs').events;
    const b = climb(3.9, 0.3, 1013.25 / 0.12, 'b_stairs').events;
    const strip = (events: NavEvent[]) => events.map((e) => (e.type === 'FLOOR_CHANGED' ? { ...e, dHM: Math.round(e.dHM * 1e6) / 1e6 } : e));
    expect(a.length).toBeGreaterThan(0);
    expect(strip(b)).toEqual(strip(a));
  });

  it('does not change floor for less than half a floor', () => {
    const { events, nav } = climb(1.2, 0.3, 5, 'b_stairs');
    expect(events.filter((e) => e.type === 'FLOOR_CHANGED')).toHaveLength(0);
    expect(nav.level).toBe(1);
  });
});

describe('navStep purity', () => {
  it('does not change the state it is given', () => {
    const nav = initialNavState(0);
    const frozen = JSON.stringify(nav);
    const fix: SensorFix = { tMs: 1000, lat: toLat(netB.frame, 0), lng: toLng(netB.frame, 0), accuracyM: 5 };
    const state = createMatcherState();
    const r = matchStep(netB, state, fix);
    navStep(nav, r, fix, { net: netB, route: null });
    expect(JSON.stringify(nav)).toBe(frozen);
  });

  it('keeps unknown route nodes out of the nav route', () => {
    const route = buildNavRoute(netB, ['s_w', 'nope', 's_mid', 's_mid', 'o_door']);
    expect(route.nodeIds).toEqual(['s_w', 's_mid', 'o_door']);
    const pts: XY[] = [...route.xs].map((v, i) => [v, route.ys[i]!]);
    expect(pts).toHaveLength(3);
  });
});
