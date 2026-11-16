// Types and default parameters of the pedestrian GPS map matcher and the indoor / outdoor navigation state machine
// (docs/MAP_MATCHING.md). Everything here is plain data; the step functions live in hmm.ts and nav.ts.
import type { CandidateSet, MatchNetwork } from './network.ts';
import type { NavRoute } from './nav.ts';

/**
 * One sensor sample, normally one per second. `tMs` is the only clock the matcher reads (milliseconds, any epoch, must
 * not go backwards). Optional readings that the phone does not have are left out.
 */
export interface SensorFix {
  tMs: number;
  lat: number;
  lng: number;
  /** Horizontal accuracy (68 % radius) reported by the location API, metres. */
  accuracyM: number;
  /** GPS speed over ground, m/s. */
  speedMps?: number;
  /** GPS course over ground, degrees clockwise from north (only meaningful while moving). */
  headingDeg?: number;
  /** Compass heading of the phone, degrees clockwise from north. */
  compassDeg?: number;
  /**
   * Height change from the caller's own reference, metres, from the barometer: the caller converts hPa to metres
   * (about 0.12 hPa per metre near the ground, up = positive). Never an absolute pressure or altitude.
   */
  baroDeltaM?: number;
  /** Cumulative pedometer count (monotonic). Used as a speed hint when speedMps is missing. */
  steps?: number;
}

/** Tuning of the matcher. DEFAULT_MATCH_PARAMS holds the design values (docs/MAP_MATCHING.md, parameter table). */
export interface MatchParams {
  /** Network candidates kept per fix (K). */
  maxCandidates: number;
  /** Back-pointer ring buffer length (W fixes). */
  windowSize: number;
  /** Fixed-lag smoothing delay (L) for the path history and portal decisions, ms. */
  lagMs: number;
  /** sigma = clamp(accuracyM * sigmaPerAccuracy, sigmaMinM, sigmaMaxM). */
  sigmaPerAccuracy: number;
  sigmaMinM: number;
  sigmaMaxM: number;
  /** Candidate radius R = clamp(radiusSigmaMult * sigma, radiusMinM, radiusMaxM). */
  radiusSigmaMult: number;
  radiusMinM: number;
  radiusMaxM: number;
  /** Log emission of the off-network (free) pseudo-state, nats. */
  freeEmission: number;
  /** Cost of switching between the network and the free state, nats. */
  freeSwitchCost: number;
  /** A fix with accuracy above this (or a NaN coordinate) is no observation. */
  outlierAccuracyM: number;
  /** A fix that moved more than vMaxMps * dt from the previous one gets sigma times this. */
  jumpSigmaMult: number;
  /** Fastest plausible walking speed, m/s. */
  vMaxMps: number;
  /** beta = max(betaMinM, (sigma_prev + sigma) / 2). */
  betaMinM: number;
  /** A transition is impossible when d_route > vMaxMps * dt + feasibilitySigmaMult * sigma_bar. */
  feasibilitySigmaMult: number;
  /** Heading weights (kappa) and when each heading source is used. */
  gpsCourseKappa: number;
  gpsCourseMinSpeedMps: number;
  compassKappa: number;
  pathKappa: number;
  /** The matched-path heading uses the movement over this long, ms, and only when it moved at least pathHeadingMinM. */
  pathHeadingWindowMs: number;
  pathHeadingMinM: number;
  /** Stationary mode: enter after stationaryEnterFixes fixes below stationaryEnterMps, leave above stationaryExitMps. */
  stationaryEnterMps: number;
  stationaryEnterFixes: number;
  stationaryExitMps: number;
  /** Emission weight while stationary. */
  stationaryEmissionWeight: number;
  /** Step length used to turn pedometer counts into a speed, m. */
  stepLengthM: number;
  /** The shown candidate changes only when the best one beats it by this much, nats. */
  displaySwitchNats: number;
  /** ...except onto an edge through a node the shown point is within this distance of, m. */
  nodePassM: number;
  /** A gap between used fixes longer than this restarts the HMM, ms. */
  maxGapMs: number;
  /** Upper bound of one bounded Dijkstra search, m. */
  maxSearchM: number;
}

