// 지형 3D and 건물 3D in the editor (map/Deck3D.ts draws them with deck.gl over MapLibre): the height grid, its
// conversion from EPSG:5186 (the grid files of tools/elevation), the terrain mesh, paths draped on it, and the heights of
// the floors, the indoor points and the vertical links between floors. Display only: nothing here changes the data, and
// routing never reads a height.
import {
  edgeCoords, framePlaza, localFrame, locateXY, outlineOfLevel, stackLayout, type EditBuilding, type StackMode, type EditState, type Level,
  type Position, type XY,
} from '@campo/core';

// EPSG:5186 lives in korea2000.ts (no imports, so the dev server reads it too).
export { fromKorea2000, toKorea2000 } from './korea2000.ts';
import { fromKorea2000, toKorea2000 } from './korea2000.ts';

// ---- the height grid ----

/** A height grid as the dev server sends it (tools/elevation campo_grid: cell centres, north row first, metres). */
export interface TerrainGrid {
  /** 'corrected': the solver's corrected_dem; 'dem': the plain DEM; 'sample': made up here when there is neither. */
  source: 'corrected' | 'dem' | 'sample';
  crs: 'EPSG:5186';
  /** Left and top edges of the grid (cell edges), cell size, cells across and down. */
  originX: number;
  originY: number;
  res: number;
  width: number;
  height: number;
  /** Heights row by row from the north, null where there is no data. */
  z: (number | null)[];
}

/** Height at a position (bilinear between cell centres), or null outside the grid or where it has no data. */
export function sampleTerrain(grid: TerrainGrid, p: Position): number | null {
  const [x, y] = toKorea2000(p);
  // A hair of tolerance at the outer cell centres (the projection is not exact to the last bit).
  const EPS = 0.01;
  const rawCol = (x - grid.originX) / grid.res - 0.5;
  const rawRow = (grid.originY - y) / grid.res - 0.5;
  if (rawCol < -EPS || rawRow < -EPS || rawCol > grid.width - 1 + EPS || rawRow > grid.height - 1 + EPS) return null;
  const col = Math.min(Math.max(rawCol, 0), grid.width - 1);
  const row = Math.min(Math.max(rawRow, 0), grid.height - 1);
  const c0 = Math.min(Math.floor(col), grid.width - 2);
  const r0 = Math.min(Math.floor(row), grid.height - 2);
  const [fc, fr] = [col - c0, row - r0];
  const at = (r: number, c: number) => grid.z[r * grid.width + c] ?? null;
  const v = [at(r0, c0), at(r0, c0 + 1), at(r0 + 1, c0), at(r0 + 1, c0 + 1)];
  if (grid.width === 1 || grid.height === 1) return v[0] ?? null;
  if (v.some((h) => h === null)) return v.find((h) => h !== null) ?? null;
  const [a, b, c, d] = v as number[];
  return a! * (1 - fc) * (1 - fr) + b! * fc * (1 - fr) + c! * (1 - fc) * fr + d! * fc * fr;
}

/** The lowest height of the grid: the 3D view stands it on the map plane (z = height − base). */
export function terrainBase(grid: TerrainGrid): number {
  let min = Infinity;
  for (const h of grid.z) if (h !== null && h < min) min = h;
  return Number.isFinite(min) ? min : 0;
}

/**
 * The relief as a surface over the map: z (metres above the grid's lowest point) at any position, 0 off the grid.
 * Without a grid everything is at 0 (flat ground).
 */
export type Ground = (p: Position) => number;
/** `k`: the height exaggeration of the 3D view (1: true heights). */
export function groundOf(grid: TerrainGrid | null, k = 1): Ground {
  if (!grid) return () => 0;
  const base = terrainBase(grid);
  return (p) => {
    const h = sampleTerrain(grid, p);
    return h === null ? 0 : (h - base) * k;
  };
}

/** The highest height of the grid above its lowest point (0 without data). */
export function terrainTop(grid: TerrainGrid): number {
  const base = terrainBase(grid);
  let max = -Infinity;
  for (const h of grid.z) if (h !== null && h > max) max = h;
  return Number.isFinite(max) ? max - base : 0;
}

