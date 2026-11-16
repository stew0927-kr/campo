// Indoor / outdoor navigation state machine on top of the matcher (docs/MAP_MATCHING.md 5–7): five modes
// (OUTDOOR, APPROACHING, PORTAL, INDOOR, OFF_NETWORK_SUSPECT), REROUTE events with a cooldown, and barometric floor
// changes from height differences only.
//
// navStep is a pure function: it reads the previous NavState and returns a new one plus the events of this fix. Time
// comes only from fix.tMs. Floor numbers are used for the shown floor and the matcher's candidate filter
// (scopeForNav), never to decide where a path leads.
import { signedAngleDiffDeg, bearingDeg, toX, toY } from './geo.ts';
import { EDGE_ESCALATOR, EDGE_INDOOR, EDGE_STEPS, isInsideBuilding, nearestPortal, portalDistance, type MatchNetwork } from './network.ts';
import {
  DEFAULT_NAV_PARAMS,
  type FloorTrack,
  type MatchResult,
  type MatchScope,
  type NavContext,
  type NavEvent,
  type NavMode,
  type NavParams,
  type NavState,
  type PortalRef,
  type SensorFix,
  type VerticalVia,
} from './types.ts';

/** A planned route as a polyline of network nodes (from findRoute's node list). */
export interface NavRoute {
  nodeIds: string[];
  xs: Float64Array;
  ys: Float64Array;
}

/** The route's nodes that the network knows, in order, as local points. */
export function buildNavRoute(net: MatchNetwork, nodeIds: readonly string[]): NavRoute {
  const kept: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const id of nodeIds) {
    const i = net.nodeIndex.get(id);
    if (i === undefined) continue;
    if (kept[kept.length - 1] === id) continue;
    kept.push(id);
    xs.push(net.nodeX[i]!);
    ys.push(net.nodeY[i]!);
  }
  return { nodeIds: kept, xs: Float64Array.from(xs), ys: Float64Array.from(ys) };
}

/** Distance from (x, y) to the route and the next route node after the nearest stretch. */
function routeProgress(route: NavRoute, x: number, y: number): { distM: number; next: string | null } {
  const n = route.xs.length;
  if (n === 0) return { distM: Infinity, next: null };
  if (n === 1) return { distM: Math.hypot(x - route.xs[0]!, y - route.ys[0]!), next: route.nodeIds[0]! };
  let best = Infinity;
  let next: string | null = null;
  for (let i = 0; i < n - 1; i++) {
    const ax = route.xs[i]!;
    const ay = route.ys[i]!;
    const vx = route.xs[i + 1]! - ax;
    const vy = route.ys[i + 1]! - ay;
    const len2 = vx * vx + vy * vy;
    const s = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / len2)) : 0;
    const d = Math.hypot(ax + s * vx - x, ay + s * vy - y);
    if (d < best) {
      best = d;
      next = route.nodeIds[i + 1]!;
    }
  }
  return { distM: best, next };
}

const emptyFloor = (): FloorTrack => ({
  refBaroM: null,
  refLevel: null,
  lastDH: null,
  lastBaroMs: null,
  settleSinceMs: null,
  peakRateMps: 0,
  verticalKind: null,
});

/** Start state. Indoors, pass the building and floor the walker starts on. */
export function initialNavState(tMs: number, mode: NavMode = 'OUTDOOR', where: { buildingId: string; level: number | null } | null = null): NavState {
  return {
    mode,
    sinceMs: tMs,
    portal: null,
    portalDirection: null,
    buildingId: where?.buildingId ?? null,
    level: where?.level ?? null,
    lastFixMs: null,
    lastValidFixMs: null,
    gpsBadSinceMs: null,
    gpsGoodSinceMs: null,
    insideSinceMs: null,
    offNetworkMs: 0,
    onNetworkMs: 0,
    offRouteMs: 0,
    lastRerouteMs: null,
    trackT: [],
    trackX: [],
    trackY: [],
    floor: { ...emptyFloor(), refLevel: where?.level ?? null },
  };
}

