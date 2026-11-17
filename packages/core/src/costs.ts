// Routing costs (SPEC-v0.2 3.1, 3.4). Every tunable number lives in this file.
// One unit: seconds. Link time is the expected travel time; profile penalties
// are added to the search cost only, never to the time.
//
// Decisions here use an edge's own properties (highway, edge_type, step_free,
// conveying, …) and its end node types, nothing else: no floor numbers
// (AGENTS.md; a test checks this file).
import { CONVEYING_VALUES, type Conveying, type EdgeProperties, type NodeType } from './types.ts';

export const PROFILES = ['shortest', 'step_free', 'fewest_steps', 'elevator_first', 'wheelchair'] as const;
/**
 * shortest: stairs allowed, plain travel time.
 * step_free: no steps, nothing marked step_free: false; unknown (null) costs a penalty.
 * fewest_steps: the step_free fallback, stairs allowed but each flight costs a big penalty.
 * elevator_first: nothing closed, but stairs and escalators cost as much as in fewest_steps and each ramp costs
 *   RAMP_PENALTY_SEC, so the lift is taken wherever there is one.
 * wheelchair: closed like step_free (no fallback to stairs), unknown step_free and ramps cost a penalty.
 */
export type Profile = (typeof PROFILES)[number];

export function isProfile(value: unknown): value is Profile {
  return (PROFILES as readonly unknown[]).includes(value);
}

