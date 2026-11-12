// Every distance tolerance of the edit engine lives in this one file (SPEC-v0.2 §4, §6).
// All Turf calls that use these pass { units: 'meters' }: Turf's default unit is kilometres.
import { ENDPOINT_TOLERANCE_M } from '../validate.ts';

/** A split lands on an existing vertex within this distance, and is refused this close to either end (SPEC-v0.2 4.1). */
export const SNAP_VERTEX_M = 1.0;

/** Stops of one elevator_id count as "the same coordinate" within this distance (I5). Same value as validate's E9 check. */
export const ELEVATOR_STOP_M = ENDPOINT_TOLERANCE_M;

/** attachDoor looks for a corridor this far from the door at most (SPEC-v0.2 6.1, default maxDist). */
export const ATTACH_MAX_DIST_M = 8;

/** placeRoomDoors puts a door this far inside the room from the side that faces the corridor (SPEC-v0.2 6.3). */
export const DOOR_INSET_M = 0.3;

/** placeRoomDoors puts the two doors at these fractions of the side; roomStrip uses the same spacing inside a room. */
export const DOOR_SIDE_FRACTIONS: readonly [number, number] = [0.2, 0.8];