/** Which edges the matcher should take candidates from in this mode. */
export function scopeForNav(nav: NavState): MatchScope {
  if (nav.mode === 'INDOOR' && nav.buildingId !== null && nav.level !== null) return { kind: 'floor', buildingId: nav.buildingId, level: nav.level };
  return { kind: 'ground' };
}

const TRACK = 6;

/** Movement heading: GPS course while moving, else the shown track over 3 s, else the compass. NaN for none. */
function movementHeading(nav: NavState, fix: SensorFix, stationary: boolean): number {
  if (stationary) return Number.NaN;
  if (fix.headingDeg !== undefined && Number.isFinite(fix.headingDeg) && (fix.speedMps ?? 0) >= 1) return fix.headingDeg;
  const n = nav.trackT.length;
  if (n >= 2) {
    let i = n - 1;
    while (i > 0 && nav.trackT[i - 1]! >= fix.tMs - 3000) i--;
    const dx = nav.trackX[n - 1]! - nav.trackX[i]!;
    const dy = nav.trackY[n - 1]! - nav.trackY[i]!;
    if (Math.hypot(dx, dy) >= 2) return bearingDeg(dx, dy);
  }
  if (fix.compassDeg !== undefined && Number.isFinite(fix.compassDeg)) return fix.compassDeg;
  return Number.NaN;
}

/** Share of the portal edge walked from its outdoor end, for a point on that edge. */
function shareFromOutdoor(net: MatchNetwork, portal: PortalRef, edgeId: string, t: number): number | null {
  if (edgeId !== portal.edgeId) return null;
  const e = net.edgeIndex.get(edgeId)!;
  return net.nodeIds[net.edgeFrom[e]!] === portal.outdoorNode ? t : 1 - t;
}

/** Whether a matched point is past the portal's indoor end (on an indoor edge of that building, or at the end). */
function pastIndoorEnd(net: MatchNetwork, portal: PortalRef, point: { edgeId: string | null; t: number }): boolean {
  if (point.edgeId === null) return false;
  const share = shareFromOutdoor(net, portal, point.edgeId, point.t);
  if (share !== null) return share >= 0.999;
  const e = net.edgeIndex.get(point.edgeId);
  if (e === undefined || (net.edgeFlags[e]! & EDGE_INDOOR) === 0) return false;
  const b = net.buildingIds.indexOf(portal.buildingId);
  return net.nodeBuilding[net.edgeFrom[e]!] === b || net.nodeBuilding[net.edgeTo[e]!] === b;
}

/** Elapsed ms of a condition that has held since `since`, counted from the start of the mode at the earliest. */
const heldFor = (since: number | null, modeSince: number, t: number): number => (since === null ? 0 : t - Math.max(since, modeSince));

/**
 * One navigation step for one fix and its match result. Returns the next state and the events of this fix (mode
 * changes, REROUTE, FLOOR_CHANGED). Pure: `nav` is not changed.
 */
