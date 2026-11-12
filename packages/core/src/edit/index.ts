// Edit engine (SPEC-v0.2 §4). Every data change in the editor, the macros and the changeset CLI goes through these actions.
export {
  COLLECTIONS,
  allIds,
  buildingById,
  codeOf,
  edgeCoords,
  edgesAt,
  emptyState,
  findFeature,
  idTaken,
  isScopeBound,
  sameScope,
  scopeOf,
  scopeOfNode,
  type Collection,
  type EditBuilding,
  type EditEdge,
  type EditNode,
  type EditRoom,
  type EditState,
  type Scope,
} from './state.ts';
export * from './action.ts';
export * from './ids.ts';
export * from './tolerances.ts';
export * from './geo.ts';
export * from './invariants.ts';
export * from './history.ts';
export * from './convert.ts';
export * from './serialize.ts';
export { scopeProblem, type NewProps } from './actions/common.ts';
export { addNode, type NewNode } from './actions/addNode.ts';
export { addEdge, type NewEdge } from './actions/addEdge.ts';
export { deleteNodes, healPlan, type DeleteNodesOptions, type HealPlan } from './actions/deleteNodes.ts';
export { deleteEdges, DISPOSABLE_NODE_TYPES } from './actions/deleteEdges.ts';
export { deleteBuilding, previewDeleteBuilding, type DeleteBuildingPreview } from './actions/deleteBuilding.ts';
export { moveNode, movedTogether } from './actions/moveNode.ts';
export { mergeNodes, mergeSurvivor, IMPORTANT_NODE_TYPES } from './actions/mergeNodes.ts';
export { splitEdgeAt, splitPlan, type SplitOptions, type SplitPlan } from './actions/splitEdgeAt.ts';
export { setProps, LOCKED_PROPS, type PropsPatch } from './actions/setProps.ts';
export { addRoom, type NewRoom } from './actions/addRoom.ts';
export { deleteRooms, doorsOfRoom } from './actions/deleteRooms.ts';
export * from './macros/index.ts';
