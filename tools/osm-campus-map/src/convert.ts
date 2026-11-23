// OSM (Overpass JSON) -> campus sketch GeoJSON. Pure functions, no I/O.
import type {
  Bbox,
  LonLat,
  OsmTags,
  OverpassElement,
  OverpassGeomPoint,
  OverpassJson,
  OverpassNode,
  SketchCollection,
  SketchFeature,
  SketchKind,
} from './types.ts';

export const METERS_PER_LEVEL = 3;
/** Used when a building has neither `height` nor a usable `building:levels`. */
export const DEFAULT_BUILDING_HEIGHT_M = 6;
export const MAX_BUILDING_HEIGHT_M = 300;
/** 6 decimals is about 0.11 m, which is plenty for a sketch map. */
export const COORD_DECIMALS = 6;

const ROAD_HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'service', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link',
  'tertiary_link', 'road',
]);
const FOOT_HIGHWAYS = new Set(['footway', 'pedestrian', 'path', 'track', 'cycleway', 'bridleway']);
const GREEN_LEISURE = new Set(['park', 'garden']);
const GREEN_LANDUSE = new Set(['grass', 'forest']);
const GREEN_NATURAL = new Set(['wood']);

/** Highway tag -> sketch kind. Anything else (corridor, bus_stop, platform, ...) is dropped. */
export function classifyHighway(tags: OsmTags): 'road' | 'footway' | 'steps' | undefined {
  const h = tags['highway'];
  if (h === undefined) return undefined;
  if (h === 'steps') return 'steps';
  if (FOOT_HIGHWAYS.has(h)) return 'footway';
  if (ROAD_HIGHWAYS.has(h)) return 'road';
  return undefined;
}

export function classifyArea(tags: OsmTags): 'green' | 'water' | undefined {
  if (tags['natural'] === 'water') return 'water';
  if (GREEN_LANDUSE.has(tags['landuse'] ?? '')) return 'green';
  if (GREEN_LEISURE.has(tags['leisure'] ?? '')) return 'green';
  if (GREEN_NATURAL.has(tags['natural'] ?? '')) return 'green';
  return undefined;
}

export function isBuilding(tags: OsmTags): boolean {
  const b = tags['building'];
  return b !== undefined && b !== 'no';
}

function parseNumber(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m)?\s*$/.exec(v.replace(',', '.'));
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

/** `building:levels` -> number of levels (positive integers only; "3;4" or "many" are ignored). */
export function parseLevels(tags: OsmTags): number | undefined {
  const n = parseNumber(tags['building:levels']);
  return n !== undefined && n > 0 ? n : undefined;
}

/** Extrusion height: explicit `height` first, else levels x 3 m (+ roof levels), else default. */
export function buildingHeightM(tags: OsmTags): number {
  const explicit = parseNumber(tags['height']);
  let h: number;
  if (explicit !== undefined && explicit > 0) {
    h = explicit;
  } else {
    const levels = parseLevels(tags);
    if (levels !== undefined) {
      const roof = parseNumber(tags['roof:levels']) ?? 0;
      h = (levels + roof) * METERS_PER_LEVEL;
    } else {
      h = DEFAULT_BUILDING_HEIGHT_M;
    }
  }
  return Math.round(Math.min(h, MAX_BUILDING_HEIGHT_M) * 10) / 10;
}

export function nameOf(tags: OsmTags): string | undefined {
  const n = tags['name:ko'] ?? tags['name'];
  return n !== undefined && n.trim() !== '' ? n.trim() : undefined;
}

const round = (n: number): number => Number(n.toFixed(COORD_DECIMALS));

