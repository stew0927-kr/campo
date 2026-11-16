// Incremental Viterbi (running max-product) map matcher for pedestrians (docs/MAP_MATCHING.md).
//
// Each fix has at most K network candidates plus one off-network "free" pseudo-state whose position is the fix itself.
// Scores are updated once per fix from the previous fix's scores (no sliding-window rerun); back-pointers are kept in a
// ring buffer of W fixes so the best path can be read back with a fixed lag (smoothedPath, MatchResult.lagged).
//
// IN-PLACE: matchStep mutates the MatcherState it is given (typed arrays allocated once in createMatcherState) and
// returns a fresh MatchResult. Hold one state per tracking session. Time comes only from fix.tMs: no Date.now, no
// randomness, no I/O, so a recorded trace replays exactly.
//
// Floor numbers are not read here; candidate filtering by floor happens in network.ts (MatchScope).
import { bearingDeg, cosToBearing, toLat, toLng, toX, toY } from './geo.ts';
import { createCandidateSet, findCandidates, routeDistance, searchFrom, type MatchNetwork } from './network.ts';
import {
  DEFAULT_MATCH_PARAMS,
  type MatchParams,
  type MatchPoint,
  type MatchResult,
  type MatchScope,
  type MatcherState,
  type SensorFix,
} from './types.ts';

const HISTORY = 8;

/** Whether the shown point (slot index `at`) sits within passM of a node that edge `shown` shares with edge `other`. */
function passesThrough(net: MatchNetwork, s: MatcherState, shown: number, at: number, other: number, passM: number): boolean {
  const x = s.slotX[at]!;
  const y = s.slotY[at]!;
  for (const node of [net.edgeFrom[shown]!, net.edgeTo[shown]!]) {
    if (node !== net.edgeFrom[other] && node !== net.edgeTo[other]) continue;
    if (Math.hypot(net.nodeX[node]! - x, net.nodeY[node]! - y) <= passM) return true;
  }
  return false;
}

/** A fresh matcher for one tracking session. */
export function createMatcherState(params: Readonly<MatchParams> = DEFAULT_MATCH_PARAMS, scope: MatchScope = { kind: 'ground' }): MatcherState {
  const K = params.maxCandidates;
  const W = params.windowSize;
  if (!(K >= 1 && K < 32000) || !(W >= 2)) throw new Error('maxCandidates must be 1 or more and windowSize 2 or more');
  const S = K + 1;
  return {
    K,
    W,
    scope,
    net: null,
    steps: 0,
    head: -1,
    filled: 0,
    slotT: new Float64Array(W),
    slotCount: new Int32Array(W),
    slotEdge: new Int32Array(W * S).fill(-1),
    slotPos: new Float64Array(W * S),
    slotX: new Float64Array(W * S),
    slotY: new Float64Array(W * S),
    slotBack: new Int16Array(W * S).fill(-1),
    score: new Float64Array(S).fill(-Infinity),
    nextScore: new Float64Array(S),
    nextBack: new Int16Array(S),
    emission: new Float64Array(S),
    headTerm: new Float64Array(K),
    cand: createCandidateSet(K),
    best: -1,
    display: -1,
    lastTMs: Number.NaN,
    lastX: Number.NaN,
    lastY: Number.NaN,
    lastSigma: Number.NaN,
    lastSteps: Number.NaN,
    stationary: false,
    slowCount: 0,
    histT: new Float64Array(HISTORY),
    histX: new Float64Array(HISTORY),
    histY: new Float64Array(HISTORY),
    histHead: -1,
    histCount: 0,
    last: null,
  };
}

/**
 * Change which edges may become candidates from the next fix on (e.g. a floor scope once indoors). Existing states keep
 * their edges; transitions still follow the whole network.
 */