export const DEFAULT_MATCH_PARAMS: Readonly<MatchParams> = Object.freeze({
  maxCandidates: 8,
  windowSize: 20,
  lagMs: 4000,
  sigmaPerAccuracy: 1.0,
  sigmaMinM: 5,
  sigmaMaxM: 30,
  radiusSigmaMult: 3,
  radiusMinM: 20,
  radiusMaxM: 80,
  freeEmission: -4.5,
  freeSwitchCost: 3,
  outlierAccuracyM: 50,
  jumpSigmaMult: 3,
  vMaxMps: 3.5,
  betaMinM: 3,
  feasibilitySigmaMult: 3,
  gpsCourseKappa: 2.0,
  gpsCourseMinSpeedMps: 1.0,
  compassKappa: 0.8,
  pathKappa: 1.0,
  pathHeadingWindowMs: 3000,
  pathHeadingMinM: 2,
  stationaryEnterMps: 0.5,
  stationaryEnterFixes: 2,
  stationaryExitMps: 0.8,
  stationaryEmissionWeight: 0.3,
  stepLengthM: 0.7,
  displaySwitchNats: 1.5,
  nodePassM: 3,
  maxGapMs: 30000,
  maxSearchM: 400,
});

/** One point of the matched path. */
export interface MatchPoint {
  tMs: number;
  /** The walk edge, or null for the off-network (free) state, whose position is the fix itself. */
  edgeId: string | null;
  /** Share of the edge from its `from` node, 0–1 (0 when free). */
  t: number;
  /** Local metres (MatchNetwork.frame). */
  x: number;
  y: number;
  lat: number;
  lng: number;
  free: boolean;
}

/** What one matchStep gives back. */
export interface MatchResult extends MatchPoint {
  /** Posterior probability of the best state among this fix's states (softmax of the running scores), 0–1. */
  confidence: number;
  /** Stationary mode is on: the position is held. */
  stationary: boolean;
  /** The fix was no observation (outlier): the state did not move and the position is the previous one. */
  skipped: boolean;
  /** The shown state is not the continuation of the previously shown one (a hysteresis switch). */
  switched: boolean;
  /** No transition was possible, so the HMM started again from this fix (HMM break). */
  restarted: boolean;
  /** sigma used for this fix, m (NaN when skipped). */
  sigmaM: number;
  /** Distance from the fix to the nearest network candidate, m (Infinity when none is within the radius). */
  networkDistM: number;
  /** The best path's state lagMs ago (fixed-lag smoothing), null until the buffer reaches that far. */
  lagged: MatchPoint | null;
}

/**
 * Which edges may become candidates. Floor numbers are used here only to filter candidates (and for the shown floor),
 * never to connect anything: connections come from the network's edges.
 * - ground: outdoor edges, portals and the indoor edges of a building's ground_levels (the default outdoors).
 * - floor: one building floor: its flat edges, the portals, steps and bridges that touch it (indoors, floor known).
 * - all: every walk edge.
 */
export type MatchScope =
  | { kind: 'ground' }
  | { kind: 'all' }
  | { kind: 'floor'; buildingId: string; level: number };

/**
 * The matcher's working memory. matchStep updates it IN PLACE (no allocation per fix apart from the result object),
 * so hold one per tracking session and do not share it. All arrays are fixed size, made by createMatcherState.
 * The fields are internal; read results through MatchResult and smoothedPath.
 */