/** The range of 높이 과장 (the 3D view's height exaggeration), and a value typed in brought into it (1 when not a number). */
export const EXAGGERATION_MIN = 0.5;
export const EXAGGERATION_MAX = 2.5;
export function clampExaggeration(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.round(Math.min(EXAGGERATION_MAX, Math.max(EXAGGERATION_MIN, v)) * 10) / 10;
}

/** A made-up gentle hill around `center` (± 300 m, rising 18 m to the north-east), for trying the view without a grid. */
export function sampleTerrainGrid(center: Position): TerrainGrid {
  const [cx, cy] = toKorea2000(center);
  const res = 10;
  const n = 60;
  const z: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [dx, dy] = [(c - n / 2) * res, (n / 2 - r) * res];
      z.push(30 + 0.02 * dx + 0.025 * dy + 6 * Math.exp(-((dx - 80) ** 2 + (dy - 60) ** 2) / 20000));
    }
  }
  return { source: 'sample', crs: 'EPSG:5186', originX: cx - (n / 2) * res, originY: cy + (n / 2) * res, res, width: n, height: n, z };
}

export interface TerrainCell {
  /** A triangle of the surface: three [lng, lat, z]. */
  polygon: [number, number, number][];
  /** Its height above the grid's lowest point (mean of the corners), for the colour. */
  z: number;
}

// ---- 평지(plaza): one flat plane, drawn as its own exact mesh (map/deck3d.ts) ----

/** A plaza as 지형 3D gets it: its rings and the height the solver held it at (null: not solved yet). */
export interface PlazaSurface {
  id: string;
  rings: Position[][];
  h: number | null;
}

/** A plaza ready to draw: its plane at z = (H − the grid's lowest height) × 높이 과장. */
export interface PlazaFlat {
  id: string;
  rings: Position[][];
  z: number;
}

/** H of a plaza: the solver's value, else the median of the relief sampled at the grid cell centres inside it (its corners when none). */
export function plazaHeight(grid: TerrainGrid | null, p: PlazaSurface): number | null {
  if (p.h !== null && Number.isFinite(p.h)) return p.h;
  if (!grid || p.rings.length === 0) return null;
  const framed = framePlaza(p.rings);
  const xs = p.rings[0]!.map((q) => toKorea2000(q));
  const [x0, x1] = [Math.min(...xs.map((q) => q[0])), Math.max(...xs.map((q) => q[0]))];
  const [y0, y1] = [Math.min(...xs.map((q) => q[1])), Math.max(...xs.map((q) => q[1]))];
  const values: number[] = [];
  const c0 = Math.max(0, Math.floor((x0 - grid.originX) / grid.res));
  const c1 = Math.min(grid.width - 1, Math.ceil((x1 - grid.originX) / grid.res));
  const r0 = Math.max(0, Math.floor((grid.originY - y1) / grid.res));
  const r1 = Math.min(grid.height - 1, Math.ceil((grid.originY - y0) / grid.res));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const h = grid.z[r * grid.width + c];
      if (h === null || h === undefined) continue;
      const at = fromKorea2000(grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res);
      if (locateXY(framed.rings, framed.frame.toXY(at)) === 'solid') values.push(h);
    }
  }
  if (values.length === 0) for (const q of p.rings[0]!) {
    const h = sampleTerrain(grid, q);
    if (h !== null) values.push(h);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const m = values.length >> 1;
  return values.length % 2 ? values[m]! : (values[m - 1]! + values[m]!) / 2;
}

interface FramedFlat {
  flat: PlazaFlat;
  rings: XY[][];
  toXY: (p: Position) => XY;
}

const frameFlats = (flats: readonly PlazaFlat[]): FramedFlat[] => flats.filter((f) => f.rings.length > 0).map((flat) => {
  const framed = framePlaza(flat.rings);
  return { flat, rings: framed.rings, toXY: framed.frame.toXY };
});

/** The ground with the plazas on it: inside a plaza's solid area its plane, elsewhere (a hole too) the relief. */
export function plazaGround(ground: Ground, flats: readonly PlazaFlat[]): Ground {
  const framed = frameFlats(flats);
  if (framed.length === 0) return ground;
  return (p) => {
    for (const f of framed) if (locateXY(f.rings, f.toXY(p)) === 'solid') return f.flat.z;
    return ground(p);
  };
}

