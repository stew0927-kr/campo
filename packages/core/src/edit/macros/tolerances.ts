// Distances and ratios of the door / corridor macros (SPEC-v0.2 §6).
// These belong in edit/tolerances.ts next to SNAP_VERTEX_M; that file was outside this change, so they live here
// until the lead moves them. Every Turf call that uses them passes { units: 'meters' } (Turf's default is kilometres).
export { SNAP_VERTEX_M } from '../tolerances.ts';

/** attachDoor looks for a corridor this far from the door at most (SPEC-v0.2 6.1, default maxDist). */
export const ATTACH_MAX_DIST_M = 8;

/** placeRoomDoors puts a door this far inside the room from the side that faces the corridor (SPEC-v0.2 6.3). */
export const DOOR_INSET_M = 0.3;

/** placeRoomDoors puts the two doors at these fractions of the side; roomStrip uses the same spacing inside a room. */
export const DOOR_SIDE_FRACTIONS: readonly [number, number] = [0.2, 0.8];
