// Overpass JSON (out:json, `out geom`) and sketch GeoJSON shapes used by this tool.

export type Bbox = readonly [west: number, south: number, east: number, north: number];

export type OsmTags = Record<string, string>;
export type LonLat = [lon: number, lat: number];

export interface OverpassGeomPoint {
  lat: number;
  lon: number;
}

export interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: OsmTags;
}

export interface OverpassWay {
  type: 'way';
  id: number;
  nodes?: number[];
  /** Present with `out geom`; null entries can appear when a node is outside the query area. */
  geometry?: (OverpassGeomPoint | null)[];
  tags?: OsmTags;
}

export interface OverpassMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: (OverpassGeomPoint | null)[];
}

export interface OverpassRelation {
  type: 'relation';
  id: number;
  members?: OverpassMember[];
  tags?: OsmTags;
}

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export interface OverpassJson {
  elements: OverpassElement[];
}

export type SketchKind = 'building' | 'road' | 'footway' | 'steps' | 'green' | 'water';

export interface SketchProperties {
  kind: SketchKind;
  /** OSM id such as `way/123`, kept only for tracing a feature back to OSM. */
  osm_id: string;
  name?: string;
  /** Buildings only: extrusion height in metres. */
  height_m?: number;
  /** Buildings only: `building:levels` when the tag is a usable number. */
  levels?: number;
}

export type SketchGeometry =
  | { type: 'LineString'; coordinates: LonLat[] }
  | { type: 'Polygon'; coordinates: LonLat[][] };

export interface SketchFeature {
  type: 'Feature';
  properties: SketchProperties;
  geometry: SketchGeometry;
}

export interface SketchCollection {
  type: 'FeatureCollection';
  features: SketchFeature[];
}