/**
 * The plaza a grid vertex belongs to: `clamp` when the vertex is inside the solid area grown by 0.75 cell (its height is
 * set to the plane, so the relief meets the plaza's edge), `inside` when it is in the solid area itself.
 */
function flatOf(framed: readonly FramedFlat[], at: Position, grow: number): { index: number; inside: boolean } | null {
  for (let i = 0; i < framed.length; i++) {
    const f = framed[i]!;
    const xy = f.toXY(at);
    if (locateXY(f.rings, xy, grow) !== 'solid') continue;
    return { index: i, inside: locateXY(f.rings, xy) === 'solid' };
  }
  return null;
}

/**
 * The surface as triangles (two per cell between cell centres, every `step` cells), z above the grid's lowest point (× k).
 * `skip`: cells (row × width + col of their north-west centre) left out, where a wall's section is drawn instead (wallCells).
 * `flat`: 평지. A cell centre inside a plaza grown by 0.75 cell takes the plaza's plane; a triangle whose three corners are
 * inside one plaza's solid area (and its middle too) is left out, as the plaza's own exact mesh is drawn there. Without
 * `flat` the mesh is as before.
 */
export function terrainMesh(grid: TerrainGrid, step = 1, k = 1, skip?: ReadonlySet<number>, flat?: readonly PlazaFlat[]): TerrainCell[] {
  const base = terrainBase(grid);
  const framed = flat && flat.length > 0 ? frameFlats(flat) : [];
  const owner = new Map<number, { index: number; inside: boolean } | null>();
  const vertexOwner = (r: number, c: number, at: Position) => {
    const key = r * grid.width + c;
    if (!owner.has(key)) owner.set(key, flatOf(framed, at, 0.75 * grid.res));
    return owner.get(key)!;
  };
  const vertex = (r: number, c: number): [number, number, number] | null => {
    const h = grid.z[r * grid.width + c];
    if (h === null || h === undefined) return null;
    const [lng, lat] = fromKorea2000(grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res);
    if (framed.length > 0) {
      const o = vertexOwner(r, c, [lng, lat]);
      if (o) return [lng, lat, framed[o.index]!.flat.z];
    }
    return [lng, lat, (h - base) * k];
  };
  const coveredByPlaza = (corners: [number, number][]): boolean => {
    if (framed.length === 0) return false;
    const owners = corners.map(([r, c]) => owner.get(r * grid.width + c) ?? null);
    const first = owners[0];
    if (!first || !owners.every((o) => o && o.inside && o.index === first.index)) return false;
    const pts = corners.map(([r, c]) => fromKorea2000(grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res));
    const mid: Position = [(pts[0]![0] + pts[1]![0] + pts[2]![0]) / 3, (pts[0]![1] + pts[1]![1] + pts[2]![1]) / 3];
    const f = framed[first.index]!;
    return locateXY(f.rings, f.toXY(mid)) === 'solid';
  };
  const skipped = (r: number, c: number): boolean => {
    if (!skip || skip.size === 0) return false;
    for (let i = r; i < r + step; i++) for (let j = c; j < c + step; j++) if (skip.has(i * grid.width + j)) return true;
    return false;
  };
  const cells: TerrainCell[] = [];
  for (let r = 0; r + step < grid.height; r += step) {
    for (let c = 0; c + step < grid.width; c += step) {
      if (skipped(r, c)) continue;
      const [a, b, d, e] = [vertex(r, c), vertex(r, c + step), vertex(r + step, c), vertex(r + step, c + step)];
      const at: [number, number][] = [[r, c], [r, c + step], [r + step, c], [r + step, c + step]];
      const tris: [([number, number, number] | null)[], number[]][] = [[[a, b, e], [0, 1, 3]], [[a, e, d], [0, 3, 2]]];
      for (const [tri, idx] of tris) {
        if (coveredByPlaza(idx.map((i) => at[i]!))) continue;
        if (tri.every((v) => v !== null)) {
          const pts = tri as [number, number, number][];
          cells.push({ polygon: pts, z: (pts[0]![2] + pts[1]![2] + pts[2]![2]) / 3 });
        }
      }
    }
  }
  return cells;
}

