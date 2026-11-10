// Routing costs (docs/SPEC.md §6). Every tunable number lives in this file.
// Costs are "metre-equivalent" units; tune them by walking the campus.
import type { EdgeProperties } from './types.ts';

export const PROFILES = ['shortest', 'step_free'] as const;
/** shortest: stairs allowed. step_free: no stairs, no steps or sills. */
export type Profile = (typeof PROFILES)[number];

// ---- Cost (metre-equivalent) ----

/** steps: length × this … */
export const STEPS_LENGTH_FACTOR = 1.5;
/** … plus this per steps edge. Each steps edge is one floor indoors or one flight outdoors (SPEC §3). */
export const STEPS_FLIGHT_COST = 15;
/** ramp: length × this, in both profiles. */
export const RAMP_LENGTH_FACTOR = 1.2;
/** portal (entrance ↔ outside): length + this. */
export const PORTAL_EXTRA_COST = 2;
/** elevator: this once per ride (waiting for the car) … */
export const ELEVATOR_BOARDING_COST = 30;
/** … plus this per floor travelled. */
export const ELEVATOR_FLOOR_COST = 5;

// ---- Time ----

export const WALKING_SPEED_M_PER_S = 1.2;
/** Expected wait for the elevator car, once per ride. */
export const ELEVATOR_WAIT_S = 30;
/** Car travel time per floor. */
export const ELEVATOR_FLOOR_S = 4;

/**
 * Can a step-free traveller use this edge? (§6 step_free column)
 * Decided only by the edge's own highway and step_free — never by floor numbers.
 */
export function isStepFreePassable(edge: Pick<EdgeProperties, 'highway' | 'step_free'>): boolean {
  switch (edge.highway) {
    case 'steps':
      return false;
    case 'elevator':
    case 'ramp':
      return true;
    case 'footway':
    case 'corridor':
      return edge.step_free;
  }
}

/**
 * Cost of walking an edge of `lengthM` metres. Infinity means impassable for the profile.
 * Elevators are not walked: see ELEVATOR_BOARDING_COST and elevatorRideCost().
 */
export function walkCost(
  edge: Pick<EdgeProperties, 'highway' | 'edge_type' | 'step_free'>,
  lengthM: number,
  profile: Profile,
): number {
  if (profile === 'step_free' && !isStepFreePassable(edge)) return Infinity;
  switch (edge.highway) {
    case 'steps':
      return lengthM * STEPS_LENGTH_FACTOR + STEPS_FLIGHT_COST;
    case 'ramp':
      return lengthM * RAMP_LENGTH_FACTOR;
    case 'elevator':
      throw new Error('elevator edges are ridden, not walked');
    case 'footway':
    case 'corridor':
      return edge.edge_type === 'portal' ? lengthM + PORTAL_EXTRA_COST : lengthM;
  }
}

export function elevatorRideCost(floors: number): number {
  return floors * ELEVATOR_FLOOR_COST;
}

/**
 * Floors travelled along one elevator edge, for its cost only (it never decides
 * whether the edge can be used). Elevator edges normally join neighbouring stops,
 * so 1 when level_from/level_to are absent. There is no floor 0: B1 → 1F is one floor.
 */
export function elevatorFloors(edge: Pick<EdgeProperties, 'level_from' | 'level_to'>): number {
  const { level_from: a, level_to: b } = edge;
  if (a === undefined || b === undefined) return 1;
  const diff = Math.abs(b - a);
  return Math.max(1, a * b < 0 ? diff - 1 : diff);
}