export function setMatchScope(state: MatcherState, scope: MatchScope): void {
  state.scope = scope;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function point(net: MatchNetwork, tMs: number, edge: number, t: number, x: number, y: number): MatchPoint {
  return { tMs, edgeId: edge >= 0 ? net.edgeIds[edge]! : null, t: edge >= 0 ? t : 0, x, y, lat: toLat(net.frame, y), lng: toLng(net.frame, x), free: edge < 0 };
}

/** State k of ring slot `slot` as a MatchPoint. */
function slotPoint(net: MatchNetwork, s: MatcherState, slot: number, k: number): MatchPoint {
  const i = slot * (s.K + 1) + k;
  return point(net, s.slotT[slot]!, k === s.K ? -1 : s.slotEdge[i]!, s.slotPos[i]!, s.slotX[i]!, s.slotY[i]!);
}

/** Walk back from state k of the newest slot until the slot time is at most untilMs; null when the buffer ends first. */
function backtrack(s: MatcherState, k: number, untilMs: number): { slot: number; k: number } | null {
  if (s.head < 0 || k < 0) return null;
  const S = s.K + 1;
  let slot = s.head;
  let state = k;
  for (let n = 1; s.slotT[slot]! > untilMs; n++) {
    if (n >= s.filled) return null;
    const back = s.slotBack[slot * S + state]!;
    if (back < 0) return null;
    state = back;
    slot = (slot - 1 + s.W) % s.W;
  }
  return { slot, k: state };
}

/**
 * The best path through the fixes in the buffer, oldest first, read back from the current best state. With lagMs > 0,
 * only the points at least that old (the fixed-lag part that later fixes rarely change). Empty before the first fix.
 * Stops at an HMM restart.
 */
export function smoothedPath(state: MatcherState, lagMs = 0): MatchPoint[] {
  const net = state.net;
  if (net === null || state.head < 0 || state.best < 0) return [];
  const S = state.K + 1;
  const out: MatchPoint[] = [];
  const newest = state.slotT[state.head]!;
  let slot = state.head;
  let k = state.best;
  for (let n = 0; n < state.filled; n++) {
    if (state.slotT[slot]! <= newest - lagMs) out.push(slotPoint(net, state, slot, k));
    const back = state.slotBack[slot * S + k]!;
    if (back < 0) break;
    k = back;
    slot = (slot - 1 + state.W) % state.W;
  }
  return out.reverse();
}

/** Heading to compare transitions with: [bearing deg, kappa], or null for none. */
function headingOf(state: MatcherState, fix: SensorFix, speed: number, p: Readonly<MatchParams>): [number, number] | null {
  if (state.stationary) return null;
  if (fix.headingDeg !== undefined && Number.isFinite(fix.headingDeg) && fix.speedMps !== undefined && fix.speedMps >= p.gpsCourseMinSpeedMps) {
    return [fix.headingDeg, p.gpsCourseKappa];
  }
  if (fix.compassDeg !== undefined && Number.isFinite(fix.compassDeg)) return [fix.compassDeg, p.compassKappa];
  // Movement of the shown position over the last pathHeadingWindowMs.
  if (state.histCount < 2 || !(speed >= p.stationaryEnterMps || Number.isNaN(speed))) return null;
  const newest = state.histHead;
  let oldest = newest;
  for (let n = 1; n < state.histCount; n++) {
    const i = (newest - n + HISTORY) % HISTORY;
    if (state.histT[i]! < fix.tMs - p.pathHeadingWindowMs) break;
    oldest = i;
  }
  const dx = state.histX[newest]! - state.histX[oldest]!;
  const dy = state.histY[newest]! - state.histY[oldest]!;
  if (Math.hypot(dx, dy) < p.pathHeadingMinM) return null;
  return [bearingDeg(dx, dy), p.pathKappa];
}

function skipped(state: MatcherState, fix: SensorFix): MatchResult {
  const last = state.last;
  if (last === null) {
    return {
      tMs: fix.tMs, edgeId: null, t: 0, x: Number.NaN, y: Number.NaN, lat: Number.NaN, lng: Number.NaN, free: true,
      confidence: 0, stationary: false, skipped: true, switched: false, restarted: false, sigmaM: Number.NaN,
      networkDistM: Infinity, lagged: null,
    };
  }
  // Nothing moved: the previous answer (and its lagged point) with this fix's time.
  return { ...last, tMs: fix.tMs, skipped: true, switched: false, restarted: false, sigmaM: Number.NaN };
}

/**
 * Feed one fix. Updates `state` in place and returns where the walker is now (the shown state, with hysteresis) and
 * the lagged best-path point.
 */
export function matchStep(net: MatchNetwork, state: MatcherState, fix: SensorFix, params: Readonly<MatchParams> = DEFAULT_MATCH_PARAMS): MatchResult {
  const p = params;
  const K = state.K;
  const S = K + 1;
  if (state.net !== net) {
    if (state.net !== null) resetMatcher(state);
    state.net = net;
  }
  const valid = Number.isFinite(fix.lat) && Number.isFinite(fix.lng) && Number.isFinite(fix.accuracyM) && fix.accuracyM <= p.outlierAccuracyM &&
    Number.isFinite(fix.tMs) && !(state.steps > 0 && fix.tMs < state.lastTMs);
  if (!valid) return skipped(state, fix);

  const x = toX(net.frame, fix.lng);
  const y = toY(net.frame, fix.lat);
  const first = state.steps === 0;
  const dtMs = first ? 0 : fix.tMs - state.lastTMs;
  const dt = dtMs / 1000;
  const disp = first ? 0 : Math.hypot(x - state.lastX, y - state.lastY);

  let sigma = clamp(fix.accuracyM * p.sigmaPerAccuracy, p.sigmaMinM, p.sigmaMaxM);
  if (!first && disp > p.vMaxMps * dt) sigma *= p.jumpSigmaMult;
  const radius = clamp(p.radiusSigmaMult * sigma, p.radiusMinM, p.radiusMaxM);

  // Speed: GPS, else pedometer, else displacement.
  let speed = Number.NaN;
  if (fix.speedMps !== undefined && Number.isFinite(fix.speedMps)) speed = fix.speedMps;
  else if (fix.steps !== undefined && Number.isFinite(fix.steps) && Number.isFinite(state.lastSteps) && dt > 0) speed = ((fix.steps - state.lastSteps) * p.stepLengthM) / dt;
  else if (!first && dt > 0) speed = disp / dt;
  if (!state.stationary) {
    state.slowCount = speed < p.stationaryEnterMps ? state.slowCount + 1 : 0;
    if (state.slowCount >= p.stationaryEnterFixes && state.last !== null) state.stationary = true;
  } else if (speed > p.stationaryExitMps) {
    state.stationary = false;
    state.slowCount = 0;
  }
  const stationary = state.stationary;
  const weight = stationary ? p.stationaryEmissionWeight : 1;

  // Candidates and emissions.
  const cand = state.cand;
  const n = findCandidates(net, x, y, radius, state.scope, cand);
  const em = state.emission;
  for (let j = 0; j < K; j++) em[j] = j < n ? -0.5 * (cand.dist[j]! / sigma) ** 2 * weight : -Infinity;
  em[K] = p.freeEmission * weight;

  const next = state.nextScore;
  const back = state.nextBack;
  next.fill(-Infinity);
  back.fill(-1);
  let restarted = false;
  let fresh = first || dtMs > p.maxGapMs;

  if (!fresh) {
    const prev = state.head;
    const prevCount = state.slotCount[prev]!;
    const score = state.score;
    const dGc = stationary ? 0 : disp;
    const sigmaBar = (state.lastSigma + sigma) / 2;
    const beta = Math.max(p.betaMinM, sigmaBar);
    const limit = p.vMaxMps * dt + p.feasibilitySigmaMult * sigmaBar;
    const searchLimit = Math.min(limit, p.maxSearchM);
    const heading = headingOf(state, fix, speed, p);
    // Heading term of arriving at candidate j: kappa (|cos dTheta| - 1), dTheta between the heading and the edge line at
    // j. Either direction of the line counts (walk edges are walked both ways, U-turns included); comparing with the
    // candidate-to-candidate vector instead would mostly measure GPS noise at walking speed.
    const turn = state.headTerm;
    for (let j = 0; j < n; j++) {
      turn[j] = 0;
      if (heading !== null && (cand.dx[j] !== 0 || cand.dy[j] !== 0)) turn[j] = heading[1] * (Math.abs(cosToBearing(heading[0], cand.dx[j]!, cand.dy[j]!)) - 1);
    }

    for (let i = 0; i < prevCount; i++) {
      const si = score[i]!;
      if (si === -Infinity) continue;
      const idx = prev * S + i;
      const px = state.slotX[idx]!;
      const py = state.slotY[idx]!;
      searchFrom(net, state.slotEdge[idx]!, state.slotPos[idx]!, searchLimit);
      for (let j = 0; j < n; j++) {
        const d = routeDistance(net, cand.edge[j]!, cand.t[j]!);
        if (d > limit) continue;
        const v = si - Math.abs(d - dGc) / beta + turn[j]!;
        if (v > next[j]!) {
          next[j] = v;
          back[j] = i;
        }
      }
      // Network → free.
      if (Math.hypot(x - px, y - py) <= limit) {
        const v = si - p.freeSwitchCost;
        if (v > next[K]!) {
          next[K] = v;
          back[K] = i;
        }
      }
    }
    // From the free state (its position is the previous fix).
    const sf = score[K]!;
    if (sf !== -Infinity) {
      const fx = state.slotX[prev * S + K]!;
      const fy = state.slotY[prev * S + K]!;
      for (let j = 0; j < n; j++) {
        if (Math.hypot(cand.x[j]! - fx, cand.y[j]! - fy) > limit) continue;
        const v = sf - p.freeSwitchCost + turn[j]!;
        if (v > next[j]!) {
          next[j] = v;
          back[j] = K;
        }
      }
      if (disp <= limit) {
        if (sf > next[K]!) {
          next[K] = sf;
          back[K] = K;
        }
      }
    }
    let any = false;
    for (let j = 0; j < S; j++) {
      if (next[j] !== -Infinity) {
        next[j] = next[j]! + em[j]!;
        any = true;
      }
    }
    if (!any) {
      fresh = true;
      restarted = true;
    }
  } else if (!first) {
    restarted = true;
  }
  if (fresh) {
    for (let j = 0; j < S; j++) {
      next[j] = em[j]!;
      back[j] = -1;
    }
  }

  // Normalise, pick the best, store the slot.
  let best = K;
  for (let j = 0; j < S; j++) if (next[j]! > next[best]!) best = j;
  const max = next[best]!;
  let sum = 0;
  for (let j = 0; j < S; j++) {
    state.score[j] = next[j]! - max;
    sum += Math.exp(state.score[j]!);
  }
  const confidence = 1 / sum;

  const prevDisplay = state.display;
  const head = (state.head + 1) % state.W;
  state.head = head;
  state.filled = Math.min(state.filled + 1, state.W);
  state.slotT[head] = fix.tMs;
  state.slotCount[head] = n;
  for (let j = 0; j < S; j++) {
    const idx = head * S + j;
    state.slotBack[idx] = back[j]!;
    if (j < n) {
      state.slotEdge[idx] = cand.edge[j]!;
      state.slotPos[idx] = cand.t[j]!;
      state.slotX[idx] = cand.x[j]!;
      state.slotY[idx] = cand.y[j]!;
    } else {
      state.slotEdge[idx] = -1;
      state.slotPos[idx] = 0;
      state.slotX[idx] = x;
      state.slotY[idx] = y;
    }
  }
  state.best = best;

  // Display hysteresis (docs/MAP_MATCHING.md 4): keep showing the candidate on the shown edge (or the free state) until
  // the best state beats it by displaySwitchNats. Walking on through a node of the shown edge is not a switch: when the
  // shown point is at that node, the best candidate on an edge that shares it is shown at once.
  let display = best;
  let switched = false;
  if (!fresh && prevDisplay >= 0) {
    const prevIdx = (head - 1 + state.W) % state.W * S + prevDisplay;
    const shownEdge = prevDisplay === K ? -1 : state.slotEdge[prevIdx]!;
    let same = -1;
    if (shownEdge < 0) same = K;
    else for (let j = 0; j < n; j++) if (cand.edge[j] === shownEdge) same = j;
    if (same === best || (same >= 0 && next[same] === next[best])) display = same;
    else if (shownEdge >= 0 && best < K && passesThrough(net, state, shownEdge, same >= 0 ? head * S + same : prevIdx, cand.edge[best]!, p.nodePassM)) display = best;
    else if (same >= 0 && next[same] !== -Infinity && next[best]! - next[same]! < p.displaySwitchNats) display = same;
    else switched = true;
  } else if (restarted) {
    switched = true;
  }
  state.display = display;

  const lagRef = backtrack(state, best, fix.tMs - p.lagMs);
  const lagged = lagRef === null ? null : slotPoint(net, state, lagRef.slot, lagRef.k);

  let result: MatchResult;
  const shown = slotPoint(net, state, head, display);
  const base = { confidence, stationary, skipped: false, switched, restarted, sigmaM: sigma, networkDistM: n > 0 ? cand.dist[0]! : Infinity, lagged };
  if (stationary && state.last !== null) {
    // Hold the shown position (taken when stationary mode began).
    const held = state.last;
    result = { tMs: fix.tMs, edgeId: held.edgeId, t: held.t, x: held.x, y: held.y, lat: held.lat, lng: held.lng, free: held.free, ...base };
  } else {
    result = { ...shown, ...base };
  }

  // Bookkeeping.
  state.histHead = (state.histHead + 1) % HISTORY;
  state.histCount = Math.min(state.histCount + 1, HISTORY);
  state.histT[state.histHead] = fix.tMs;
  state.histX[state.histHead] = result.x;
  state.histY[state.histHead] = result.y;
  state.steps++;
  state.lastTMs = fix.tMs;
  state.lastX = x;
  state.lastY = y;
  state.lastSigma = sigma;
  state.lastSteps = fix.steps !== undefined && Number.isFinite(fix.steps) ? fix.steps : Number.NaN;
  state.last = result;
  return result;
}

/** Forget every fix (keeps the arrays and the scope). */
export function resetMatcher(state: MatcherState): void {
  state.steps = 0;
  state.head = -1;
  state.filled = 0;
  state.score.fill(-Infinity);
  state.slotBack.fill(-1);
  state.best = -1;
  state.display = -1;
  state.lastTMs = state.lastX = state.lastY = state.lastSigma = state.lastSteps = Number.NaN;
  state.stationary = false;
  state.slowCount = 0;
  state.histHead = -1;
  state.histCount = 0;
  state.last = null;
}