// ---- 옹벽: the drawn retaining walls as upright faces ----
//
// The grid comes thinned (one value every ~9 m), which smears a wall's 1 m step into a slope. The dev server sends, for
// every drawn break line with lowSide and dropM > 0, a section read from the grid at its own resolution (server/terrain.ts
// terrainWalls): rows across the line every metre, two rows at offset 0 (the low ground and the high ground at the line).
// Drawn as a strip, the cells between the two 0 rows are the wall's face. The thinned cells the wall crosses are left out
// of the relief (wallCells), so their smeared triangles neither cover the face nor poke through it; the section is wider
// than a thinned cell's diagonal, so it covers them.

/** A wall's section as GET /terrain sends it. */
export interface TerrainWall {
  id: string;
  lowSide: 'left' | 'right';
  dropM: number;
  /** Rows across the line (m): -W … -1, 0 (low ground at the line), 0 (high ground at the line), 1 … W. */
  offsets: number[];
  /** Columns: points on the line (EPSG:5186 m), run out W past both ends; nx, ny: the unit normal toward the high side. */
  x: number[];
  y: number[];
  nx: number[];
  ny: number[];
  /** The columns at the first and the last drawn point. */
  drawn: [number, number];
  /** Heights (m), rows × cols row by row, null where the grid has none. */
  z: (number | null)[];
}

/** The EPSG:5186 point of a section's row and column: the column's point on the line + offset × its high normal. */
export function wallPoint(w: TerrainWall, row: number, col: number): [number, number] {
  const o = w.offsets[row]!;
  return [w.x[col]! + o * w.nx[col]!, w.y[col]! + o * w.ny[col]!];
}

export interface WallTriangle {
  /** Three [lng, lat, z], z as terrainMesh's (height − the grid's lowest point) × k, + lift. */
  polygon: [number, number, number][];
  /** Mean z of the corners, for the colour. */
  z: number;
  /** 'face': between the two 0 rows (the upright wall); 'strip': the ground on either side. */
  role: 'strip' | 'face';
  wall: string;
}

/** Every wall's section as triangles (two per cell of rows × cols; a cell with a missing corner is left out). */
export function wallMesh(grid: TerrainGrid, walls: readonly TerrainWall[], k = 1, lift = 0): WallTriangle[] {
  const base = terrainBase(grid);
  const out: WallTriangle[] = [];
  for (const w of walls) {
    const cols = w.x.length;
    const face = w.offsets.findIndex((o, i) => o === 0 && w.offsets[i + 1] === 0);
    const vertex = (r: number, c: number): [number, number, number] | null => {
      const h = w.z[r * cols + c];
      if (h === null || h === undefined) return null;
      const [x, y] = wallPoint(w, r, c);
      const [lng, lat] = fromKorea2000(x, y);
      return [lng, lat, (h - base) * k + lift];
    };
    for (let r = 0; r + 1 < w.offsets.length; r++) {
      const role = r === face ? 'face' : 'strip';
      for (let c = 0; c + 1 < cols; c++) {
        const [a, b, d, e] = [vertex(r, c), vertex(r, c + 1), vertex(r + 1, c), vertex(r + 1, c + 1)];
        if (!a || !b || !d || !e) continue;
        for (const polygon of [[a, b, e], [a, e, d]]) {
          out.push({ polygon, z: (polygon[0]![2] + polygon[1]![2] + polygon[2]![2]) / 3, role, wall: w.id });
        }
      }
    }
  }
  return out;
}

/**
 * The cells of the (thinned) grid a wall's drawn line crosses or touches (row × width + col of the cell's north-west
 * centre, as terrainMesh's `skip`). Cells are the squares between four cell centres.
 */
