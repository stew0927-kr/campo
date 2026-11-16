// Synthetic campuses and GPS traces for the map matching tests. Coordinates are written in metres east / north of a
// fixed origin and turned into lng / lat; traces use a seeded PRNG so every run sees the same noise.
import { createFrame, toLngLat, toX, toY, type LocalFrame } from '../../src/matching/geo.ts';
import type { MatchNetwork } from '../../src/matching/network.ts';
import type { SensorFix } from '../../src/matching/types.ts';
import type { LoadedCampus, Position } from '../../src/types.ts';

export type XY = [number, number];

export const ORIGIN: Position = [127.0453, 37.5572];
export const FRAME: LocalFrame = createFrame(ORIGIN[0], ORIGIN[1]);
const SOURCE = 'estimate';

export const lngLat = ([x, y]: XY): Position => toLngLat(FRAME, x, y);

export interface NodeDef {
  id: string;
  at: XY;
  type?: string;
  building?: string | null;
  level?: number | null;
}
export interface EdgeDef {
  id: string;
  from: string;
  to: string;
  highway?: string;
  edgeType?: string;
  conveying?: string;
}
export interface BuildingDef {
  id: string;
  /** Outline corners (closed automatically). */
  ring: XY[];
  levels: number[];
  ground: number[];
}

export function makeCampus(nodes: NodeDef[], edges: EdgeDef[], buildings: BuildingDef[] = []): LoadedCampus {
  const at = new Map(nodes.map((n) => [n.id, n.at]));
  const features: LoadedCampus['features'] = [];
  for (const b of buildings) {
    const ring = [...b.ring, b.ring[0]!].map(lngLat);
    features.push({
      file: 'matching.geojson',
      feature: {
        type: 'Feature', id: b.id, geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { kind: 'building', name: b.id, code: b.id, levels: b.levels, ground_levels: b.ground, source: SOURCE, rev: 1 },
      },
    } as unknown as LoadedCampus['features'][number]);
  }
  for (const n of nodes) {
    features.push({
      file: 'matching.geojson',
      feature: {
        type: 'Feature', id: n.id, geometry: { type: 'Point', coordinates: lngLat(n.at) },
        properties: { kind: 'node', node_type: n.type ?? 'outdoor', building_id: n.building ?? null, level: n.level ?? null, source: SOURCE, rev: 1 },
      },
    } as unknown as LoadedCampus['features'][number]);
  }
  for (const e of edges) {
    const props: Record<string, unknown> = {
      kind: 'edge', highway: e.highway ?? 'footway', edge_type: e.edgeType ?? 'outdoor', from: e.from, to: e.to,
      bidirectional: true, step_free: true, source: SOURCE, rev: 1,
    };
    if (e.conveying !== undefined) props['conveying'] = e.conveying;
    features.push({
      file: 'matching.geojson',
      feature: { type: 'Feature', id: e.id, geometry: { type: 'LineString', coordinates: [lngLat(at.get(e.from)!), lngLat(at.get(e.to)!)] }, properties: props },
    } as unknown as LoadedCampus['features'][number]);
  }
  return { meta: undefined, features, fileErrors: [] };
}

/** nx × ny outdoor grid with `spacing` metres between nodes; node ids g_<i>_<j>, edges h_<i>_<j> (east) and v_<i>_<j> (north). */
export function gridCampus(nx: number, ny: number, spacing: number): LoadedCampus {
  const nodes: NodeDef[] = [];
  const edges: EdgeDef[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      nodes.push({ id: `g_${i}_${j}`, at: [i * spacing, j * spacing] });
      if (i + 1 < nx) edges.push({ id: `h_${i}_${j}`, from: `g_${i}_${j}`, to: `g_${i + 1}_${j}` });
      if (j + 1 < ny) edges.push({ id: `v_${i}_${j}`, from: `g_${i}_${j}`, to: `g_${i}_${j + 1}` });
    }
  }
  return makeCampus(nodes, edges);
}

