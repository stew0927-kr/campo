// Shapes of the floorplan-to-geojson function: the request, the draft the vision model returns, the response.
// Plain TypeScript with no Deno or Node globals, so the app's Node tests can import it as it is.

export type RotationDeg = 0 | 90 | 180 | 270;
export const ROTATIONS: readonly RotationDeg[] = [0, 90, 180, 270];

export interface FloorplanRequest {
  /** The photo of the floor guide, as it was taken (the server does not turn the pixels). */
  imageBase64: string;
  mimeType: string;
  /** Building id, e.g. "bldg_eng1". */
  buildingId: string;
  /** 1F = 1, B1 = -1. 0 is not a floor. */
  level: number;
  /** Outer ring of the building (or of the floor), [lng, lat], 4 points or more. */
  buildingPolygon: number[][];
  /** How far the photo must turn clockwise for the plan to stand upright. Default 0. */
  rotationDeg: RotationDeg;
  /** Pixel size of the photo as sent (optional): keeps the plan's aspect ratio when it is fitted into the building. */
  imageWidth?: number;
  imageHeight?: number;
}

/** Point kinds the model may return. */
export const DRAFT_KINDS = ['corridor', 'door', 'stair_landing', 'elevator_stop', 'restroom'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DOOR_ROLES = ['front', 'back', 'other'] as const;
export type DoorRole = (typeof DOOR_ROLES)[number];
export const RESTROOM_GENDERS = ['male', 'female', 'unisex', 'family'] as const;
export type RestroomGender = (typeof RESTROOM_GENDERS)[number];

/** One point read from the photo. x, y: 0 to 1000 of the photo, origin top left, x right, y down. */
export interface DraftNode {
  kind: DraftKind;
  x: number;
  y: number;
  room_ref?: string;
  space_name?: string;
  door_role?: DoorRole;
  elevator_id?: string;
  restroom_gender?: RestroomGender;
}

export interface DraftCorridor {
  /** Indexes into DraftMap.nodes. */
  from: number;
  to: number;
}

/** What the model read, checked and cleaned (parse.ts). */
export interface DraftMap {
  nodes: DraftNode[];
  corridors: DraftCorridor[];
  warnings: string[];
}

export interface FloorplanSummary {
  nodeCount: number;
  edgeCount: number;
  doors: number;
  restrooms: number;
  stairs: number;
  elevators: number;
  /** Edges left out: to the point itself, the same pair twice, or a point too far from any corridor. */
  skippedEdges: number;
  warnings: string[];
}

export type Provider = 'gemini' | 'anthropic';

export type ErrorCode = 'no_api_key' | 'bad_request' | 'extract_failed' | 'provider_error';

export interface FloorplanOk {
  ok: true;
  geojson: { type: 'FeatureCollection'; features: unknown[] };
  summary: FloorplanSummary;
  buildingId: string;
  level: number;
  rotationDeg: RotationDeg;
  provider: Provider;
}

export interface FloorplanFail {
  ok: false;
  code: ErrorCode;
  /** A sentence in Korean for the person holding the phone. */
  error: string;
}

/** Reads one environment variable (Deno.env.get on the server, a record in tests). */
export type EnvGet = (name: string) => string | undefined;

/** What a provider module gets. It returns the model's text only; parse.ts reads it. */
export interface ProviderInput {
  imageBase64: string;
  mimeType: string;
  prompt: string;
}
export type ProviderCall = (input: ProviderInput, env: EnvGet, fetchImpl?: typeof fetch) => Promise<string>;

/** A provider answered with an error, or not at all. */
export class ProviderError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}
