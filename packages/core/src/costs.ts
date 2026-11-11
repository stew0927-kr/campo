// Routing costs (SPEC-v0.2 3.1, 3.4). Every tunable number lives in this file.
// One unit: seconds. Link time is the expected travel time; profile penalties
// are added to the search cost only, never to the time.
//
// Decisions here use an edge's own highway / edge_type / step_free and nothing
// else: no floor numbers (AGENTS.md; a test checks this file).
import type { EdgeProperties, NodeType } from './types.ts';

export const PROFILES = ['shortest', 'step_free', 'fewest_steps'] as const;
/**
 * shortest: stairs allowed, plain travel time.
 * step_free: no steps, nothing marked step_free: false; unknown (null) costs a penalty.
 * fewest_steps: the step_free fallback, stairs allowed but each flight costs a big penalty.
 */
export type Profile = (typeof PROFILES)[number];

export function isProfile(value: unknown): value is Profile {
  return (PROFILES as readonly unknown[]).includes(value);
}

/** One value per profile. Written out so that adding a profile is a type error here. */
export function perProfile<T>(f: (profile: Profile) => T): Record<Profile, T> {
  return { shortest: f('shortest'), step_free: f('step_free'), fewest_steps: f('fewest_steps') };
}

// ---- Time (seconds) ----

/** Walking speed, m/s. The A* heuristic speed unless some link is faster in plan (see CampusGraph.heuristicSpeedMps). */
export const WALK_SPEED_MPS = 1.2;
/** Ramp time = length / speed × this. */
export const RAMP_FACTOR = 1.2;
/** One step going up, when a non-outdoor steps edge has step_count (outdoor flights ignore it). */
export const STEP_SEC = 0.55;
/** One indoor floor-to-floor flight (landing to landing) going up, without step_count or flight_sec. */
export const FLOOR_FLIGHT_SEC = 18;
/** Allowed range of an indoor flight's measured flight_sec (values outside are clamped). */
export const FLIGHT_SEC_MIN = 0;
export const FLIGHT_SEC_MAX = 30;
/** Outdoor flight going up (and other non-flight steps without step_count): seconds per metre of plan length … */
export const OUTDOOR_STAIRS_SEC_PER_M = 2;
/** … but at least this. */
export const OUTDOOR_STAIRS_MIN_SEC = 10;
/** Going down a flight takes this share of the time going up (every stairs rule). */
export const DOWNHILL_STAIRS_FACTOR = 2 / 3;
/** Waiting for and getting into the car. Paid once per ride, on the board link. */
export const ELEVATOR_BOARD_SEC = 40;
/** Riding along one elevator edge (neighbouring stops). */
export const ELEVATOR_HOP_SEC = 4;
/** Getting out of the car. */
export const ELEVATOR_ALIGHT_SEC = 3;
/** Going through a portal (entrance door), on top of walking its length. */
export const PORTAL_SEC = 2;

// ---- Preference penalties (seconds, cost only) ----

/** step_free: an edge whose step_free is null (not known yet). */
export const UNKNOWN_STEP_FREE_PENALTY_SEC = 60;
/** fewest_steps: each steps edge (Valhalla's wheelchair stairs penalty default). */
export const FEWEST_STEPS_STAIRS_PENALTY_SEC = 600;

type StepFreeFacts = Pick<EdgeProperties, 'highway' | 'step_free'>;

/**
 * Can a step-free traveller use this edge? (SPEC-v0.2 2.1, audit R19)
 * false for steps and for anything marked step_free: false (a step or a sill,
 * also on ramps and elevators). null / missing (not known) passes; the step_free
 * profile charges UNKNOWN_STEP_FREE_PENALTY_SEC for it instead.
 */
export function isStepFreePassable(edge: StepFreeFacts): boolean {
  if (edge.highway === 'steps') return false;
  return edge.step_free !== false;
}

/** step_free is not known: null, or the key is missing in unvalidated data. */
export function isStepFreeUnknown(edge: StepFreeFacts): boolean {
  return edge.highway !== 'steps' && (edge.step_free === null || edge.step_free === undefined);
}

/**
 * Expected time to walk a footway / corridor / ramp edge of `lengthM` metres
 * (plus PORTAL_SEC on a portal). Steps edges use stairsTimeSec, elevators the
 * ELEVATOR_* constants.
 */