/** One value per profile. Written out so that adding a profile is a type error here. */
export function perProfile<T>(f: (profile: Profile) => T): Record<Profile, T> {
  return { shortest: f('shortest'), step_free: f('step_free'), fewest_steps: f('fewest_steps'), elevator_first: f('elevator_first'), wheelchair: f('wheelchair') };
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
/** Escalator belt speed along its slope, m/s (standing, not walking up). Only a first guess: see calibration. */
export const ESCALATOR_SPEED_MPS = 0.5;
/** Getting on and off an escalator. */
export const ESCALATOR_BOARD_SEC = 3;
/** Lower bound for an escalator edge drawn too short. */
export const ESCALATOR_MIN_SEC = 8;
/** Slope of most escalators; slope length = plan length / cos(this). */
export const ESCALATOR_SLOPE_DEG = 30;
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

/** fewest_steps: an escalator (highway=steps + conveying) costs a tenth of a flight of stairs. */
export const FEWEST_STEPS_ESCALATOR_PENALTY_SEC = FEWEST_STEPS_STAIRS_PENALTY_SEC / 10;

/**
 * elevator_first and wheelchair: each ramp edge whose grade is not known, so a level way round or a lift is taken
 * when it is not much longer. A ramp with a known grade pays the grade penalty below instead.
 */
export const RAMP_PENALTY_SEC = 30;

// ---- Grade (elevation integration, docs/ELEVATION_INTEGRATION.md) ----
//
// The grade of an edge comes from its own properties only: flat_exact, elev_diff_m (+ elev_sigma_m) or grade_pct,
// written by the elevation recompute (packages/core/src/elevation). An edge without them is timed and priced exactly as
// before. Steps and elevator edges never use a grade (stairsTimeSec and the elevator links have their own rules).

/** |grade| up to this many percent is gentle: no grade penalty for anyone. */
export const GRADE_GENTLE_MAX_PCT = 5;
/** Up to this is "caution" (8 % is just under the usual 1:12 ramp limit); above it is steep. */
export const GRADE_CAUTION_MAX_PCT = 8;
/** A grade whose standard deviation (elev_sigma_m / plan length) is above this many points is not trusted: no grade. */
export const GRADE_MAX_SIGMA_PCT = 3;
/**
 * Tobler's hiking function, speed ∝ exp(−K·|S + OFFSET|) with S = rise / run, normalised to flat ground:
 * time factor = exp(K·(|S + OFFSET| − OFFSET)). 1 on the flat, about 1.19 at +5 %, 1.32 at +8 %, 0.84 at −5 %.
 */
export const TOBLER_K = 3.5;
export const TOBLER_OFFSET = 0.05;
/**
 * Grade penalty in seconds per metre of plan length, going up. Per metre so that splitting an edge does not change
 * the total. Steep slopes are priced, never closed: the grade is an estimate with an error.
 */
export const GRADE_PENALTY_SEC_PER_M: Readonly<Record<Profile, Readonly<Record<'caution' | 'steep', number>>>> = {
  shortest: { caution: 0, steep: 0 },
  step_free: { caution: 0, steep: 2 },
  fewest_steps: { caution: 0, steep: 2 },
  elevator_first: { caution: 1, steep: 4 },
  wheelchair: { caution: 3, steep: 15 },
};
/** Going down a slope costs this share of the uphill grade penalty (braking a wheelchair is easier than pushing it). */
export const DOWNHILL_GRADE_PENALTY_FACTOR = 0.5;

// ---- Calibration (SPEC-v0.2 3.9) ----

/** Blend weight of the prior: estimate = (K × prior + n × median) / (K + n). */
export const CALIBRATION_K = 3;
/** A measurement under prior / this or over prior × this is thrown away. */
export const OUTLIER_RATIO = 3;

type StepFreeFacts = Pick<EdgeProperties, 'highway' | 'step_free'>;
type PenaltyFacts = Pick<EdgeProperties, 'highway' | 'step_free' | 'conveying'>;
type GradeFacts = Pick<EdgeProperties, 'highway' | 'flat_exact' | 'grade_pct' | 'elev_diff_m' | 'elev_sigma_m'>;

/** A walk link's grade for penaltySec: signed percent in the direction of travel, and the plan length it applies to. */
export interface LinkGrade {
  gradePct: number;
  lengthM: number;
}

export type GradeClass = 'gentle' | 'caution' | 'steep';

/** gentle (|g| ≤ GRADE_GENTLE_MAX_PCT), caution (≤ GRADE_CAUTION_MAX_PCT) or steep, by the size of the grade. */
export function gradeClass(gradePct: number): GradeClass {
  const g = Math.abs(gradePct);
  if (g <= GRADE_GENTLE_MAX_PCT) return 'gentle';
  return g <= GRADE_CAUTION_MAX_PCT ? 'caution' : 'steep';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The edge's grade in percent in the direction of travel (positive = uphill), or null when it has none.
 * - steps and elevator edges: null (they are timed by their own rules).
 * - flat_exact: true → 0.
 * - elev_diff_m (height of `to` minus `from`) over the plan length, when the plan length is positive;
 *   null when elev_sigma_m makes the grade's σ larger than GRADE_MAX_SIGMA_PCT.
 * - else grade_pct (same σ check when elev_sigma_m is there).
 * Against the drawn direction the sign flips.
 */
export function edgeGradePct(edge: GradeFacts, planLengthM: number, traversal: 'along' | 'against'): number | null {
  if (edge.highway === 'steps' || edge.highway === 'elevator') return null;
  if (edge.flat_exact === true) return 0;
  const length = planLengthM > 0 ? planLengthM : 0;
  if (length > 0 && finite(edge.elev_sigma_m) && (edge.elev_sigma_m / length) * 100 > GRADE_MAX_SIGMA_PCT) return null;
  let grade: number | null = null;
  if (length > 0 && finite(edge.elev_diff_m)) grade = (edge.elev_diff_m / length) * 100;
  else if (finite(edge.grade_pct)) grade = edge.grade_pct;
  if (grade === null || grade === 0) return grade;
  return traversal === 'along' ? grade : -grade;
}

/** Tobler time factor for a grade in percent (1 on the flat). */
export function slopeTimeFactor(gradePct: number): number {
  const s = gradePct / 100;
  return Math.exp(TOBLER_K * (Math.abs(s + TOBLER_OFFSET) - TOBLER_OFFSET));
}

/** Grade penalty in seconds for `profile` on a walk link (0 on gentle slopes and for shortest). */
export function gradePenaltySec(grade: LinkGrade, profile: Profile): number {
  const cls = gradeClass(grade.gradePct);
  if (cls === 'gentle') return 0;
  const perM = GRADE_PENALTY_SEC_PER_M[profile][cls];
  return perM * grade.lengthM * (grade.gradePct < 0 ? DOWNHILL_GRADE_PENALTY_FACTOR : 1);
}

/**
 * The edge's moving-belt direction (SPEC-v0.2 2.7), or null when it has none.
 * A value that is not one of CONVEYING_VALUES (unvalidated data) counts as none,
 * so the graph links and the time rule always agree on what is a belt.
 */
export function conveyingOf(edge: Pick<EdgeProperties, 'conveying'>): Conveying | null {
  const c = edge.conveying;
  return (CONVEYING_VALUES as readonly unknown[]).includes(c) ? (c as Conveying) : null;
}

/** An escalator: a steps edge with conveying (SPEC-v0.2 2.7). A moving walkway is not one. */
export function isEscalator(edge: Pick<EdgeProperties, 'highway' | 'conveying'>): boolean {
  return edge.highway === 'steps' && conveyingOf(edge) !== null;
}

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
 * (plus PORTAL_SEC on a portal). With a grade (edgeGradePct, direction of travel)
 * the walking time is scaled by slopeTimeFactor; without one a ramp takes
 * RAMP_FACTOR. Steps edges use stairsTimeSec, elevators the ELEVATOR_* constants.
 */
export function walkTimeSec(edge: Pick<EdgeProperties, 'highway' | 'edge_type'>, lengthM: number, gradePct: number | null = null): number {
  if (edge.highway === 'steps') throw new Error('steps edges are timed by stairsTimeSec');
  let t = lengthM / WALK_SPEED_MPS;
  if (gradePct !== null) t *= slopeTimeFactor(gradePct);
  else if (edge.highway === 'ramp') t *= RAMP_FACTOR;
  return t + portalSec(edge);
}

export interface StairsTimeInput {
  edge: Pick<EdgeProperties, 'edge_type' | 'step_count' | 'flight_sec' | 'incline' | 'conveying'>;
  /** node_type of the edge's from and to nodes (undefined when unknown). */
  endNodeTypes: readonly [NodeType | undefined, NodeType | undefined];
  /** Geodesic distance between the from / to node positions. */
  planLengthM: number;
  /** 'along': travelled from → to as drawn; 'against': to → from. */
  traversal: 'along' | 'against';
}

/**
 * Expected time on a highway=steps edge, in seconds (user decision, 2026-11-11).
 * An escalator (conveying, SPEC-v0.2 3.8) comes before every stairs rule:
 *   max(plan length / cos(ESCALATOR_SLOPE_DEG) / ESCALATOR_SPEED_MPS + ESCALATOR_BOARD_SEC,
 *   ESCALATOR_MIN_SEC), the same both ways it runs (no downhill factor; step_count,
 *   flight_sec, incline and edge_type are not read). Which ways it runs is the graph's job.
 * Otherwise the time going up:
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
  if (conveyingOf(edge) !== null) {
    const slopeM = planLengthM / Math.cos((ESCALATOR_SLOPE_DEG * Math.PI) / 180);
    return Math.max(slopeM / ESCALATOR_SPEED_MPS + ESCALATOR_BOARD_SEC, ESCALATOR_MIN_SEC);
  }
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
  return (profile === 'step_free' || profile === 'wheelchair') && !isStepFreePassable(edge);
}

/**
 * Preference penalty in seconds for a link over `edge`, added to the cost only.
 * fewest_steps: FEWEST_STEPS_ESCALATOR_PENALTY_SEC on an escalator,
 * FEWEST_STEPS_STAIRS_PENALTY_SEC on any other steps edge.
 * `grade` (a walk link with a known grade) adds gradePenaltySec, and a ramp with a
 * known grade no longer pays the flat RAMP_PENALTY_SEC.
 */
export function penaltySec(edge: PenaltyFacts | null, profile: Profile, grade: LinkGrade | null = null): number {
  if (edge === null) return 0;
  const ramp = edge.highway === 'ramp' && grade === null ? RAMP_PENALTY_SEC : 0;
  const slope = grade === null ? 0 : gradePenaltySec(grade, profile);
  switch (profile) {
    case 'shortest':
      return 0;
    case 'step_free':
      return (isStepFreeUnknown(edge) ? UNKNOWN_STEP_FREE_PENALTY_SEC : 0) + slope;
    case 'fewest_steps':
      if (edge.highway !== 'steps') return slope;
      return isEscalator(edge) ? FEWEST_STEPS_ESCALATOR_PENALTY_SEC : FEWEST_STEPS_STAIRS_PENALTY_SEC;
    case 'elevator_first':
      if (edge.highway === 'steps') return FEWEST_STEPS_STAIRS_PENALTY_SEC;
      return ramp + slope;
    case 'wheelchair':
      return (isStepFreeUnknown(edge) ? UNKNOWN_STEP_FREE_PENALTY_SEC : 0) + ramp + slope;
  }
}
