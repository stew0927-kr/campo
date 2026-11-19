// 지형 3D's height grid for the editor (GET /api/elevation/:id/terrain): the solver's corrected_dem when there is one
// (paths, flat_exact, stairs, barometer Δh and break lines already folded in), else the plain DEM, else none.
// A campo-grid file is <name>.json (meta) + <name>.bin (row-major from the north, little-endian float32 or uint16).
// It is thinned to at most MAX_CELLS cells a side: the view needs the shape of the ground, not every metre. The drawn
// retaining walls (break lines with lowSide and dropM) go with it as 1 m sections read from the grid as it is (terrainWalls),
// and round every 평지 the thinned cells are sent again at 1 m (terrainTiles), so the view can press the relief under the
// plaza's plane exactly where its edge is (model/terrainFootprint.ts).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { coarseVertexXY } from '../src/model/gridXY.ts';
import { toKorea2000 } from '../src/model/korea2000.ts';

export { coarseVertexXY } from '../src/model/gridXY.ts';

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

/**
 * Decode and thin a grid (every `stride`-th cell each way, the cell centres kept where they are): the thinned origin is
 * shifted so that coarseVertexXY(thinned, r, c) is the centre of the full cell (r × stride, c × stride) whose value it takes.
 */
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

/** A road's corridor as the solver fixed it (solve_report.json roads[]); read and drawn from PR ⑤ on, always [] here. */
export interface RoadSegmentJson {
  id: string;
  width_m: number;
  /** [x0, y0, z0, x1, y1, z1]: EPSG:5186 m and absolute heights m. */
  segments: [number, number, number, number, number, number][];
}

/** GET /terrain's answer (the editor reads it in api.ts fetchTerrain; every key after `walls` may be missing from an older server). */
export interface TerrainJson {
  grid: TerrainGridJson;
  walls: TerrainWallJson[];
  plazaHeights: Record<string, number>;
  tiles: TerrainTileJson[];
  roads: RoadSegmentJson[];
}

/**
 * GET /terrain's answer: the thinned grid, the 1 m sections across the store's walls (none when the store is missing or
 * broken), the height the solver held each 평지 at (solve_report.json plazas[]: id → h_m; empty without a report), the 1 m
 * tiles round each plaza of the report that has a bbox_xy (none without: the view then presses the coarse cells), and the
 * roads (always [] until the view draws them).
 */
export async function readTerrain(
  jsonPath: string, source: TerrainGridJson['source'], storeText: string | null, maxCells = MAX_CELLS, reportText: string | null = null,
): Promise<TerrainJson> {
  const { meta, bytes } = await readGridBytes(jsonPath);
  const grid = decodeGrid(meta, bytes, source, maxCells);
  let walls: TerrainWallJson[] = [];
  try {
    walls = terrainWalls(gridValues(meta, bytes), wallsFromStore(storeText), grid.res);
  } catch {
    walls = []; // a wall that cannot be read never keeps the relief from being drawn
  }
  let tiles: TerrainTileJson[] = [];
  try {
    tiles = terrainTiles(gridValues(meta, bytes), grid, plazaTileAreas(reportText));
  } catch {
    tiles = []; // tiles that cannot be made never keep the relief from being drawn (the view presses the coarse cells)
  }
  return { grid, walls, plazaHeights: plazaHeightsFromReport(reportText), tiles, roads: [] };
}

/** 평지 heights from a solve_report.json text: { plaza id → h_m }. A missing or broken report, or one without plazas, gives {}. */
export function plazaHeightsFromReport(text: string | null): Record<string, number> {
  if (text === null) return {};
  try {
    const rows = (JSON.parse(text) as { plazas?: unknown }).plazas;
    if (!Array.isArray(rows)) return {};
    const out: Record<string, number> = {};
    for (const r of rows as { id?: unknown; h_m?: unknown }[]) {
      if (typeof r?.id === 'string' && typeof r.h_m === 'number' && Number.isFinite(r.h_m)) out[r.id] = r.h_m;
    }
    return out;
  } catch {
    return {}; // a report that cannot be read never keeps the relief from being drawn
  }
}