/** Rounds coordinates and drops consecutive duplicates. */
export function cleanLine(points: readonly LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p: LonLat = [round(lon), round(lat)];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

function signedArea(ring: readonly LonLat[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p = ring[i]!;
    const q = ring[i + 1]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Closed, de-duplicated ring (>= 4 positions, non-zero area) wound as RFC 7946 asks, or undefined. */
export function cleanRing(points: readonly LonLat[], outer: boolean): LonLat[] | undefined {
  const ring = cleanLine(points);
  if (ring.length < 3) return undefined;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  if (ring.length < 4) return undefined;
  const area = signedArea(ring);
  if (Math.abs(area) < 1e-14) return undefined;
  const ccw = area > 0;
  return ccw === outer ? ring : ring.reverse();
}

type Geom = readonly (OverpassGeomPoint | null)[];

function toLonLat(g: Geom): LonLat[] {
  const out: LonLat[] = [];
  for (const p of g) if (p) out.push([p.lon, p.lat]);
  return out;
}

/** Joins member ways end-to-end into closed rings (multipolygon outer/inner assembly). */
export function stitchRings(parts: readonly LonLat[][]): LonLat[][] {
  const pool = parts.filter((p) => p.length >= 2).map((p) => p.slice());
  const rings: LonLat[][] = [];
  const same = (a: LonLat, b: LonLat): boolean => a[0] === b[0] && a[1] === b[1];
  while (pool.length > 0) {
    let cur = pool.pop()!;
    let progressed = true;
    while (progressed && !same(cur[0]!, cur[cur.length - 1]!)) {
      progressed = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i]!;
        const end = cur[cur.length - 1]!;
        if (same(end, w[0]!)) cur = cur.concat(w.slice(1));
        else if (same(end, w[w.length - 1]!)) cur = cur.concat(w.slice().reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        progressed = true;
        break;
      }
    }
    if (same(cur[0]!, cur[cur.length - 1]!)) rings.push(cur);
  }
  return rings;
}

function intersects(coords: readonly LonLat[], bbox: Bbox): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX >= bbox[0] && minX <= bbox[2] && maxY >= bbox[1] && minY <= bbox[3];
}

export interface ConvertOptions {
  /** Features entirely outside this box are dropped. */
  bbox?: Bbox;
}

export interface ConvertStats {
  kept: Record<SketchKind, number>;
  dropped: number;
}

export interface ConvertResult {
  collection: SketchCollection;
  stats: ConvertStats;
}

function emptyKept(): Record<SketchKind, number> {
  return { building: 0, road: 0, footway: 0, steps: 0, green: 0, water: 0 };
}

export function convertOverpass(json: OverpassJson, opts: ConvertOptions = {}): ConvertResult {
  const nodes = new Map<number, OverpassNode>();
  for (const el of json.elements) if (el.type === 'node') nodes.set(el.id, el);

  const wayLonLat = (el: { geometry?: Geom; nodes?: number[] }): LonLat[] => {
    if (el.geometry) return toLonLat(el.geometry);
    const out: LonLat[] = [];
    for (const id of el.nodes ?? []) {
      const n = nodes.get(id);
      if (n) out.push([n.lon, n.lat]);
    }
    return out;
  };

  const features: SketchFeature[] = [];
  const stats: ConvertStats = { kept: emptyKept(), dropped: 0 };

  const push = (f: SketchFeature | undefined, coords: readonly LonLat[]): void => {
    if (!f || (opts.bbox && !intersects(coords, opts.bbox))) {
      stats.dropped++;
      return;
    }
    stats.kept[f.properties.kind]++;
    features.push(f);
  };

  const areaKind = (tags: OsmTags): SketchKind | undefined =>
    isBuilding(tags) ? 'building' : classifyArea(tags);

  const polygonFeature = (
    kind: SketchKind,
    tags: OsmTags,
    osmId: string,
    rings: LonLat[][],
  ): SketchFeature | undefined => {
    const outers = rings.map((r, i) => cleanRing(r, i === 0));
    const clean = outers.filter((r): r is LonLat[] => r !== undefined);
    if (clean.length === 0 || outers[0] === undefined) return undefined;
    const props: SketchFeature['properties'] = { kind, osm_id: osmId };
    const name = nameOf(tags);
    if (name !== undefined) props.name = name;
    if (kind === 'building') {
      props.height_m = buildingHeightM(tags);
      const levels = parseLevels(tags);
      if (levels !== undefined) props.levels = levels;
    }
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: clean } };
  };

  const handle = (el: Exclude<OverpassElement, OverpassNode>): void => {
    const tags = el.tags ?? {};
    const osmId = `${el.type}/${el.id}`;

    if (el.type === 'way') {
      const raw = wayLonLat(el);
      const aKind = areaKind(tags);
      const hKind = classifyHighway(tags);
      if (aKind !== undefined) {
        const f = polygonFeature(aKind, tags, osmId, [raw]);
        push(f, f ? f.geometry.coordinates.flat() as LonLat[] : []);
        return;
      }
      if (hKind !== undefined) {
        const line = cleanLine(raw);
        if (line.length < 2) return push(undefined, []);
        const props: SketchFeature['properties'] = { kind: hKind, osm_id: osmId };
        const name = nameOf(tags);
        if (name !== undefined) props.name = name;
        push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: line } }, line);
        return;
      }
      stats.dropped++;
      return;
    }

    // relation: only multipolygons that are buildings / green / water
    const aKind = areaKind(tags);
    if (aKind === undefined || tags['type'] !== 'multipolygon') {
      stats.dropped++;
      return;
    }
    const members = el.members ?? [];
    const outer = stitchRings(
      members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => toLonLat(m.geometry!)),
    );
    const inner = stitchRings(
      members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => toLonLat(m.geometry!)),
    );
    if (outer.length === 0) return push(undefined, []);
    // One Feature per outer ring; holes are attached to the first outer ring (campus-scale simplification).
    outer.forEach((o, i) => {
      const f = polygonFeature(aKind, tags, osmId, i === 0 ? [o, ...inner] : [o]);
      push(f, o);
    });
  };

  for (const el of json.elements) if (el.type !== 'node') handle(el);

  // Deterministic order: areas first (so lines draw on top by default), then by kind and OSM id.
  const order: Record<SketchKind, number> = { water: 0, green: 1, building: 2, road: 3, footway: 4, steps: 5 };
  features.sort(
    (a, b) =>
      order[a.properties.kind] - order[b.properties.kind] ||
      a.properties.osm_id.localeCompare(b.properties.osm_id, 'en', { numeric: true }),
  );

  return { collection: { type: 'FeatureCollection', features }, stats };
}