export function wallCells(grid: TerrainGrid, walls: readonly TerrainWall[]): Set<number> {
  const out = new Set<number>();
  const X = (c: number) => grid.originX + (c + 0.5) * grid.res;
  const Y = (r: number) => grid.originY - (r + 0.5) * grid.res;
  // Does the segment a → b meet the box [x0, x1] × [y0, y1] (edges included)? Liang–Barsky.
  const meets = (ax: number, ay: number, bx: number, by: number, x0: number, x1: number, y0: number, y1: number): boolean => {
    let [t0, t1] = [0, 1];
    const [dx, dy] = [bx - ax, by - ay];
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as const) {
      if (p === 0) {
        if (q < 0) return false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return false;
      }
    }
    return true;
  };
  for (const w of walls) {
    for (let i = w.drawn[0]; i < w.drawn[1]; i++) {
      const [ax, ay, bx, by] = [w.x[i]!, w.y[i]!, w.x[i + 1]!, w.y[i + 1]!];
      if (ax === bx && ay === by) continue;
      const cA = Math.floor((Math.min(ax, bx) - grid.originX) / grid.res - 0.5);
      const cB = Math.floor((Math.max(ax, bx) - grid.originX) / grid.res - 0.5);
      const rA = Math.floor((grid.originY - Math.max(ay, by)) / grid.res - 0.5);
      const rB = Math.floor((grid.originY - Math.min(ay, by)) / grid.res - 0.5);
      for (let r = Math.max(0, rA - 1); r <= Math.min(grid.height - 2, rB + 1); r++) {
        for (let c = Math.max(0, cA - 1); c <= Math.min(grid.width - 2, cB + 1); c++) {
          if (meets(ax, ay, bx, by, X(c), X(c + 1), Y(r + 1), Y(r))) out.add(r * grid.width + c);
        }
      }
    }
  }
  return out;
}

/** Metres between two positions (flat, good over a campus). */
function metres(a: Position, b: Position): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
  return Math.hypot((b[0] - a[0]) * 111_320 * k, (b[1] - a[1]) * 110_574);
}

/** A line laid on the ground: extra points every `spacingM` metres so it follows the relief, each `lift` above it. */
export function drapePath(coords: readonly Position[], ground: Ground, spacingM = 4, lift = 0.4): [number, number, number][] {
  const out: [number, number, number][] = [];
  coords.forEach((p, i) => {
    if (i > 0) {
      const q = coords[i - 1]!;
      // Pieces of at most spacingM.
      const n = Math.ceil(metres(q, p) / spacingM - 1e-9);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const m: Position = [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t];
        out.push([m[0], m[1], ground(m) + lift]);
      }
    }
    out.push([p[0], p[1], ground(p) + lift]);
  });
  return out;
}

// ---- buildings: where they stand, their floors, their points and the links between floors ----

/** The height a building stands at: the lowest ground under the outline of its ground floors (0 without a grid). */
export function buildingGround(b: Pick<EditBuilding, 'polygon' | 'props'>, ground: Ground): number {
  const levels = b.props.ground_levels.length > 0 ? b.props.ground_levels : [1];
  let min = Infinity;
  for (const level of levels) for (const p of outlineOfLevel(b, level)[0] ?? []) min = Math.min(min, ground(p));
  return Number.isFinite(min) ? min : 0;
}

/**
 * Height of each floor's base of a building (level → z of its floor), on its ground; floor heights × k. With the
 * terrain on (mode 'terrain') the floors stand on the building's plinth (core stackLayout), if it has one.
 */
export function floorBases(
  b: Pick<EditBuilding, 'polygon' | 'props'>, ground: Ground, measured?: ReadonlyMap<Level, number>, k = 1, mode: StackMode = 'flat',
): Map<Level, number> {
  const g = buildingGround(b, ground);
  return new Map(stackLayout(b, measured, mode).floors.map((s) => [s.level, g + s.baseM * k]));
}

/** z of every point: outdoors on the ground, indoors on its floor (a little above, so it does not sink into the slab). */
export function nodeHeights(
  state: EditState, ground: Ground, measured: (buildingId: string) => ReadonlyMap<Level, number> = () => new Map(), k = 1, mode: StackMode = 'flat',
): Map<string, number> {
  const bases = new Map<string, Map<Level, number>>();
  for (const b of Object.values(state.buildings)) bases.set(b.id, floorBases(b, ground, measured(b.id), k, mode));
  const out = new Map<string, number>();
  for (const n of Object.values(state.nodes)) {
    const { building_id: id, level } = n.props;
    const floor = id !== null && level !== null ? bases.get(id)?.get(level) : undefined;
    out.set(n.id, floor !== undefined ? floor + 0.3 : ground(n.coord) + 0.4);
  }
  return out;
}

