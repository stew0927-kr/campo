// 지형 3D's height grid for the editor (GET /api/elevation/:id/terrain): the solver's corrected_dem when there is one
// (paths, flat_exact, stairs, barometer Δh and break lines already folded in), else the plain DEM, else none.
// A campo-grid file is <name>.json (meta) + <name>.bin (row-major from the north, little-endian float32 or uint16).
// It is thinned to at most MAX_CELLS cells a side: the view needs the shape of the ground, not every metre. The drawn
// retaining walls (break lines with lowSide and dropM) go with it as 1 m sections read from the grid as it is (terrainWalls).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { toKorea2000 } from '../src/model/korea2000.ts';

export const MAX_CELLS = 160;

/** A grid file the view cannot draw (its CRS, a short .bin): the API answers 422 with this message, not 500. */
export class GridFormatError extends Error {}

interface GridMeta {
  crs?: string;
  origin_x: number;
  origin_y: number;
  res: number;
  width: number;
  height: number;
  dtype: 'float32' | 'uint16';
  nodata?: number;
  scale?: number;
  offset?: number;
  bin?: string;
}

/** The grid the editor draws (model/terrain3d.ts TerrainGrid). */
export interface TerrainGridJson {
  source: 'corrected' | 'dem';
  crs: 'EPSG:5186';
  originX: number;
  originY: number;
  res: number;
  width: number;
  height: number;
  z: (number | null)[];
}

/** A campo-grid at its own resolution: cell (row from the north, col) → height, null where it has no data. */
export interface GridValues {
  originX: number;
  originY: number;
  res: number;
  width: number;
  height: number;
  at(row: number, col: number): number | null;
}

/** Read a grid's cells where they are (uint16 with scale / offset / nodata, or float32), without copying them. */
export function gridValues(meta: GridMeta, bytes: Uint8Array): GridValues {
  // The view converts grid metres with the EPSG:5186 formulas of model/terrain3d.ts; dem_prep.py makes EPSG:5186 by default and
  // warns when --dst-crs is something else (the solver itself works in any projected CRS).
  if (meta.crs !== undefined && meta.crs !== 'EPSG:5186') {
    throw new GridFormatError(`고도 그리드 좌표계 ${meta.crs}는 지형 3D에서 읽지 못합니다(EPSG:5186만). `
      + 'dem_prep.py를 --dst-crs EPSG:5186(기본값)으로 다시 실행해 DEM을 만든 뒤 고도를 다시 계산해 주세요.');
  }
  const n = meta.width * meta.height;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = meta.dtype === 'uint16' ? 2 : 4;
  if (bytes.byteLength < n * size) throw new GridFormatError('고도 그리드 .bin 파일이 메타데이터보다 짧습니다.');
  const value = (i: number): number | null => {
    if (meta.dtype === 'uint16') {
      const raw = view.getUint16(i * 2, true);
      return raw === (meta.nodata ?? 65535) ? null : raw * (meta.scale ?? 1) + (meta.offset ?? 0);
    }
    const v = view.getFloat32(i * 4, true);
    return !Number.isFinite(v) || v === (meta.nodata ?? -9999) ? null : v;
  };
  return {
    originX: meta.origin_x, originY: meta.origin_y, res: meta.res, width: meta.width, height: meta.height,
    at: (r, c) => (r < 0 || c < 0 || r >= meta.height || c >= meta.width ? null : value(r * meta.width + c)),
  };
}

/** Decode and thin a grid (every `stride`-th cell each way, the cell centres kept where they are). */
export function decodeGrid(meta: GridMeta, bytes: Uint8Array, source: TerrainGridJson['source'], maxCells = MAX_CELLS): TerrainGridJson {
  const g = gridValues(meta, bytes);
  const stride = Math.max(1, Math.ceil(Math.max(meta.width, meta.height) / maxCells));
  const width = Math.ceil(meta.width / stride);
  const height = Math.ceil(meta.height / stride);
  const z: (number | null)[] = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) z.push(g.at(r * stride, c * stride));
  const shift = 0.5 * meta.res * (stride - 1);
  return { source, crs: 'EPSG:5186', originX: meta.origin_x - shift, originY: meta.origin_y + shift, res: meta.res * stride, width, height, z };
}

