// Every distance tolerance of the edit engine lives in this one file (SPEC-v0.2 §4, §6).
// All Turf calls that use these pass { units: 'meters' }: Turf's default unit is kilometres.
import { ENDPOINT_TOLERANCE_M } from '../validate.ts';

/** A split lands on an existing vertex within this distance, and is refused this close to either end (SPEC-v0.2 4.1). */
export const SNAP_VERTEX_M = 1.0;

/** Stops of one elevator_id count as "the same coordinate" within this distance (I5). Same value as validate's E9 check. */
export const ELEVATOR_STOP_M = ENDPOINT_TOLERANCE_M;