export interface Segment3D {
  from: [number, number, number];
  to: [number, number, number];
  /** 'elevator' / 'steps': a link between floors; 'flat': on one floor (or outdoors). */
  kind: 'elevator' | 'steps' | 'flat';
  /** On the floor shown (strong) or another one (faint). */
  strong: boolean;
}

/**
 * The paths of one building in 3D: every edge with an end in it, each end at its own height. Edges between floors
 * (elevators, stairs, escalators) are links: an elevator or a flight between two stops at one spot is a vertical line.
 * An elevator's stops that share an elevator_id are also joined (lowest to highest) in case an edge between them is missing.
 */
export function buildingSegments(state: EditState, buildingId: string, level: Level, z: ReadonlyMap<string, number>): Segment3D[] {
  const at = (id: string): [number, number, number] | null => {
    const n = state.nodes[id];
    return n ? [n.coord[0], n.coord[1], z.get(id) ?? 0] : null;
  };
  const inside = (id: string) => state.nodes[id]?.props.building_id === buildingId;
  const onFloor = (id: string) => inside(id) && state.nodes[id]!.props.level === level;
  const out: Segment3D[] = [];
  for (const e of Object.values(state.edges)) {
    const { from, to } = e.props;
    if (!inside(from) && !inside(to)) continue;
    const [a, b] = [at(from), at(to)];
    if (!a || !b) continue;
    const vertical = e.props.highway === 'elevator' || (e.props.highway === 'steps' && state.nodes[from]?.props.level !== state.nodes[to]?.props.level);
    const kind: Segment3D['kind'] = !vertical ? 'flat' : e.props.highway === 'elevator' ? 'elevator' : 'steps';
    if (kind === 'flat') {
      // A flat edge keeps its bends, at the height of its ends.
      const pts = edgeCoords(state, e);
      for (let i = 0; i + 1 < pts.length; i++) {
        const t0 = i / (pts.length - 1);
        const t1 = (i + 1) / (pts.length - 1);
        out.push({
          from: [pts[i]![0], pts[i]![1], a[2] + (b[2] - a[2]) * t0],
          to: [pts[i + 1]![0], pts[i + 1]![1], a[2] + (b[2] - a[2]) * t1],
          kind, strong: onFloor(from) || onFloor(to),
        });
      }
    } else {
      out.push({ from: a, to: b, kind, strong: onFloor(from) || onFloor(to) });
    }
  }
  const shafts = new Map<string, string[]>();
  for (const n of Object.values(state.nodes)) {
    if (n.props.building_id === buildingId && n.props.node_type === 'elevator_stop' && n.props.elevator_id) {
      shafts.set(n.props.elevator_id, [...(shafts.get(n.props.elevator_id) ?? []), n.id]);
    }
  }
  for (const stops of shafts.values()) {
    if (stops.length < 2) continue;
    const sorted = stops.map(at).filter((p): p is [number, number, number] => p !== null).sort((p, q) => p[2] - q[2]);
    out.push({ from: sorted[0]!, to: sorted[sorted.length - 1]!, kind: 'elevator', strong: stops.some(onFloor) });
  }
  return out;
}

/**
 * Light lines along every `every`-th row and column of the grid (z above its lowest point): the bend of a line shows the
 * slope. A line breaks along the cells in `skip` (where a wall's section is drawn instead).
 */