async function readGridBytes(jsonPath: string): Promise<{ meta: GridMeta; bytes: Uint8Array }> {
  const meta = JSON.parse(await readFile(jsonPath, 'utf8')) as GridMeta;
  const bin = join(dirname(jsonPath), meta.bin ?? jsonPath.replace(/^.*[\/]/, '').replace(/\.json$/, '.bin'));
  return { meta, bytes: new Uint8Array(await readFile(bin)) };
}

export async function readGridFile(jsonPath: string, source: TerrainGridJson['source'], maxCells = MAX_CELLS): Promise<TerrainGridJson> {
  const { meta, bytes } = await readGridBytes(jsonPath);
  return decodeGrid(meta, bytes, source, maxCells);
}

/** GET /terrain's answer: the thinned grid and the 1 m sections across the store's walls (none when the store is missing or broken). */
export async function readTerrain(
  jsonPath: string, source: TerrainGridJson['source'], storeText: string | null, maxCells = MAX_CELLS,
): Promise<{ grid: TerrainGridJson; walls: TerrainWallJson[] }> {
  const { meta, bytes } = await readGridBytes(jsonPath);
  const grid = decodeGrid(meta, bytes, source, maxCells);
  let walls: TerrainWallJson[] = [];
  try {
    walls = terrainWalls(gridValues(meta, bytes), wallsFromStore(storeText), grid.res);
  } catch {
    walls = []; // a wall that cannot be read never keeps the relief from being drawn
  }
  return { grid, walls };
}

// ---- 옹벽: sections across the drawn walls, read from the grid at its own resolution ----
//
// The thinned grid (one value every ~9 m) smears a 1 m wide step into a gentle slope. For every drawn break line with a
// low side and a drop (the lines the solver turns into a step, tools/elevation grid_grading.py DropWall) the full grid is
// read across the line every metre, each side from its own cells only, so the editor can draw the step as an upright face.

/** A wall's section (GET /terrain `walls`, model/terrain3d.ts TerrainWall). */
export interface TerrainWallJson {
  id: string;
  lowSide: 'left' | 'right';
  dropM: number;
  /** Rows across the line in metres: -W … -1, 0 (the low ground at the line), 0 (the high ground at the line), 1 … W. */
  offsets: number[];
  /** Columns: points on the line (EPSG:5186 m) about every metre, from W before its first point to W past its last. */
  x: number[];
  y: number[];
  /** The unit normal of each column toward the high side: row point = (x, y) + offset × (nx, ny). At a bend extra columns fan out. */
  nx: number[];
  ny: number[];
  /** The columns at the first and the last drawn point (the columns outside are the run-out past the ends). */
  drawn: [number, number];
  /** Heights (m) row by row (rows × cols), null off the grid or where it has no data. */
  z: (number | null)[];
}

/** A drawn line as the store keeps it (core ElevationStore BreakLine, read loosely). */
interface StoreLine {
  id: string;
  coordinates: { lat: number; lng: number }[];
  lowSide: 'left' | 'right';
  dropM: number;
}

const isWall = (b: unknown): b is StoreLine => {
  const v = b as Partial<StoreLine> | null;
  return typeof v === 'object' && v !== null && typeof v.id === 'string' && (v.lowSide === 'left' || v.lowSide === 'right')
    && typeof v.dropM === 'number' && v.dropM > 0 && Array.isArray(v.coordinates)
    && v.coordinates.every((c) => typeof c?.lat === 'number' && typeof c?.lng === 'number');
};

