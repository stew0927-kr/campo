import { enablePatches } from 'immer';

// Immer patches (used by the edit engine and changesets) must be enabled once at startup.
enablePatches();

export * from './types.ts';
export { CAMPUS_META_FILE, CALIBRATION_FILE, OBSERVATIONS_DIR, OVERRIDES_FILE, isCampusFile, parseCampus } from './load.ts';
export { formatFeatureCollection, formatMeta } from './format.ts';
export { migrateCampusFiles, type MigrateProblem, type MigrateResult, type MigrateSummary } from './migrate.ts';
export { ENDPOINT_TOLERANCE_M, isClassroomDoor, isValidFeature, mapLimitsProblem, validateCampus } from './validate.ts';
export * from './costs.ts';
export * from './calibration/index.ts';
export {
  buildGraph,
  carId,
  predictedTimeSec,
  straight,
  type AlightLinkData,
  type BoardLinkData,
  type BuildGraphOptions,
  type CampusGraph,
  type GraphLinkData,
  type GraphNodeData,
  type HopLinkData,
  type SinkLinkData,
  type WalkLinkData,
} from './graph.ts';
export {
  findNearest,
  findRoute,
  type NearestResult,
  type NearestRoute,
  type NoRoute,
  type NodePredicate,
  type Route,
  type RouteFallback,
  type RouteResult,
  type UncertainSegment,
} from './route.ts';
export type { RouteStep, RouteStepKind } from './route-text.ts';
export * from './edit/index.ts';
export * from './changeset/index.ts';
export * from './reports/index.ts';
export { describeSchemaErrors, type SchemaCheck } from './json-schema.ts';
