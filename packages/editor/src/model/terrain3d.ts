// 지형 3D and 건물 3D in the editor (map/Deck3D.ts draws them with deck.gl over MapLibre): the height grid, its
// conversion from EPSG:5186 (the grid files of tools/elevation), the terrain mesh, paths draped on it, and the heights of
// the floors, the indoor points and the vertical links between floors. Display only: nothing here changes the data, and
// routing never reads a height.
import { buildingStack, edgeCoords, outlineOfLevel, type EditBuilding, type EditState, type Level, type Position } from '@campo/core';

// ---- EPSG:5186 (Korea 2000 / Central Belt 2010): transverse Mercator on GRS80 ----

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const LAT0 = (38 * Math.PI) / 180;
const LON0 = (127 * Math.PI) / 180;
const K0 = 1;
const FE = 200000;
const FN = 600000;

function meridian(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
}
const M0 = meridian(LAT0);

/** [longitude, latitude] → [x, y] metres in EPSG:5186. */
export function toKorea2000(p: Position): [number, number] {
  const phi = (p[1] * Math.PI) / 180;
  const lam = (p[0] * Math.PI) / 180;
  const [s, c, t] = [Math.sin(phi), Math.cos(phi), Math.tan(phi)];
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const a = (lam - LON0) * c;
  const x = FE + K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120);
  const y = FN + K0 * (meridian(phi) - M0 + N * t * (a * a / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

/** [x, y] metres in EPSG:5186 → [longitude, latitude]. */
export function fromKorea2000(x: number, y: number): Position {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = (M0 + (y - FN) / K0) / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const [s, c, t] = [Math.sin(phi1), Math.cos(phi1), Math.tan(phi1)];
  const C1 = EP2 * c * c;
  const T1 = t * t;
  const N1 = A / Math.sqrt(1 - E2 * s * s);
  const R1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const D = (x - FE) / (N1 * K0);
  const phi = phi1 - ((N1 * t) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lam = LON0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [(lam * 180) / Math.PI, (phi * 180) / Math.PI];
}

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
export function groundOf(grid: TerrainGrid | null): Ground {
  if (!grid) return () => 0;
  const base = terrainBase(grid);
  return (p) => {
    const h = sampleTerrain(grid, p);
    return h === null ? 0 : h - base;
  };
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

/** The surface as triangles (two per cell between cell centres, every `step` cells), z above the grid's lowest point. */
export function terrainMesh(grid: TerrainGrid, step = 1): TerrainCell[] {
  const base = terrainBase(grid);
  const vertex = (r: number, c: number): [number, number, number] | null => {
    const h = grid.z[r * grid.width + c];
    if (h === null || h === undefined) return null;
    const [lng, lat] = fromKorea2000(grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res);
    return [lng, lat, h - base];
  };
  const cells: TerrainCell[] = [];
  for (let r = 0; r + step < grid.height; r += step) {
    for (let c = 0; c + step < grid.width; c += step) {
      const [a, b, d, e] = [vertex(r, c), vertex(r, c + step), vertex(r + step, c), vertex(r + step, c + step)];
      for (const tri of [[a, b, e], [a, e, d]]) {
        if (tri.every((v) => v !== null)) {
          const pts = tri as [number, number, number][];
          cells.push({ polygon: pts, z: (pts[0]![2] + pts[1]![2] + pts[2]![2]) / 3 });
        }
      }
    }
  }
  return cells;
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

/** Height of each floor's base of a building (level → z of its floor), on its ground. */
export function floorBases(b: Pick<EditBuilding, 'polygon' | 'props'>, ground: Ground, measured?: ReadonlyMap<Level, number>): Map<Level, number> {
  const g = buildingGround(b, ground);
  return new Map(buildingStack(b, measured).map((s) => [s.level, g + s.baseM]));
}

/** z of every point: outdoors on the ground, indoors on its floor (a little above, so it does not sink into the slab). */
export function nodeHeights(state: EditState, ground: Ground, measured: (buildingId: string) => ReadonlyMap<Level, number> = () => new Map()): Map<string, number> {
  const bases = new Map<string, Map<Level, number>>();
  for (const b of Object.values(state.buildings)) bases.set(b.id, floorBases(b, ground, measured(b.id)));
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

/** Light lines along every `every`-th row and column of the grid (z above its lowest point): the bend of a line shows the slope. */
export function terrainWire(grid: TerrainGrid, every: number): [number, number, number][][] {
  const base = terrainBase(grid);
  const vertex = (r: number, c: number): [number, number, number] | null => {
    const h = grid.z[r * grid.width + c];
    if (h === null || h === undefined) return null;
    const [lng, lat] = fromKorea2000(grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res);
    return [lng, lat, h - base + 0.05];
  };
  const lines: [number, number, number][][] = [];
  const flush = (run: [number, number, number][]) => {
    if (run.length > 1) lines.push(run);
  };
  for (let r = 0; r < grid.height; r += every) {
    let run: [number, number, number][] = [];
    for (let c = 0; c < grid.width; c++) {
      const v = vertex(r, c);
      if (v) run.push(v);
      else { flush(run); run = []; }
    }
    flush(run);
  }
  for (let c = 0; c < grid.width; c += every) {
    let run: [number, number, number][] = [];
    for (let r = 0; r < grid.height; r++) {
      const v = vertex(r, c);
      if (v) run.push(v);
      else { flush(run); run = []; }
    }
    flush(run);
  }
  return lines;
}