export interface MatcherState {
  readonly K: number;
  readonly W: number;
  scope: MatchScope;
  /** The network of the fixes so far (set by matchStep; a different network resets the state). */
  net: MatchNetwork | null;
  /** Number of fixes used (not skipped) since the start. */
  steps: number;
  /** Ring buffer index of the newest slot, −1 before the first fix. */
  head: number;
  /** Slots filled (at most W). */
  filled: number;
  // Ring buffer, slot s, state k: index s * (K + 1) + k; k = K is the free state.
  readonly slotT: Float64Array;
  readonly slotCount: Int32Array;
  readonly slotEdge: Int32Array;
  readonly slotPos: Float64Array; // t along the edge
  readonly slotX: Float64Array;
  readonly slotY: Float64Array;
  /** Index of the best predecessor in the previous slot, −1 for none (start or HMM break). */
  readonly slotBack: Int16Array;
  // Running scores of the newest slot (log, max-normalised to 0), index k as above.
  readonly score: Float64Array;
  // Scratch for the next slot.
  readonly nextScore: Float64Array;
  readonly nextBack: Int16Array;
  readonly emission: Float64Array;
  /** Heading term per network candidate of the fix being processed. */
  readonly headTerm: Float64Array;
  readonly cand: CandidateSet;
  /** Best (argmax) and shown state index in the newest slot, −1 before the first fix. */
  best: number;
  display: number;
  /** Last used fix. */
  lastTMs: number;
  lastX: number;
  lastY: number;
  lastSigma: number;
  lastSteps: number;
  /** Stationary mode. */
  stationary: boolean;
  slowCount: number;
  /** Shown positions of the last few fixes (ring), for the matched-path heading. */
  readonly histT: Float64Array;
  readonly histX: Float64Array;
  readonly histY: Float64Array;
  histHead: number;
  histCount: number;
  /** Last result, returned again (marked skipped) for an outlier. */
  last: MatchResult | null;
}

/** A portal edge (edge_type 'portal') between an outdoor node and a building's entrance. */
export interface PortalRef {
  edgeId: string;
  buildingId: string;
  /** Floor of the indoor end (display / candidate filter only). */
  level: number | null;
  outdoorNode: string;
  indoorNode: string;
}

export type NavMode = 'OUTDOOR' | 'APPROACHING' | 'PORTAL' | 'INDOOR' | 'OFF_NETWORK_SUSPECT';

export type RerouteReason = 'off_network' | 'off_route';

/** How a floor change happened, from the vertical edge kind and the pressure rate only. */
export type VerticalVia = 'stairs' | 'escalator' | 'elevator' | 'unknown';

export type NavEvent =
  | { type: 'MODE_CHANGED'; tMs: number; from: NavMode; to: NavMode; portal: PortalRef | null }
  | { type: 'REROUTE'; tMs: number; reason: RerouteReason }
  | { type: 'FLOOR_CHANGED'; tMs: number; buildingId: string; fromLevel: number; toLevel: number; via: VerticalVia; dHM: number };

/** Barometric floor tracking inside a building. */
export interface FloorTrack {
  /** baroDeltaM at the portal crossing (dH = 0 there), null until then. */
  refBaroM: number | null;
  /** Floor at the portal crossing: floor heights are measured from it. */
  refLevel: number | null;
  lastDH: number | null;
  lastBaroMs: number | null;
  /** Since when |d(dH)/dt| has stayed below floorSettleRateMps. */
  settleSinceMs: number | null;
  /** Largest |d(dH)/dt| since the last confirmed floor, m/s. */
  peakRateMps: number;
  /** Vertical edge kind the matcher was on since the last confirmed floor. */
  verticalKind: 'stairs' | 'escalator' | null;
}

/** State of the navigation machine. navStep never changes it; it returns a new one. */
export interface NavState {
  mode: NavMode;
  /** When the current mode started, ms. */
  sinceMs: number;
  /** The portal being approached, crossed or last used. */
  portal: PortalRef | null;
  /** In PORTAL: going in or coming out. */
  portalDirection: 'entering' | 'exiting' | null;
  /** Building and floor while indoors (floor: display / candidate filter only). */
  buildingId: string | null;
  level: number | null;
  lastFixMs: number | null;
  lastValidFixMs: number | null;
  gpsBadSinceMs: number | null;
  gpsGoodSinceMs: number | null;
  /** PORTAL: since when the lagged position has been past the indoor end. */
  insideSinceMs: number | null;
  /** Off-network time, accumulated while moving (paused while stationary), ms. */
  offNetworkMs: number;
  /** Back-on-network time in OFF_NETWORK_SUSPECT, ms. */
  onNetworkMs: number;
  /** Off-route time, accumulated while moving, ms. */
  offRouteMs: number;
  lastRerouteMs: number | null;
  /** Recent shown positions (local m), newest last, for the movement heading. */
  trackT: readonly number[];
  trackX: readonly number[];
  trackY: readonly number[];
  floor: FloorTrack;
}