/** The walls (break lines with lowSide and dropM > 0) of a store text; none for no text or a text that cannot be read. */
export function wallsFromStore(text: string | null): StoreLine[] {
  if (text === null) return [];
  try {
    const v = JSON.parse(text) as { breaklines?: unknown };
    return Array.isArray(v?.breaklines) ? v.breaklines.filter(isWall) : [];
  } catch {
    return [];
  }
}

/**
 * Half the width of a section (m): more than a thinned cell's diagonal (√2 × cell), since terrainMesh leaves out every
 * cell a wall crosses and a crossed cell's far corner can be that far from the line; at least 7 m.
 */
export function wallHalfWidth(cellM: number): number {
  return Math.max(7, Math.ceil(Math.SQRT2 * cellM) + 1);
}

/** At a bend the normal turns in steps of at most this (rad), so the outer side of the section has no gap. */
const FAN_STEP = (10 * Math.PI) / 180;

type XY = [number, number];

/**
 * Height at (x, y) from the cells on one side of the line through `p` with high normal `h` only: bilinear over the cells
 * there, or, when none of the four nearest is on that side, the nearest of the 4 × 4 around by inverse distance.
 * A cell centre on the line belongs to the line's left (as in the solver). Null off the grid.
 */
function sampleSide(g: GridValues, x: number, y: number, p: XY, h: XY, high: boolean, highIsLeft: boolean): number | null {
  const fc = (x - g.originX) / g.res - 0.5;
  const fr = (g.originY - y) / g.res - 0.5;
  if (fc < -0.5 || fr < -0.5 || fc > g.width - 0.5 || fr > g.height - 0.5) return null;
  const c0 = Math.floor(fc);
  const r0 = Math.floor(fr);
  const onSide = (r: number, c: number): boolean => {
    const qx = g.originX + (c + 0.5) * g.res;
    const qy = g.originY - (r + 0.5) * g.res;
    const d = (qx - p[0]) * h[0] + (qy - p[1]) * h[1];
    const isHigh = d > 0 || (d === 0 && highIsLeft);
    return isHigh === high;
  };
  let sum = 0;
  let wsum = 0;
  for (let r = r0; r <= r0 + 1; r++) {
    for (let c = c0; c <= c0 + 1; c++) {
      const w = (1 - Math.abs(fc - c)) * (1 - Math.abs(fr - r));
      if (w <= 0) continue;
      const v = g.at(r, c);
      if (v === null || !onSide(r, c)) continue;
      sum += w * v;
      wsum += w;
    }
  }
  if (wsum > 1e-9) return sum / wsum;
  for (let r = r0 - 1; r <= r0 + 2; r++) {
    for (let c = c0 - 1; c <= c0 + 2; c++) {
      const v = g.at(r, c);
      if (v === null || !onSide(r, c)) continue;
      const w = 1 / ((fc - c) ** 2 + (fr - r) ** 2 + 1e-9);
      sum += w * v;
      wsum += w;
    }
  }
  return wsum > 0 ? sum / wsum : null;
}

const round = (v: number, k: number) => Math.round(v * k) / k;

