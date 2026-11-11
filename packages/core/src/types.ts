// TypeScript mirror of data/schema/campo.schema.json (docs/SPEC.md §4).
// If you change one, change the other, SPEC §4, the fixtures and the tests in the same PR.

/** [longitude, latitude] in EPSG:4326. */
export type Position = [number, number];

/** Building-internal floor number. 1F = 1, B1 = -1, never 0. */
export type Level = number;

export type Source = string;

/** The data format this code reads. campus.json carries it as schema_version; npm run migrate upgrades older data. */
export const SCHEMA_VERSION = '0.2';

export interface CampusMeta {
  id: string;
  schema_version: typeof SCHEMA_VERSION;
  name: string;
  center: Position;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
}

interface CommonProperties {
  source: Source;
  needs_check?: boolean;
  /** Revision counter, +1 on every change. Starts at 1 (SPEC-v0.2 §2.5). */
  rev: number;
}

export interface BuildingProperties extends CommonProperties {
  kind: 'building';
  name: string;
  code: string;
  levels: Level[];
  ground_levels: Level[];
  /** A footbridge registered as a one-level building (SPEC-v0.2 §2.6). */
  building_type?: 'bridge';
  ext?: {
    moct_bldg_id?: string;
    floor_height_m?: number;
  };
}

export const NODE_TYPES = [
  'outdoor',
  'entrance',
  'door',
  'corridor',
  'elevator_stop',
  'stair_landing',
  'poi',
  'restroom',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface NodeProperties extends CommonProperties {
  kind: 'node';
  node_type: NodeType;
  /** null for outdoor points */
  building_id: string | null;
  /** null for outdoor points */
  level: Level | null;
  name?: string;
  ref?: string;
  space_name?: string;
  /** Every stop of one elevator carries the same id, e.g. "A_elevA" (SPEC-v0.2 §2.2). */
  elevator_id?: string;
  /** Classroom number on a door (SPEC-v0.2 §2.4). */
  room_ref?: string;
  door_role?: DoorRole;
  /** restroom only (SPEC-v0.2 §2.3). */
  restroom_gender?: RestroomGender;
  wheelchair?: Wheelchair;
  changing_table?: boolean | null;
}

export const DOOR_ROLES = ['front', 'back', 'other'] as const;
export type DoorRole = (typeof DOOR_ROLES)[number];
export const RESTROOM_GENDERS = ['male', 'female', 'unisex', 'family'] as const;
export type RestroomGender = (typeof RESTROOM_GENDERS)[number];
export const WHEELCHAIR_VALUES = ['yes', 'limited', 'no', 'unknown'] as const;
export type Wheelchair = (typeof WHEELCHAIR_VALUES)[number];

export const HIGHWAYS = ['footway', 'steps', 'corridor', 'elevator', 'ramp'] as const;
export type Highway = (typeof HIGHWAYS)[number];

export const CONVEYING_VALUES = ['forward', 'backward', 'reversible'] as const;
export type Conveying = (typeof CONVEYING_VALUES)[number];

export const EDGE_TYPES =['outdoor', 'portal', 'indoor', 'bridge'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export interface EdgeProperties extends CommonProperties {
  kind: 'edge';
  highway: Highway;
  edge_type?: EdgeType;
  from: string;
  to: string;
  bidirectional: boolean;
  /** true: checked on site, no steps. false: steps or a sill. null: not known (SPEC-v0.2 §2.1). */
  step_free: boolean | null;
  level_from?: Level;
  level_to?: Level;
  step_count?: number;
  /** steps edges only: direction of travel from → to (SPEC-v0.2 §2.6). */
  incline?: 'up' | 'down';
  /** Indoor steps without step_count: seconds to climb the flight, 0 to 30. Missing means the default (SPEC-v0.2 3.1). */
  flight_sec?: number;
  /** Moving belt (escalator on highway=steps, moving walkway on footway / corridor). Direction relative to from → to (SPEC-v0.2 2.7). */
  conveying?: Conveying;
  covered?: boolean;
  hours?: string;
  building_from?: string;
  building_to?: string;
}

export interface BuildingFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Polygon'; coordinates: Position[][] };
  properties: BuildingProperties;
}

export interface NodeFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: Position };
  properties: NodeProperties;
}

export interface EdgeFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'LineString'; coordinates: Position[] };
  properties: EdgeProperties;
}

/** A classroom outline. Optional input for the door macros (SPEC-v0.2 §2.4). */
export interface RoomProperties extends CommonProperties {
  kind: 'room';
  building_id: string;
  level: Level;
  name?: string;
  room_ref?: string;
}

export interface RoomFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Polygon'; coordinates: Position[][] };
  properties: RoomProperties;
}

export type CampoFeature = BuildingFeature | NodeFeature | EdgeFeature | RoomFeature;

export interface CampoFeatureCollection {
  type: 'FeatureCollection';
  features: CampoFeature[];
}

// ---- Loading ----

