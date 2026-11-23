// Photo coordinates (0..1000, origin top left, y down) → longitude / latitude (EPSG:4326).
//  1. Turn the point clockwise by rotationDeg about the frame centre (500, 500): the photo as it stands upright.
//  2. Put the building ring in a local metre frame (equirectangular around the ring's centre) and take its bbox.
//  3. Fit the upright plan into that bbox without stretching it, centred. Down on the plan is south.
//  4. Back to degrees, 7 decimals.
import type { RotationDeg } from './types.ts';

export const NORM = 1000;
/** Metres per degree of latitude (and of longitude at the equator). */
export const M_PER_DEG = 111320;

export type XY = [number, number];
export type LonLat = [number, number];

/**
 * `(x, y)` of the photo turned clockwise by `deg` in image coordinates (y down):
 * 0 → (x, y), 90 → (1000 − y, x), 180 → (1000 − x, 1000 − y), 270 → (y, 1000 − x).
 */
export function rotateNormalized(x: number, y: number, deg: RotationDeg): XY {
  switch (deg) {
    case 90: return [NORM - y, x];
    case 180: return [NORM - x, NORM - y];
    case 270: return [y, NORM - x];
    default: return [x, y];
  }
}

/** The building in a local metre frame: its centre in degrees and its bbox in metres around that centre. */
export interface MetreFrame {
  lon0: number;
  lat0: number;
  west: number;
  east: number;
  south: number;
  north: number;
}

const isLonLat = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
  && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Whether `ring` is an outer ring of at least 4 [lng, lat] points that spans some area. */
export function isRing(ring: unknown): ring is number[][] {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isLonLat)) return false;
  const lons = ring.map((p) => p[0]!);
  const lats = ring.map((p) => p[1]!);
  return Math.max(...lons) > Math.min(...lons) && Math.max(...lats) > Math.min(...lats);
}

export function metreFrame(ring: readonly (readonly number[])[]): MetreFrame {
  const lons = ring.map((p) => p[0]!);
  const lats = ring.map((p) => p[1]!);
  const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const mx = lons.map((lon) => (lon - lon0) * k);
  const my = lats.map((lat) => (lat - lat0) * M_PER_DEG);
  return { lon0, lat0, west: Math.min(...mx), east: Math.max(...mx), south: Math.min(...my), north: Math.max(...my) };
}

export const round7 = (v: number): number => Math.round(v * 1e7) / 1e7;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface FitOptions {
  rotationDeg: RotationDeg;
  /** Width over height of the photo as sent. Default 1 (the 0..1000 frame is taken as square). */
  aspect?: number;
}

/** A function that places a photo point (0..1000) in the building. */
export function placer(ring: readonly (readonly number[])[], opts: FitOptions): (x: number, y: number) => LonLat {
  const f = metreFrame(ring);
  const w = f.east - f.west;
  const h = f.north - f.south;
  const photoAspect = opts.aspect !== undefined && Number.isFinite(opts.aspect) && opts.aspect > 0 ? opts.aspect : 1;
  // Turned a quarter, the photo's width becomes the plan's height.
  const a = opts.rotationDeg === 90 || opts.rotationDeg === 270 ? 1 / photoAspect : photoAspect;
  // The plan is a × 1 (width × height); scale it to fit the bbox, then centre it.
  const s = Math.min(w / a, h);
  const cw = a * s;
  const ch = s;
  const left = f.west + (w - cw) / 2;
  const top = f.north - (h - ch) / 2;
  const kLon = M_PER_DEG * Math.cos((f.lat0 * Math.PI) / 180);
  return (x, y) => {
    const [u, v] = rotateNormalized(x, y, opts.rotationDeg);
    const mx = left + (u / NORM) * cw;
    const my = top - (v / NORM) * ch;
    const lon = clamp(round7(f.lon0 + mx / kLon), -180, 180);
    const lat = clamp(round7(f.lat0 + my / M_PER_DEG), -90, 90);
    return [lon, lat];
  };
}
