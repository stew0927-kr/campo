import { enablePatches } from 'immer';

// Immer patches (used by the edit engine and changesets) must be enabled once at startup.
enablePatches();

export * from './types.ts';
export { CAMPUS_META_FILE, isCampusFile, parseCampus } from './load.ts';
export { ENDPOINT_TOLERANCE_M, isClassroomDoor, isValidFeature, validateCampus } from './validate.ts';
export * from './costs.ts';
export { buildGraph, carId, type CampusGraph, type GraphLinkData, type GraphNodeData } from './graph.ts';
export { findRoute, type NoRoute, type Route, type RouteResult } from './route.ts';