export function navStep(
  nav: NavState,
  result: MatchResult,
  fix: SensorFix,
  ctx: NavContext,
  params: Readonly<NavParams> = DEFAULT_NAV_PARAMS,
): { nav: NavState; events: NavEvent[] } {
  const p = params;
  const net = ctx.net;
  const t = fix.tMs;
  const events: NavEvent[] = [];
  const next: NavState = { ...nav, floor: { ...nav.floor } };

  // Evidence.
  const valid = Number.isFinite(fix.lat) && Number.isFinite(fix.lng) && Number.isFinite(fix.accuracyM);
  const gapMs = nav.lastValidFixMs === null ? 0 : t - nav.lastValidFixMs;
  const gpsBad = !valid || fix.accuracyM > p.gpsBadAccuracyM || gapMs > p.gpsGapMs;
  const gpsGood = valid && fix.accuracyM <= p.gpsGoodAccuracyM && gapMs <= p.gpsGapMs;
  next.gpsBadSinceMs = gpsBad ? (nav.gpsBadSinceMs ?? (gapMs > p.gpsGapMs && nav.lastValidFixMs !== null ? nav.lastValidFixMs : t)) : null;
  next.gpsGoodSinceMs = gpsGood ? (nav.gpsGoodSinceMs ?? t) : null;
  next.lastFixMs = t;
  if (valid) next.lastValidFixMs = t;
  const dt = nav.lastFixMs === null ? 0 : Math.max(0, t - nav.lastFixMs);

  const hasPos = Number.isFinite(result.x) && Number.isFinite(result.y);
  const x = result.x;
  const y = result.y;
  const fixX = valid ? toX(net.frame, fix.lng) : Number.NaN;
  const fixY = valid ? toY(net.frame, fix.lat) : Number.NaN;
  const moving = !result.stationary;
  const judged = hasPos && !result.skipped; // a skipped fix says nothing new about off-network / off-route
  const heading = movementHeading(nav, fix, result.stationary);
  if (hasPos && !result.skipped) {
    next.trackT = [...nav.trackT, t].slice(-TRACK);
    next.trackX = [...nav.trackX, x].slice(-TRACK);
    next.trackY = [...nav.trackY, y].slice(-TRACK);
  }

  const offNetwork = judged && ((result.free && result.confidence >= p.freeConfidence) ||
    result.networkDistM > Math.max(p.suspectMinDistM, p.suspectSigmaMult * result.sigmaM));
  const progress = ctx.route !== null && hasPos ? routeProgress(ctx.route, x, y) : null;
  const offRoute = judged && progress !== null && progress.distM > p.offRouteM;

  const enter = (mode: NavMode, portal: PortalRef | null = next.portal) => {
    events.push({ type: 'MODE_CHANGED', tMs: t, from: next.mode, to: mode, portal });
    next.mode = mode;
    next.sinceMs = t;
    next.portal = portal;
    next.insideSinceMs = null;
  };
  const canReroute = () => next.lastRerouteMs === null || t - next.lastRerouteMs >= p.rerouteCooldownMs;
  const reroute = (reason: 'off_network' | 'off_route') => {
    events.push({ type: 'REROUTE', tMs: t, reason });
    next.lastRerouteMs = t;
    next.offRouteMs = 0;
    if (reason === 'off_network') next.offNetworkMs = 0;
  };

  const outdoorish = nav.mode === 'OUTDOOR' || nav.mode === 'APPROACHING' || nav.mode === 'OFF_NETWORK_SUSPECT';
  // Off-route time (outdoors only: indoors the GPS cannot tell). Paused while stationary or without a judgement.
  if (!outdoorish || progress === null) next.offRouteMs = 0;
  else if (judged && moving) next.offRouteMs = offRoute ? nav.offRouteMs + dt : 0;

  switch (nav.mode) {
    case 'OUTDOOR': {
      if (judged && moving) next.offNetworkMs = offNetwork ? nav.offNetworkMs + dt : 0;
      const np = hasPos ? nearestPortal(net, x, y) : null;
      if (next.offNetworkMs >= p.suspectMs) {
        next.offNetworkMs = 0;
        next.onNetworkMs = 0;
        enter('OFF_NETWORK_SUSPECT', null);
      } else if (np !== null && np.distM <= p.nearPortalM) {
        const portal = net.portals[np.index]!;
        const routeSaysPortal = progress !== null && (progress.next === portal.outdoorNode || progress.next === portal.indoorNode);
        let toward = false;
        if (!Number.isNaN(heading)) {
          let target = net.nodeIndex.get(portal.outdoorNode)!;
          if (Math.hypot(net.nodeX[target]! - x, net.nodeY[target]! - y) < 3) target = net.nodeIndex.get(portal.indoorNode)!;
          const b = bearingDeg(net.nodeX[target]! - x, net.nodeY[target]! - y);
          toward = Number.isNaN(b) || Math.abs(signedAngleDiffDeg(heading, b)) <= p.approachHeadingDeg;
        }
        if (routeSaysPortal || toward) enter('APPROACHING', portal);
      }
      break;
    }
    case 'APPROACHING': {
      const portal = nav.portal!;
      const pIdx = net.portals.findIndex((q) => q.edgeId === portal.edgeId);
      const dPortal = hasPos && pIdx >= 0 ? portalDistance(net, pIdx, x, y) : Infinity;
      const lag = result.lagged;
      const share = lag !== null && lag.edgeId !== null ? shareFromOutdoor(net, portal, lag.edgeId, lag.t) : null;
      const badLong = heldFor(next.gpsBadSinceMs, nav.sinceMs, t) >= p.gpsBadPortalMs;
      if ((share !== null && share > p.portalEnterT) || (lag !== null && pastIndoorEnd(net, portal, lag)) || (badLong && dPortal <= p.nearPortalM)) {
        next.portalDirection = 'entering';
        enter('PORTAL', portal);
      } else if (hasPos && dPortal > p.leavePortalM) {
        enter('OUTDOOR', null);
      }
      break;
    }
    case 'PORTAL': {
      const portal = nav.portal!;
      const outside = valid && !isInsideBuilding(net, portal.buildingId, fixX, fixY);
      const goodOutside = outside && heldFor(next.gpsGoodSinceMs, nav.sinceMs, t) >= p.outdoorGoodMs;
      const lostGps = heldFor(next.gpsBadSinceMs, nav.sinceMs, t) >= p.indoorByGpsLossMs;
      if (nav.portalDirection === 'entering') {
        const lag = result.lagged;
        const inside = lag !== null && pastIndoorEnd(net, portal, lag);
        next.insideSinceMs = inside ? (nav.insideSinceMs ?? t) : null;
        if ((next.insideSinceMs !== null && t - next.insideSinceMs >= p.indoorHoldMs) || lostGps) {
          enterIndoor(next, portal, fix, t, enter);
        } else if (goodOutside) {
          next.portalDirection = null;
          enter('OUTDOOR', null); // false alarm
        }
      } else {
        if (goodOutside) {
          next.portalDirection = null;
          next.buildingId = null;
          next.level = null;
          next.floor = emptyFloor();
          enter('OUTDOOR', portal);
        } else if (lostGps) {
          enterIndoor(next, portal, fix, t, enter);
        }
      }
      break;
    }
    case 'INDOOR': {
      floorStep(next, result, fix, net, p, events);
      if (hasPos && next.buildingId !== null) {
        const b = next.buildingId;
        const level = next.level;
        const np = nearestPortal(net, x, y, (q) => q.buildingId === b && (level === null || q.level === level));
        if (np !== null && np.distM <= p.exitPortalM && heldFor(next.gpsGoodSinceMs, nav.sinceMs, t) >= p.exitGoodMs) {
          next.portalDirection = 'exiting';
          enter('PORTAL', net.portals[np.index]!);
        }
      }
      break;
    }
    case 'OFF_NETWORK_SUSPECT': {
      if (judged && moving) {
        if (offNetwork) {
          next.offNetworkMs = nav.offNetworkMs + dt;
          next.onNetworkMs = 0;
        } else {
          next.onNetworkMs = nav.onNetworkMs + dt;
        }
      }
      if (next.onNetworkMs >= p.suspectReturnMs) {
        next.offNetworkMs = 0;
        next.onNetworkMs = 0;
        enter('OUTDOOR', null);
      } else if (next.offNetworkMs >= p.rerouteOffNetworkMs && canReroute()) {
        reroute('off_network');
      }
      break;
    }
  }

  if (outdoorish && next.offRouteMs >= p.rerouteOffRouteMs && canReroute()) reroute('off_route');
  if (next.mode === 'INDOOR' || next.mode === 'PORTAL') {
    next.offNetworkMs = 0;
    next.onNetworkMs = 0;
  }
  return { nav: next, events };
}