/** Deterministic PRNG (mulberry32) with a Gaussian helper. */
export function rng(seed: number): { uniform: () => number; gauss: () => number } {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(uniform(), 1e-12);
    const v = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { uniform, gauss };
}

export interface TruthPoint {
  tMs: number;
  x: number;
  y: number;
  /** Course of the walk, degrees from north. */
  headingDeg: number;
  speedMps: number;
}

/** Positions every dtMs along a polyline at a constant speed (first point at startMs, last at or before the end). */
export function walk(points: XY[], speedMps: number, startMs = 0, dtMs = 1000): TruthPoint[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  const total = cum[cum.length - 1]!;
  const step = (speedMps * dtMs) / 1000;
  const out: TruthPoint[] = [];
  let seg = 0;
  for (let k = 0; k * step <= total + 1e-9; k++) {
    const d = k * step;
    while (seg < points.length - 2 && cum[seg + 1]! < d) seg++;
    const a = points[seg]!;
    const b = points[seg + 1]!;
    const len = cum[seg + 1]! - cum[seg]!;
    const s = len > 0 ? (d - cum[seg]!) / len : 0;
    const headingDeg = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
    out.push({ tMs: startMs + k * dtMs, x: a[0] + s * (b[0] - a[0]), y: a[1] + s * (b[1] - a[1]), headingDeg, speedMps });
  }
  return out;
}

/** Standing still at `at` for `count` fixes. */
export function stand(at: XY, count: number, startMs: number, dtMs = 1000): TruthPoint[] {
  return Array.from({ length: count }, (_, k) => ({ tMs: startMs + k * dtMs, x: at[0], y: at[1], headingDeg: 0, speedMps: 0 }));
}

export interface NoiseOptions {
  /** Position noise per axis, m. */
  sigmaM: number;
  /** Reported accuracy, m. */
  accuracyM: number;
  /** Include speed and course (with a little noise). Default true. */
  withCourse?: boolean;
}

/** Noisy fixes of a truth trace. */
export function fixesOf(truth: TruthPoint[], seed: number, o: NoiseOptions): SensorFix[] {
  const r = rng(seed);
  return truth.map((p) => {
    const [lng, lat] = toLngLat(FRAME, p.x + r.gauss() * o.sigmaM, p.y + r.gauss() * o.sigmaM);
    const fix: SensorFix = { tMs: p.tMs, lat, lng, accuracyM: o.accuracyM };
    if (o.withCourse !== false) {
      fix.speedMps = Math.max(0, p.speedMps + r.gauss() * 0.1);
      fix.headingDeg = (p.headingDeg + r.gauss() * 8 + 360) % 360;
    }
    return fix;
  });
}

/** Local metres of a fix in the network's frame. */
export function netXY(net: MatchNetwork, lng: number, lat: number): XY {
  return [toX(net.frame, lng), toY(net.frame, lat)];
}

/** A truth point (test frame) in the network's frame. */
export function truthInNet(net: MatchNetwork, p: { x: number; y: number }): XY {
  const [lng, lat] = toLngLat(FRAME, p.x, p.y);
  return netXY(net, lng, lat);
}

/** Distance from a network-frame point to the polyline of edge `edgeId`, m. */
export function distToEdge(net: MatchNetwork, edgeId: string, x: number, y: number): number {
  const e = net.edgeIndex.get(edgeId);
  if (e === undefined) return Infinity;
  let best = Infinity;
  for (let i = net.vStart[e]!; i < net.vStart[e + 1]! - 1; i++) {
    const ax = net.vX[i]!;
    const ay = net.vY[i]!;
    const vx = net.vX[i + 1]! - ax;
    const vy = net.vY[i + 1]! - ay;
    const l2 = vx * vx + vy * vy;
    const s = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + s * vx - x, ay + s * vy - y));
  }
  return best;
}

/** Distance from (x, y) to a polyline of points, m. */
export function polylineDist(points: XY[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i]!;
    const [bx, by] = points[i + 1]!;
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    const s = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + s * vx - x, ay + s * vy - y));
  }
  return best;
}