/** A feature as read from disk, before validation. */
export interface LoadedFeature {
  /** Path relative to the campus folder, with forward slashes. */
  file: string;
  /** Unvalidated. Use validateCampus() / isValidFeature() before trusting its shape. */
  feature: unknown;
}

export interface LoadedFile {
  /** Path relative to the campus folder, with forward slashes. */
  path: string;
  /** File contents as text. */
  text: string;
}

/** A whole campus folder merged into one list of features. */
export interface LoadedCampus {
  /** Contents of campus.json, unvalidated. undefined when the file is missing. */
  meta: unknown;
  features: LoadedFeature[];
  /** Contents of overrides.json, unvalidated. undefined when the file is missing (SPEC-v0.2 §2.5). */
  overrides?: unknown;
  /** Lines of observations/*.jsonl, unvalidated, in file then line order (SPEC-v0.2 3.9). */
  observations?: LoadedObservation[];
  /** Contents of calibration.json, unvalidated. undefined when the file is missing. */
  calibration?: unknown;
  /** Files that could not be parsed as JSON or are not FeatureCollections. */
  fileErrors: { file: string; message: string }[];
}

export interface LoadedObservation {
  /** Path relative to the campus folder. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Unvalidated. */
  record: unknown;
}

// ---- Measured time calibration (SPEC-v0.2 3.9) ----

/** One line of observations/*.jsonl. No user, device or position fields on purpose. */
export interface Observation {
  /** "edge:<edge id>" or "elevator:<elevator_id>". */
  target: string;
  duration_sec: number;
  /** Edge targets: travelled as drawn (default) or against it. */
  direction?: 'forward' | 'backward';
  source: 'field' | 'app';
  /** ISO 8601 date-time with a time zone. */
  measured_at: string;
  note?: string;
}

export interface CalibrationEntry {
  prior_sec: number;
  median_sec: number;
  n: number;
  estimate_sec: number;
  /** yyyy-mm-dd */
  updated_at: string;
}

/** calibration.json: key is "edge:<id>", "edge:<id>#backward" or "elevator:<elevator_id>". */
export type Calibration = Record<string, CalibrationEntry>;

// ---- Validation ----

export const ERROR_CODES = {
  schema: 'schema',
  duplicateId: 'duplicate-id',
  danglingRef: 'dangling-ref',
  endpointMismatch: 'endpoint-mismatch',
  levelNotInBuilding: 'level-not-in-building',
  verticalLevelMismatch: 'vertical-level-mismatch',
  groundLevelWithoutEntrance: 'ground-level-without-entrance',
  entranceWithoutPortal: 'entrance-without-portal',
  /** E9 (I4): a flat edge joins two different scopes (outdoor, or building + level). */
  flatEdgeCrossesScope: 'flat-edge-crosses-scope',
  /** E9 (I5): stops of one elevator_id are not at the same coordinate. */
  elevatorStopsApart: 'elevator-stops-apart',
  /** E10 */
  restroomNotConnected: 'restroom-not-connected',
  /** E11 */
  elevatorIdMissing: 'elevator-id-missing',
  /** E11 */
  elevatorGroupSplit: 'elevator-group-split',
  /** E12 */
  escalatorNotStepFree: 'escalator-not-step-free',
} as const;

export const WARNING_CODES = {
  isolatedNode: 'isolated-node',
  disconnectedComponent: 'disconnected-component',
  needsCheck: 'needs-check',
  noStepFreeRoute: 'no-step-free-route',
  /** W5 */
  doorNotOnCorridor: 'door-not-on-corridor',
  /** W6 */
  duplicateFrontDoor: 'duplicate-front-door',
  /** W7 */
  expiredOverride: 'expired-override',
  /** W8 */
  elevatorDeadEnd: 'elevator-dead-end',
  /** W9 */
  elevatorSingleLevel: 'elevator-single-level',
  /** W10 */
  bridgeSameBuilding: 'bridge-same-building',
  /** W12 */
  escalatorSameScope: 'escalator-same-scope',
  /** W13 */
  observationUnknownTarget: 'observation-unknown-target',
  /** W14 */
  danglingOverride: 'dangling-override',
} as const;

// ---- Overrides (SPEC-v0.2 §2.5) ----

/** A temporary state (broken elevator, blocked door) kept out of the map data. */
export interface Override {
  feature_id: string;
  /** What is wrong, e.g. "out_of_service". Free text until the report kinds are fixed (task 8). */
  status: string;
  /** Expiry, ISO 8601 date-time. */
  until: string;
  report_id: string;
}

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];

export interface ValidationIssue<C extends string = ErrorCode | WarningCode> {
  /** Path relative to the campus folder. */
  file: string;
  /** null when the problem is with the file itself. */
  featureId: string | null;
  code: C;
  /** Korean, polite form (shown in the editor's 검사 tab). */
  message: string;
}

export interface ValidationResult {
  errors: ValidationIssue<ErrorCode>[];
  warnings: ValidationIssue<WarningCode>[];
}