export function walkTimeSec(edge: Pick<EdgeProperties, 'highway' | 'edge_type'>, lengthM: number): number {
  if (edge.highway === 'steps') throw new Error('steps edges are timed by stairsTimeSec');
  let t = lengthM / WALK_SPEED_MPS;
  if (edge.highway === 'ramp') t *= RAMP_FACTOR;
  return t + portalSec(edge);
}

export interface StairsTimeInput {
  edge: Pick<EdgeProperties, 'edge_type' | 'step_count' | 'flight_sec' | 'incline'>;
  /** node_type of the edge's from and to nodes (undefined when unknown). */
  endNodeTypes: readonly [NodeType | undefined, NodeType | undefined];
  /** Geodesic distance between the from / to node positions. */
  planLengthM: number;
  /** 'along': travelled from → to as drawn; 'against': to → from. */
  traversal: 'along' | 'against';
}

/**
 * Expected time on a highway=steps edge, in seconds (user decision, 2026-11-11).
 * The time going up:
 *   - outdoor (edge_type 'outdoor'): plan length only, max(plan length ×
 *     OUTDOOR_STAIRS_SEC_PER_M, OUTDOOR_STAIRS_MIN_SEC). step_count is ignored.
 *   - indoor flight (edge_type 'indoor', both ends stair_landing): a positive
 *     step_count × STEP_SEC, else flight_sec clamped to FLIGHT_SEC_MIN..FLIGHT_SEC_MAX,
 *     else FLOOR_FLIGHT_SEC.
 *   - any other steps edge: a positive step_count × STEP_SEC,
 *     (an elevation-based step-count estimate will go here)
 *     else the outdoor plan-length formula.
 * Going down takes DOWNHILL_STAIRS_FACTOR of that. Down means: `incline` is the
 * direction of travel from → to, read against the traversal; no incline counts as up.
 * No walking time is added, so a flight can be faster than its plan length at
 * WALK_SPEED_MPS: CampusGraph.heuristicSpeedMps keeps A* admissible.
 * A portal's PORTAL_SEC is not part of this; the graph adds it.
 */
export function stairsTimeSec({ edge, endNodeTypes, planLengthM, traversal }: StairsTimeInput): number {
  const steps = edge.step_count;
  const flight = edge.flight_sec;
  const bySteps = typeof steps === 'number' && Number.isFinite(steps) && steps > 0 ? steps * STEP_SEC : null;
  const byPlan = Math.max(planLengthM * OUTDOOR_STAIRS_SEC_PER_M, OUTDOOR_STAIRS_MIN_SEC);
  let up: number;
  if (edge.edge_type === 'outdoor') {
    up = byPlan;
  } else if (edge.edge_type === 'indoor' && endNodeTypes[0] === 'stair_landing' && endNodeTypes[1] === 'stair_landing') {
    up = bySteps ?? (typeof flight === 'number' && Number.isFinite(flight)
      ? Math.min(Math.max(flight, FLIGHT_SEC_MIN), FLIGHT_SEC_MAX)
      : FLOOR_FLIGHT_SEC);
  } else {
    // (an elevation-based step-count estimate will go here, between step_count and plan length)
    up = bySteps ?? byPlan;
  }
  const downhill = traversal === 'along' ? edge.incline === 'down' : edge.incline === 'up';
  return downhill ? up * DOWNHILL_STAIRS_FACTOR : up;
}

/** PORTAL_SEC on a portal edge (going through the entrance door), else 0. */
export function portalSec(edge: Pick<EdgeProperties, 'edge_type'>): number {
  return edge.edge_type === 'portal' ? PORTAL_SEC : 0;
}

/**
 * Is a link over `edge` closed to `profile`? Board / alight links have no edge
 * of their own (null) and are never closed by a profile (overrides close them).
 */
export function isClosedFor(edge: StepFreeFacts | null, profile: Profile): boolean {
  if (edge === null) return false;
  return profile === 'step_free' && !isStepFreePassable(edge);
}

/** Preference penalty in seconds for a link over `edge`, added to the cost only. */
export function penaltySec(edge: StepFreeFacts | null, profile: Profile): number {
  if (edge === null) return 0;
  switch (profile) {
    case 'shortest':
      return 0;
    case 'step_free':
      return isStepFreeUnknown(edge) ? UNKNOWN_STEP_FREE_PENALTY_SEC : 0;
    case 'fewest_steps':
      return edge.highway === 'steps' ? FEWEST_STEPS_STAIRS_PENALTY_SEC : 0;
  }
}