/** The columns of a section: points about every metre on the line run out by `W` past both ends, each with its high normal. */
function sectionColumns(pts: XY[], highLeft: boolean, W: number): { p: XY[]; n: XY[]; drawn: [number, number] } {
  const seg = pts.slice(1).map((b, i) => {
    const a = pts[i]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t: XY = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const left: XY = [-t[1], t[0]];
    return { a, b, t, n: (highLeft ? left : [-left[0], -left[1]]) as XY };
  });
  const first = seg[0]!;
  const last = seg.at(-1)!;
  const runs = [
    { a: [first.a[0] - W * first.t[0], first.a[1] - W * first.t[1]] as XY, b: first.a, n: first.n },
    ...seg,
    { a: last.b, b: [last.b[0] + W * last.t[0], last.b[1] + W * last.t[1]] as XY, n: last.n },
  ];
  const p: XY[] = [];
  const n: XY[] = [];
  const push = (q: XY, m: XY) => {
    const k = p.length - 1;
    if (k >= 0 && Math.hypot(p[k]![0] - q[0], p[k]![1] - q[1]) < 1e-9 && Math.hypot(n[k]![0] - m[0], n[k]![1] - m[1]) < 1e-9) return;
    p.push(q);
    n.push(m);
  };
  let d0 = 0;
  let d1 = 0;
  runs.forEach((s, i) => {
    if (i > 0) {
      // Fan the normal round the bend.
      const prev = n.at(-1)!;
      const turn = Math.atan2(prev[0] * s.n[1] - prev[1] * s.n[0], prev[0] * s.n[0] + prev[1] * s.n[1]);
      const steps = Math.ceil(Math.abs(turn) / FAN_STEP);
      const a0 = Math.atan2(prev[1], prev[0]);
      for (let j = 1; j < steps; j++) {
        const a = a0 + (turn * j) / steps;
        push(s.a, [Math.cos(a), Math.sin(a)]);
      }
    }
    const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    const m = Math.max(1, Math.ceil(len - 1e-9));
    for (let j = 0; j <= m; j++) push([s.a[0] + ((s.b[0] - s.a[0]) * j) / m, s.a[1] + ((s.b[1] - s.a[1]) * j) / m], s.n);
    if (i === 0) d0 = p.length - 1;
    if (i === runs.length - 2) d1 = p.length - 1;
  });
  return { p, n, drawn: [d0, d1] };
}

/**
 * The section across every wall among `lines` (lowSide and dropM > 0; others are left out), read from `g` at its own
 * resolution. `cellM`: the cell of the thinned grid the editor draws (the section reaches past its cells, wallHalfWidth).
 * The high side is the drawn lowSide's other side; where the ground at the line plainly says the opposite (the median
 * step under −max(0.1, dropM / 4)), the measured sides are used.
 */
export function terrainWalls(g: GridValues, lines: readonly unknown[], cellM: number): TerrainWallJson[] {
  const W = wallHalfWidth(cellM);
  const offsets = [...Array.from({ length: W }, (_, i) => i - W), 0, 0, ...Array.from({ length: W }, (_, i) => i + 1)];
  const out: TerrainWallJson[] = [];
  for (const line of lines) {
    if (!isWall(line)) continue;
    const pts: XY[] = [];
    for (const c of line.coordinates) {
      const q = toKorea2000([c.lng, c.lat]);
      const prev = pts.at(-1);
      if (!prev || Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 1e-6) pts.push(q);
    }
    if (pts.length < 2) continue;
    const section = (highLeft: boolean) => {
      const cols = sectionColumns(pts, highLeft, W);
      const z: (number | null)[] = [];
      offsets.forEach((o, row) => {
        const high = row > W;
        cols.p.forEach((p, c) => {
          const h = cols.n[c]!;
          z.push(sampleSide(g, p[0] + o * h[0], p[1] + o * h[1], p, h, high, highLeft));
        });
      });
      return { ...cols, z };
    };
    const highLeft = line.lowSide === 'right';
    let s = section(highLeft);
    const n = s.p.length;
    const steps: number[] = [];
    for (let c = s.drawn[0]; c <= s.drawn[1]; c++) {
      const [lo, hi] = [s.z[W * n + c], s.z[(W + 1) * n + c]];
      if (lo != null && hi != null) steps.push(hi - lo);
    }
    steps.sort((a, b) => a - b);
    const median = steps.length ? steps[Math.floor(steps.length / 2)]! : 0;
    if (median < -Math.max(0.1, line.dropM / 4)) s = section(!highLeft);
    out.push({
      id: line.id, lowSide: line.lowSide, dropM: line.dropM, offsets,
      x: s.p.map((p) => round(p[0], 1000)), y: s.p.map((p) => round(p[1], 1000)),
      nx: s.n.map((h) => round(h[0], 1e6)), ny: s.n.map((h) => round(h[1], 1e6)),
      drawn: s.drawn, z: s.z.map((v) => (v === null ? null : round(v, 1000))),
    });
  }
  return out;
}