// ---- 평지 tiles: the thinned cells round a plaza again at 1 m, from the grid at its own resolution ----
//
// The thinned grid (10 m on 한양대) cannot follow a plaza's edge: a triangle there reaches up to 14 m past it. Round every
// plaza the coarse cells (the squares between four thinned vertices) are sent again split sub × sub, read from the full
// grid, so the view can press the relief under the plane only where the edge is (model/terrainFootprint.ts terrainSurface).
// Sewing: a tile's four corners are the coarse values themselves; a vertex on its edge is read from the full grid when the
// cell across that edge is a tile of the same sub too (both read the very same point: the same value), and is otherwise the
// straight line between the two corners — on the coarse triangle's edge beside it, so there is no crack.

/** A plaza's bbox is grown by this before it is tiled (≥ the solver's shoulder ease of 8 m + 2 m). */
export const TILE_MARGIN_M = 10;
/** The size of a plaza tile's cells (m): sub = ceil(coarse res / this), 10 on a 10 m grid. */
export const PLAZA_TILE_RES_M = 1;
/** The most tile triangles (2 × sub² a coarse cell) sent in all; areas past it are left to the coarse cells. */
export const TILE_MAX_TRIANGLES = 250_000;

/** A coarse cell (vertices (r, c) … (r + 1, c + 1)) split sub × sub, read from the grid at its own resolution. */
export interface TerrainTileJson {
  /** The row and column of the cell's north-west vertex in the thinned grid. */
  r: number;
  c: number;
  /** Pieces a side (≥ 2). */
  sub: number;
  /**
   * (sub + 1)² heights (m), row by row from the north: the corners as the coarse grid has them, an edge vertex with no tile
   * beside it on the straight line between its corners, the rest read from the full grid to the mm; null without data.
   */
  z: (number | null)[];
}

/** Where to tile: a plaza's (or, later, a road's) box, EPSG:5186 [xmin, ymin, xmax, ymax] m, the margin already in it. */
export interface TileArea {
  kind: 'plaza' | 'road';
  id: string;
  box: [number, number, number, number];
}

/** Height at (x, y) (EPSG:5186 m) from the grid at its own resolution: bilinear between cell centres; null off it or next to no data. */
export function sampleGridValues(g: GridValues, x: number, y: number): number | null {
  const EPS = 1e-9;
  const fc = (x - g.originX) / g.res - 0.5;
  const fr = (g.originY - y) / g.res - 0.5;
  if (!(fc >= -EPS && fr >= -EPS && fc <= g.width - 1 + EPS && fr <= g.height - 1 + EPS)) return null;
  const col = Math.min(Math.max(fc, 0), g.width - 1);
  const row = Math.min(Math.max(fr, 0), g.height - 1);
  const c0 = Math.max(0, Math.min(Math.floor(col), g.width - 2));
  const r0 = Math.max(0, Math.min(Math.floor(row), g.height - 2));
  const [u, v] = [col - c0, row - r0];
  let sum = 0;
  for (const [dr, dc, w] of [[0, 0, (1 - u) * (1 - v)], [0, 1, u * (1 - v)], [1, 0, (1 - u) * v], [1, 1, u * v]] as const) {
    if (w <= 0) continue; // a cell with no weight here (a point on a centre or an edge) may have no data
    const h = g.at(r0 + dr, c0 + dc);
    if (h === null) return null;
    sum += w * h;
  }
  return sum;
}