export function terrainWire(grid: TerrainGrid, every: number, k = 1, skip?: ReadonlySet<number>, flat?: readonly PlazaFlat[]): [number, number, number][][] {
  const base = terrainBase(grid);
  const framed = flat && flat.length > 0 ? frameFlats(flat) : [];
  const owners = new Map<number, { index: number; inside: boolean } | null>();
  const ownerOf = (r: number, c: number) => {
    const key = r * grid.width + c;
    if (!owners.has(key)) owners.set(key, flatOf(framed, fromKorea2000(grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res), 0.75 * grid.res));
    return owners.get(key)!;
  };
  const vertex = (r: number, c: number): [number, number, number] | null => {
    const h = grid.z[r * grid.width + c];
    if (h === null || h === undefined) return null;
    const [lng, lat] = fromKorea2000(grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res);
    const o = framed.length > 0 ? ownerOf(r, c) : null;
    return [lng, lat, (o ? framed[o.index]!.flat.z : (h - base) * k) + 0.05];
  };
  /** Both ends inside one plaza's solid area: the plaza is drawn there, so the wire breaks (no line shows through it). */
  const onPlaza = (r0: number, c0: number, r1: number, c1: number): boolean => {
    if (framed.length === 0) return false;
    const [a, b] = [ownerOf(r0, c0), ownerOf(r1, c1)];
    return !!a && !!b && a.inside && b.inside && a.index === b.index;
  };
  const cut = (r: number, c: number) => skip !== undefined && r >= 0 && c >= 0 && skip.has(r * grid.width + c);
  const lines: [number, number, number][][] = [];
  const flush = (run: [number, number, number][]) => {
    if (run.length > 1) lines.push(run);
  };
  for (let r = 0; r < grid.height; r += every) {
    let run: [number, number, number][] = [];
    for (let c = 0; c < grid.width; c++) {
      const v = vertex(r, c);
      // The piece (r, c - 1) → (r, c) lies on the cells above and below it.
      if (c > 0 && (cut(r - 1, c - 1) || cut(r, c - 1) || onPlaza(r, c - 1, r, c))) { flush(run); run = []; }
      if (v) run.push(v);
      else { flush(run); run = []; }
    }
    flush(run);
  }
  for (let c = 0; c < grid.width; c += every) {
    let run: [number, number, number][] = [];
    for (let r = 0; r < grid.height; r++) {
      const v = vertex(r, c);
      if (r > 0 && (cut(r - 1, c - 1) || cut(r - 1, c) || onPlaza(r - 1, c, r, c))) { flush(run); run = []; }
      if (v) run.push(v);
      else { flush(run); run = []; }
    }
    flush(run);
  }
  return lines;
}

// ---- routes in 3D (경로 테스트) ----

/**
 * What a point of a route stands on: a node (outdoors on the ground, indoors on its floor), or, for a picked end and
 * the foot of its perpendicular on the route, the floor or the outdoors it was picked in.
 */
export type RouteRef = { node: string } | { scope: { kind: 'outdoor' } | { kind: 'building'; buildingId: string; level: Level } };

/** How far a route floats over the ground or its floor, so it is never buried in the relief or a floor plate. */
export const ROUTE_LIFT_M = 0.9;

/**
 * A route as a 3D line: each point at the height of what it stands on (+ ROUTE_LIFT_M); between two outdoor points
 * extra points every few metres follow the relief, elsewhere (indoors, an elevator, a portal) the line goes straight.
 */
export function routePath3D(
  state: EditState, coords: readonly Position[], refs: readonly RouteRef[] | undefined, ground: Ground,
  floorZ: (buildingId: string, level: Level) => number | undefined,
): [number, number, number][] {
  const outdoor = (i: number): boolean => {
    const r = refs?.[i];
    if (!r) return true;
    if ('node' in r) return state.nodes[r.node]?.props.building_id == null;
    return r.scope.kind === 'outdoor';
  };
  const z = (i: number): number => {
    const r = refs?.[i];
    const p = coords[i]!;
    if (r && 'node' in r) {
      const n = state.nodes[r.node];
      const { building_id: b, level } = n?.props ?? { building_id: null, level: null };
      const f = b != null && level != null ? floorZ(b, level) : undefined;
      return (f ?? ground(p)) + ROUTE_LIFT_M;
    }
    if (r && r.scope.kind === 'building') return (floorZ(r.scope.buildingId, r.scope.level) ?? ground(p)) + ROUTE_LIFT_M;
    return ground(p) + ROUTE_LIFT_M;
  };
  const out: [number, number, number][] = [];
  coords.forEach((p, i) => {
    const zi = z(i);
    if (i > 0) {
      const q = coords[i - 1]!;
      const n = outdoor(i - 1) && outdoor(i) ? Math.ceil(metres(q, p) / 4 - 1e-9) : 1;
      for (let s = 1; s < n; s++) {
        const t = s / n;
        const m: Position = [q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t];
        out.push([m[0], m[1], ground(m) + ROUTE_LIFT_M]);
      }
    }
    out.push([p[0], p[1], zi]);
  });
  return out;
}