function enterIndoor(next: NavState, portal: PortalRef, fix: SensorFix, t: number, enter: (mode: NavMode, portal?: PortalRef | null) => void): void {
  next.portalDirection = null;
  next.buildingId = portal.buildingId;
  next.level = portal.level;
  // dH = 0 at the portal crossing.
  const baro = fix.baroDeltaM !== undefined && Number.isFinite(fix.baroDeltaM) ? fix.baroDeltaM : null;
  next.floor = { ...emptyFloor(), refBaroM: baro, refLevel: portal.level, lastDH: baro === null ? null : 0, lastBaroMs: baro === null ? null : t };
  enter('INDOOR', portal);
}

/** Barometric floor tracking: nearest floor height (Gaussian, floorSigmaM) confirmed once the climb has settled. */
function floorStep(next: NavState, result: MatchResult, fix: SensorFix, net: MatchNetwork, p: Readonly<NavParams>, events: NavEvent[]): void {
  const f = next.floor;
  const t = fix.tMs;
  if (result.edgeId !== null && !result.skipped) {
    const e = net.edgeIndex.get(result.edgeId);
    if (e !== undefined) {
      const flags = net.edgeFlags[e]!;
      if (flags & EDGE_ESCALATOR) f.verticalKind = 'escalator';
      else if (flags & EDGE_STEPS) f.verticalKind = 'stairs';
    }
  }
  if (fix.baroDeltaM === undefined || !Number.isFinite(fix.baroDeltaM)) return;
  if (f.refBaroM === null) {
    f.refBaroM = fix.baroDeltaM;
    f.refLevel = next.level;
  }
  const dH = fix.baroDeltaM - f.refBaroM;
  if (f.lastDH !== null && f.lastBaroMs !== null && t > f.lastBaroMs) {
    const rate = (dH - f.lastDH) / ((t - f.lastBaroMs) / 1000);
    f.peakRateMps = Math.max(f.peakRateMps, Math.abs(rate));
    f.settleSinceMs = Math.abs(rate) < p.floorSettleRateMps ? (f.settleSinceMs ?? f.lastBaroMs) : null;
  }
  f.lastDH = dH;
  f.lastBaroMs = t;

  const building = next.buildingId === null ? undefined : net.buildings.get(next.buildingId);
  if (building === undefined || next.level === null || f.refLevel === null) return;
  const refBase = building.levelBaseM.get(f.refLevel);
  if (refBase === undefined) return;
  // Most likely floor: the Gaussian likelihood exp(-0.5 ((dH - h) / sigma)^2) is largest at the nearest height.
  let best: number | null = null;
  let bestLog = -Infinity;
  for (const [level, base] of building.levelBaseM) {
    const z = (dH - (base - refBase)) / p.floorSigmaM;
    const log = -0.5 * z * z;
    if (log > bestLog) {
      bestLog = log;
      best = level;
    }
  }
  if (best === null || best === next.level) return;
  if (f.settleSinceMs === null || t - f.settleSinceMs < p.floorSettleMs) return;
  const via: VerticalVia = f.peakRateMps >= p.elevatorRateMps ? 'elevator' : (f.verticalKind ?? 'unknown');
  events.push({ type: 'FLOOR_CHANGED', tMs: t, buildingId: building.id, fromLevel: next.level, toLevel: best, via, dHM: dH });
  next.level = best;
  f.peakRateMps = 0;
  f.verticalKind = null;
}

