// TypeScript mirror of data/schema/campo.schema.json (docs/SPEC.md §4).
// If you change one, change the other, SPEC §4, the fixtures and the tests in the same PR.

/** [longitude, latitude] in EPSG:4326. */
export type Position = [number, number];

/** Building-internal floor number. 1F = 1, B1 = -1, never 0. */
export type Level = number;

export type Source = string;

export interface CampusMeta {
  id: string;
  name: string;
  center: Position;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
}

interface CommonProperties {
  source: Source;
  needs_check?: boolean;
}

export interface BuildingProperties extends CommonProperties {
  kind: 'building';
  name: string;
  code: string;
  levels: Level[];
  ground_levels: Level[];
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
  shaft_id?: string;
  space_name?: string;
}

export const HIGHWAYS = ['footway', 'steps', 'corridor', 'elevator', 'ramp'] as const;
export type Highway = (typeof HIGHWAYS)[number];

export const EDGE_TYPES = ['outdoor', 'portal', 'indoor', 'bridge'] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export interface EdgeProperties extends CommonProperties {
  kind: 'edge';
  highway: Highway;
  edge_type?: EdgeType;
  from: string;
  to: string;
  bidirectional: boolean;
  step_free: boolean;
  level_from?: Level;
  level_to?: Level;
  step_count?: number;
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

export type CampoFeature = BuildingFeature | NodeFeature | EdgeFeature;

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
  /** Files that could not be parsed as JSON or are not FeatureCollections. */
  fileErrors: { file: string; message: string }[];
}

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
} as const;

export const WARNING_CODES = {
  isolatedNode: 'isolated-node',
  disconnectedComponent: 'disconnected-component',
  needsCheck: 'needs-check',
  noStepFreeRoute: 'no-step-free-route',
} as const;

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