/** What navStep needs besides the fix and the match result. */
export interface NavContext {
  net: MatchNetwork;
  /** The planned route, or null when no route is being followed (then nothing is off-route). */
  route: NavRoute | null;
}

/** Tuning of the navigation machine. DEFAULT_NAV_PARAMS holds the design values. */
export interface NavParams {
  gpsBadAccuracyM: number;
  gpsGapMs: number;
  gpsGoodAccuracyM: number;
  nearPortalM: number;
  /** APPROACHING → OUTDOOR when the portal is farther than this (hysteresis over nearPortalM). */
  leavePortalM: number;
  approachHeadingDeg: number;
  /** APPROACHING → PORTAL: share of the portal edge walked from the outdoor end. */
  portalEnterT: number;
  gpsBadPortalMs: number;
  /** PORTAL → INDOOR: the lagged position stays past the indoor end this long. */
  indoorHoldMs: number;
  /** PORTAL (entering) → INDOOR also when the GPS stays bad this long. */
  indoorByGpsLossMs: number;
  /** PORTAL → OUTDOOR: good GPS outside the building this long. */
  outdoorGoodMs: number;
  /** INDOOR → PORTAL: within this of a ground-floor portal with good GPS for exitGoodMs. */
  exitPortalM: number;
  exitGoodMs: number;
  /** OUTDOOR → OFF_NETWORK_SUSPECT: off-network this long; off-network = free dominant or farther than max(suspectMinDistM, suspectSigmaMult * sigma). */
  suspectMs: number;
  suspectMinDistM: number;
  suspectSigmaMult: number;
  /** Free state counts as dominant from this confidence. */
  freeConfidence: number;
  /** OFF_NETWORK_SUSPECT → OUTDOOR: back on the network this long. */
  suspectReturnMs: number;
  /** REROUTE after this long off the network (in OFF_NETWORK_SUSPECT) / off the route. */
  rerouteOffNetworkMs: number;
  rerouteOffRouteMs: number;
  /** Off-route: the shown position is farther than this from the planned route, m. */
  offRouteM: number;
  rerouteCooldownMs: number;
  /** Floor likelihood: Gaussian of dH around each floor's height. */
  floorSigmaM: number;
  /** FLOOR_CHANGED when |d(dH)/dt| stays below this for floorSettleMs. */
  floorSettleRateMps: number;
  floorSettleMs: number;
  /** A vertical rate above this was an elevator. */
  elevatorRateMps: number;
}

export const DEFAULT_NAV_PARAMS: Readonly<NavParams> = Object.freeze({
  gpsBadAccuracyM: 20,
  gpsGapMs: 3000,
  gpsGoodAccuracyM: 12,
  nearPortalM: 25,
  leavePortalM: 35,
  approachHeadingDeg: 60,
  portalEnterT: 0.5,
  gpsBadPortalMs: 3000,
  indoorHoldMs: 2000,
  indoorByGpsLossMs: 6000,
  outdoorGoodMs: 5000,
  exitPortalM: 15,
  exitGoodMs: 3000,
  suspectMs: 5000,
  suspectMinDistM: 25,
  suspectSigmaMult: 3,
  freeConfidence: 0.6,
  suspectReturnMs: 3000,
  rerouteOffNetworkMs: 10000,
  rerouteOffRouteMs: 8000,
  offRouteM: 20,
  rerouteCooldownMs: 15000,
  floorSigmaM: 1.0,
  floorSettleRateMps: 0.15,
  floorSettleMs: 2000,
  elevatorRateMps: 0.8,
});