// ---- 지형 3D picking: the relief under the cursor ----

/**
 * Where the sight line through a screen point meets the relief. `rayAt(z)` is the map position the line passes at
 * height z (the view's unproject at that height); `top` is at or above the highest ground. The line is walked down
 * from `top` in small steps to the first place it is at or under the ground, then narrowed by halving. Without a hit
 * (the line passes beside the grid) it is the position at height 0, as on a flat map.
 */
export function pickSurface(rayAt: (z: number) => Position, ground: Ground, top: number, steps = 64): Position {
  const flat = rayAt(0);
  if (!(top > 0)) return flat;
  const above = (z: number) => z - ground(rayAt(z));
  let hi = top + 1;
  if (above(hi) <= 0) return rayAt(hi);
  const dz = hi / steps;
  for (let i = 1; i <= steps; i++) {
    const lo = Math.max(0, hi - dz);
    if (above(lo) <= 0) {
      let [a, b] = [lo, hi];
      for (let k = 0; k < 24; k++) {
        const m = (a + b) / 2;
        if (above(m) <= 0) a = m;
        else b = m;
      }
      return rayAt((a + b) / 2);
    }
    hi = lo;
  }
  return flat;
}

/**
 * The plaza's cliff (절벽 스커트) where the ground outside it is lower (fill): upright quads along every ring (outer and
 * holes), from the plane down to the ground a little past it − `extraM`. Each ring is cut into pieces of at most `stepM`;
 * a piece gets a quad only where the ground `probeM` out from it (away from the solid area) is more than 2 cm under the
 * plane. Where the ground is higher (cut) there is none: the clamped relief meets the plane there. `ground` is the bare
 * relief (not plazaGround).
 */
export function plazaSkirt(
  flat: PlazaFlat, ground: Ground, opts: { stepM?: number; probeM?: number; extraM?: number } = {},
): { polygon: [number, number, number][]; z: number }[] {
  const stepM = opts.stepM ?? 1;
  const probeM = opts.probeM ?? 0.6;
  const extraM = opts.extraM ?? 0.2;
  if (flat.rings.length === 0) return [];
  const { rings, positions } = framePlaza(flat.rings);
  const frame = localFrame(positions[0]![0]!);
  const out: { polygon: [number, number, number][]; z: number }[] = [];
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [a, b] = [ring[i]!, ring[i + 1]!];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len === 0) continue;
      // The solid area is on the left of the way the normalized ring runs, so out is to the right.
      const n: XY = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      const pieces = Math.max(1, Math.ceil(len / stepM));
      for (let j = 0; j < pieces; j++) {
        const t0 = j / pieces;
        const t1 = (j + 1) / pieces;
        const p0: XY = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1: XY = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        const mid: XY = [(p0[0] + p1[0]) / 2 + n[0] * probeM, (p0[1] + p1[1]) / 2 + n[1] * probeM];
        if (!(ground(frame.toPos(mid[0], mid[1])) < flat.z - 0.02)) continue;
        const g0 = Math.min(flat.z, ground(frame.toPos(p0[0] + n[0] * probeM, p0[1] + n[1] * probeM))) - extraM;
        const g1 = Math.min(flat.z, ground(frame.toPos(p1[0] + n[0] * probeM, p1[1] + n[1] * probeM))) - extraM;
        const [q0, q1] = [frame.toPos(p0[0], p0[1]), frame.toPos(p1[0], p1[1])];
        out.push({ polygon: [[q0[0], q0[1], flat.z], [q1[0], q1[1], flat.z], [q1[0], q1[1], g1], [q0[0], q0[1], g0]], z: flat.z });
      }
    }
  }
  return out;
}
