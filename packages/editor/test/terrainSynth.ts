// The synthetic relief shared by terrain-tiles.test.ts and terrain-footprint.test.ts: a 1 m campo-grid of 600 × 600 cells
// (z = 50 + 0.25·x + 0.1·y + a seeded noise of ± 0.4 m, + an optional cone around the plaza), thinned to the 10 m grid
// the view draws (60 × 60), and an L-shaped plaza with one hole.
import { decodeGrid, gridValues, type GridValues, type TerrainGridJson } from '../server/terrain.ts';
import { fromKorea2000 } from '../src/model/korea2000.ts';
import type { Position } from '@campo/core';

export const OX = 203_900;
export const OY = 551_000;
export const RAW_N = 600;

export const META = { crs: 'EPSG:5186', origin_x: OX, origin_y: OY, res: 1, width: RAW_N, height: RAW_N, dtype: 'float32' as const, nodata: -9999 };

/** mulberry32: a small seeded generator, so the noise is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Grid metres (x east, y south of the top-left corner) → EPSG:5186. */
export const xy = (x: number, y: number): [number, number] => [OX + x, OY - y];
export const pos = (x: number, y: number): Position => fromKorea2000(OX + x, OY - y);

/** The L-shaped plaza (grid metres) and its hole: off the lattice on purpose. */
export const L_OUTER: [number, number][] = [[200.3, 200.7], [260.2, 200.7], [260.2, 230.4], [230.6, 230.4], [230.6, 260.1], [200.3, 260.1]];
export const L_HOLE: [number, number][] = [[208.3, 208.2], [219.7, 208.2], [219.7, 219.6], [208.3, 219.6]];
export const L_CENTRE: [number, number] = [225, 225];

/** A ring of grid metres as plaza positions (closed, as the editor keeps them). */
export const ringPos = (ring: readonly [number, number][]): Position[] => [...ring, ring[0]!].map(([x, y]) => pos(x, y));

/**
 * The raw 1 m grid. `cone`: metres per metre added with the distance from `centre` (+0.5: the ground rises away from the
 * plaza, so it sits in a cut; −0.5: it falls away, a fill; 0: the plain slope).
 */
export function rawGrid(cone = 0, centre: [number, number] = L_CENTRE, seed = 7): { bytes: Uint8Array; g: GridValues } {
  const f = new Float32Array(RAW_N * RAW_N);
  const rand = rng(seed);
  for (let r = 0; r < RAW_N; r++) {
    for (let c = 0; c < RAW_N; c++) {
      const [x, y] = [c + 0.5, r + 0.5];
      const d = Math.hypot(x - centre[0], y - centre[1]);
      f[r * RAW_N + c] = 50 + 0.25 * x + 0.1 * y + (rand() * 2 - 1) * 0.4 + cone * d;
    }
  }
  const bytes = new Uint8Array(f.buffer);
  return { bytes, g: gridValues(META, bytes) };
}

/** The 10 m grid the view draws (decodeGrid with 60 cells a side: stride 10). */
export function coarseOf(bytes: Uint8Array): TerrainGridJson {
  return decodeGrid(META, bytes, 'corrected', 60);
}

/** [xmin, ymin, xmax, ymax] (EPSG:5186) of a ring of grid metres, as solve_report plazas[].bbox_xy. */
export function bboxXY(ring: readonly [number, number][]): [number, number, number, number] {
  const pts = ring.map(([x, y]) => xy(x, y));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}