/** The plazas of a solve_report.json text with a bbox_xy, as tile areas grown by TILE_MARGIN_M. None for no text, a broken one, or no bbox_xy. */
export function plazaTileAreas(text: string | null): TileArea[] {
  if (text === null) return [];
  try {
    const rows = (JSON.parse(text) as { plazas?: unknown }).plazas;
    if (!Array.isArray(rows)) return [];
    const out: TileArea[] = [];
    for (const r of rows as { id?: unknown; bbox_xy?: unknown }[]) {
      const b = r?.bbox_xy;
      if (typeof r?.id !== 'string' || !Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const [x0, y0, x1, y1] = b as number[];
      if (!(x0! <= x1! && y0! <= y1!)) continue;
      out.push({ kind: 'plaza', id: r.id, box: [x0! - TILE_MARGIN_M, y0! - TILE_MARGIN_M, x1! + TILE_MARGIN_M, y1! + TILE_MARGIN_M] });
    }
    return out;
  } catch {
    return [];
  }
}

const mm = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The tiles for `areas` over the thinned grid `coarse`, read from the full grid `g`: every coarse cell an area's box meets.
 * Budget (opts.maxTriangles, TILE_MAX_TRIANGLES): the plazas first, in the order given, a whole plaza at a time (one that
 * does not fit is left out and the next is tried); then the roads, the longest box first, until one does not fit. What is
 * left out is drawn from the coarse cells (the view presses those instead). A grid already as fine as the tiles gives none.
 */
export function terrainTiles(g: GridValues, coarse: TerrainGridJson, areas: readonly TileArea[], opts: { maxTriangles?: number } = {}): TerrainTileJson[] {
  const max = opts.maxTriangles ?? TILE_MAX_TRIANGLES;
  const W = coarse.width;
  const sub = Math.ceil(coarse.res / PLAZA_TILE_RES_M - 1e-9);
  if (sub < 2 || W < 2 || coarse.height < 2) return [];
  const cost = 2 * sub * sub;
  /** The coarse cells (r × W + c) a box meets, edges included. */
  const cellsOf = (box: TileArea['box']): number[] => {
    const [x0, y0, x1, y1] = box;
    const c0 = Math.max(0, Math.floor((x0 - coarse.originX) / coarse.res - 0.5) - 1);
    const c1 = Math.min(W - 2, Math.ceil((x1 - coarse.originX) / coarse.res - 0.5) + 1);
    const r0 = Math.max(0, Math.floor((coarse.originY - y1) / coarse.res - 0.5) - 1);
    const r1 = Math.min(coarse.height - 2, Math.ceil((coarse.originY - y0) / coarse.res - 0.5) + 1);
    const out: number[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const [ax, ay] = coarseVertexXY(coarse, r, c);
        const [bx, by] = coarseVertexXY(coarse, r + 1, c + 1);
        if (bx >= x0 && ax <= x1 && ay >= y0 && by <= y1) out.push(r * W + c);
      }
    }
    return out;
  };
  const span = (a: TileArea) => Math.max(a.box[2] - a.box[0], a.box[3] - a.box[1]);
  const order = [
    ...areas.filter((a) => a.kind === 'plaza'),
    ...areas.filter((a) => a.kind === 'road').sort((a, b) => span(b) - span(a)),
  ];
  const chosen = new Set<number>();
  let used = 0;
  for (const a of order) {
    const fresh = cellsOf(a.box).filter((q) => !chosen.has(q));
    if (used + fresh.length * cost > max) {
      if (a.kind === 'road') break;
      continue;
    }
    for (const q of fresh) chosen.add(q);
    used += fresh.length * cost;
  }
  const at = (r: number, c: number) => coarse.z[r * W + c] ?? null;
  const read = (r: number, c: number): number | null => {
    const [x, y] = coarseVertexXY(coarse, r, c);
    const h = sampleGridValues(g, x, y);
    return h === null ? null : mm(h);
  };
  const lerp = (a: number | null, b: number | null, t: number) => (a === null || b === null ? null : a + (b - a) * t);
  const out: TerrainTileJson[] = [];
  for (const q of [...chosen].sort((a, b) => a - b)) {
    const [r, c] = [Math.floor(q / W), q % W];
    const [nw, ne, sw, se] = [at(r, c), at(r, c + 1), at(r + 1, c), at(r + 1, c + 1)];
    const beside = { n: chosen.has(q - W), s: chosen.has(q + W), w: c > 0 && chosen.has(q - 1), e: chosen.has(q + 1) && c + 1 < W - 1 };
    const z: (number | null)[] = [];
    for (let i = 0; i <= sub; i++) {
      for (let j = 0; j <= sub; j++) {
        const [ti, tj] = [i / sub, j / sub];
        if ((i === 0 || i === sub) && (j === 0 || j === sub)) z.push(i === 0 ? (j === 0 ? nw : ne) : j === 0 ? sw : se);
        else if (i === 0) z.push(beside.n ? read(r, c + tj) : lerp(nw, ne, tj));
        else if (i === sub) z.push(beside.s ? read(r + 1, c + tj) : lerp(sw, se, tj));
        else if (j === 0) z.push(beside.w ? read(r + ti, c) : lerp(nw, sw, ti));
        else if (j === sub) z.push(beside.e ? read(r + ti, c + 1) : lerp(ne, se, ti));
        else z.push(read(r + ti, c + tj));
      }
    }
    out.push({ r, c, sub, z });
  }
  return out;
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