const levelLabel = (level: number) => (level < 0 ? `지하 ${-level}층` : `${level}층`);
const VIA_LABEL: Record<VerticalVia, string> = { stairs: '계단으로 ', escalator: '에스컬레이터로 ', elevator: '엘리베이터로 ', unknown: '' };

/** What to tell the walker about an event (Korean, polite), or null when it needs no message. */
export function navEventMessage(event: NavEvent): string | null {
  switch (event.type) {
    case 'REROUTE':
      return event.reason === 'off_route' ? '경로를 벗어나셨습니다. 새 경로를 찾고 있습니다.' : '지도에 없는 길로 가고 계십니다. 새 경로를 찾고 있습니다.';
    case 'FLOOR_CHANGED':
      return `${VIA_LABEL[event.via]}${levelLabel(event.toLevel)}에 도착하셨습니다.`;
    case 'MODE_CHANGED':
      switch (event.to) {
        case 'APPROACHING':
          return '건물 출입구에 가까워지고 있습니다.';
        case 'INDOOR':
          return '건물 안으로 들어오셨습니다.';
        case 'OFF_NETWORK_SUSPECT':
          return '길을 벗어나신 것 같습니다. 위치를 확인하고 있습니다.';
        case 'OUTDOOR':
          if (event.from === 'PORTAL' && event.portal !== null) return '건물 밖으로 나오셨습니다.';
          if (event.from === 'OFF_NETWORK_SUSPECT') return '다시 길 위에 계십니다.';
          return null;
        case 'PORTAL':
          return null;
      }
  }
}
