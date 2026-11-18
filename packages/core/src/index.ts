import { enablePatches } from 'immer';

// Immer patches (used by the edit engine and changesets) must be enabled once at startup.
enablePatches();

export * from './types.ts';
export * from './access.ts';
export { findNearestRestroom, isRestroomFor, isWheelchairRestroom } from './restroom.ts';
export {
  endAtPoint,
  findNearestRestroomFrom,
  findRouteBetween,
  findRouteThrough,
  snapToRoutes,
  type PlazaLeg,
  type PointRoute,
  type PointRouteResult,
  type RouteEnd,
  type RouteSnap,
} from './routing/fromPoint.ts';
export {
  PLAZA_CONTACT_MERGE_M,
  PLAZA_NODE_TOL_M,
  plazaAt,
  plazaContacts,
  linkedPlazas,
  plazaDistance,
  plazaGeodesics,
  plazaTransferLinks,
  type PlazaContact,
  type PlazaGeodesic,
  type PlazaPoint,
} from './routing/plaza.ts';
export { CAMPUS_META_FILE, CALIBRATION_FILE, OBSERVATIONS_DIR, OVERRIDES_FILE, isCampusFile, parseCampus } from './load.ts';
export { formatFeatureCollection, formatMeta } from './format.ts';
export { migrateCampusFiles, type MigrateProblem, type MigrateResult, type MigrateSummary } from './migrate.ts';
export { ENDPOINT_TOLERANCE_M, isClassroomDoor, isValidFeature, mapLimitsProblem, validateCampus } from './validate.ts';
export * from './costs.ts';
export * from './edgeWidth.ts';
export * from './pictograms.ts';
export * from './outline.ts';
export * from './buildingStack.ts';
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
  type PartialWalk,
  type PlazaCrossing,
  type PlazaLinkData,
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
  type SlopeSegment,
  type UncertainSegment,
} from './route.ts';
export type { RouteStep, RouteStepKind } from './route-text.ts';
export {
  LOOKAHEAD_M,
  MIN_SEGMENT_M,
  bearingAlong,
  computeStepBearings,
  initialBearingDeg,
  signedDiffDeg,
  type FloorChangeKind,
  type LngLat,
  type StepBearing,
} from './route/bearing.ts';
export { STEEP_NOTE } from './route-text.ts';
export * from './edit/index.ts';
export {
  PLAZA_EPS_M,
  PLAZA_MAX_POSITIONS,
  PLAZA_LINK_TOL_M,
  PLAZA_MIN_GAP_M,
  classifyPlazaRing,
  closeRingPositions,
  framePlaza,
  localFrame,
  locateInPlaza,
  locateXY,
  normalizePlazaRings,
  plazaAreaM2,
  plazaPerimeterM,
  plazaHoleProblem,
  plazaProblem,
  plazaRingProblem,
  plazaClusters,
  plazaRegionsOverlap,
  plazaTouchesNetwork,
  plazasLinked,
  nearestOnPlazaBoundary,
  pointInRingXY,
  ringAreaXY,
  segmentInPlazaDomain,
  segmentIntersections,
  signedAreaM2,
  type FramedPlaza,
  type LocalFrame as PlazaLocalFrame,
  type PlazaBoundaryHit,
  type PlazaDraw,
  type PlazaHit,
  type XY,
} from './plaza/geometry.ts';
export * from './plaza/merge.ts';
export { PLAZA_JOIN_TOL_M, plazaJoins, type JoinEdge, type JoinNode } from './plaza/joins.ts';
export * from './changeset/index.ts';
export * from './reports/index.ts';
export * from './survey/index.ts';
export * from './matching/index.ts';
export { describeSchemaErrors, type SchemaCheck } from './json-schema.ts';
