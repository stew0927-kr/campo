// Door and corridor macros (SPEC-v0.2 §6). Each macro is one Action (one history entry) built from the engine's actions.
export {
  MacroStop,
  addedKeys,
  defineMacro,
  type MacroAction,
  type MacroFailure,
  type MacroPlan,
  type MacroResult,
  type MacroRun,
  type MacroSuccess,
  type Runner,
} from './compose.ts';
export { chainOf, corridorCandidates, findFoot, type Chain, type FootPlan } from './corridor.ts';
export {
  attachDoor,
  attachDoorAction,
  attachDoorSteps,
  previewAttachDoor,
  type AttachDoorOptions,
  type AttachDoorResult,
  type AttachPreview,
  type DoorTarget,
  type PreviewOptions,
} from './attachDoor.ts';
export { densifyCorridor, densifyCorridorAction, densifyTargets, type DensifyOptions, type DensifyResult } from './densifyCorridor.ts';
export {
  placeRoomDoors,
  placeRoomDoorsAction,
  roomDoorSpots,
  type DoorSpot,
  type PlaceRoomDoorsOptions,
  type PlaceRoomDoorsResult,
  type RoomDoors,
} from './placeRoomDoors.ts';
export {
  refAfter,
  roomStrip,
  roomStripAction,
  stripDoors,
  type RoomStripOptions,
  type RoomStripResult,
  type StripDoor,
  type StripRoom,
} from './roomStrip.ts';
