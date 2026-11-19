// 지형 3D: the relief with the 평지 pressed under their planes, exactly (map/deck3d.ts draws it as `terrain-mesh`).
//
// The coarse grid (10 m on 한양대) is drawn as it is, except where GET /terrain sent tiles: there the coarse cell is drawn
// from its 1 m tile instead (server/terrain.ts terrainTiles). Then every vertex of every triangle that meets a footprint
// (a plaza's solid area: outer ring minus holes) is pressed to at most the footprint's z − CARVE_GAP_M. The mesh is one
// indexed mesh, so a vertex is pressed once for every triangle that uses it and neighbours never part (no cracks).
// Display only: nothing here changes the data or the solver's heights.
import type { Position } from '@campo/core';
import { coarseVertexXY } from './gridXY.ts';
import { fromKorea2000, groundOf, terrainBase, toKorea2000, type Ground, type PlazaFlat, type TerrainCell, type TerrainGrid } from './terrain3d.ts';

/** How far (display m, after 높이 과장) the relief stays under a footprint's plane. */
export const CARVE_GAP_M = 0.02;

/** A coarse cell split sub × sub as GET /terrain sends it (server/terrain.ts TerrainTileJson). */
export interface TerrainTile {
  r: number;
  c: number;
  sub: number;
  z: (number | null)[];
}

/** A footprint: rings in the plan (EPSG:5186 m; solid = even–odd over all of them) and the display z the relief must stay under. */
export interface Footprint {
  id: string;
  kind: 'plaza' | 'road';
  rings: [number, number][][];
  zCap: number;
}

export interface SurfaceMesh {
  /** The triangles to draw ([lng, lat, z], z as terrainMesh's: (height − the grid's lowest) × k, pressed). */
  cells: TerrainCell[];
  /** How many vertices were pressed, and by how much at most (display m). */
  lowered: number;
  maxLowerM: number;
  /** Coarse cells (row × width + col of the north-west vertex) not drawn from the coarse grid: skipped, or drawn from a tile. */
  skippedCells: ReadonlySet<number>;
  /** Coarse cells drawn from the coarse grid that meet a footprint (the wire should not run over them: they are pressed or under a plane). */
  carvedCells: ReadonlySet<number>;
}

/** Tiles that fit the grid, by coarse cell; a cell in `skip`, a second tile for a cell, or a malformed tile is left out. */
function tilesByCell(grid: TerrainGrid, tiles: readonly TerrainTile[], skip?: ReadonlySet<number>): Map<number, TerrainTile> {
  const out = new Map<number, TerrainTile>();
  for (const t of tiles) {
    const ok = Number.isInteger(t.r) && Number.isInteger(t.c) && Number.isInteger(t.sub) && t.sub >= 1 && t.sub <= 64
      && t.r >= 0 && t.c >= 0 && t.r < grid.height - 1 && t.c < grid.width - 1 && Array.isArray(t.z) && t.z.length === (t.sub + 1) ** 2;
    const q = t.r * grid.width + t.c;
    if (ok && !skip?.has(q) && !out.has(q)) out.set(q, t);
  }
  return out;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * How a tile's vertex (i, j) is made: a coarse corner, a vertex on an edge with no tile of the same sub beside it (the
 * straight line between the two corners of that edge, `t` along it), or a value of its own (inside, or on an edge shared
 * with a tile of the same sub).
 */
type TileVertex = { kind: 'corner'; r: number; c: number } | { kind: 'edge'; a: [number, number]; b: [number, number]; t: number } | { kind: 'own' };

function tileVertex(cells: ReadonlyMap<number, TerrainTile>, W: number, t: TerrainTile, i: number, j: number): TileVertex {
  const { r, c, sub } = t;
  const iEdge = i === 0 || i === sub;
  const jEdge = j === 0 || j === sub;
  if (iEdge && jEdge) return { kind: 'corner', r: r + i / sub, c: c + j / sub };
  const same = (q: number, ok: boolean) => ok && cells.get(q)?.sub === sub;
  const q = r * W + c;
  if (i === 0) return same(q - W, r > 0) ? { kind: 'own' } : { kind: 'edge', a: [r, c], b: [r, c + 1], t: j / sub };
  if (i === sub) return same(q + W, true) ? { kind: 'own' } : { kind: 'edge', a: [r + 1, c], b: [r + 1, c + 1], t: j / sub };
  if (j === 0) return same(q - 1, c > 0) ? { kind: 'own' } : { kind: 'edge', a: [r, c], b: [r + 1, c], t: i / sub };
  if (j === sub) return same(q + 1, true) ? { kind: 'own' } : { kind: 'edge', a: [r, c + 1], b: [r + 1, c + 1], t: i / sub };
  return { kind: 'own' };
}

// ---- footprints in the plan, with a 10 m hash of their edges ----

const HASH_M = 10;
/**
 * A triangle within this of a footprint's edge counts as meeting it (m): pressing one triangle too many is safe, one too few
 * is not. 1 mm: well over the ≈ 10 µm that EPSG:5186 → [lng, lat] → EPSG:5186 moves a point (korea2000.ts), so a triangle
 * that meets the plaza as drawn in [lng, lat] is pressed even if it misses it by that much in the plan.
 */
const TOUCH_M = 1e-3;

interface FootprintIndex {
  caps: number[];
  /** Edges: x0, y0, x1, y1 and the footprint, flat. */
  ex: number[];
  fp: number[];
  /** Edges per hash cell. */
  hash: Map<number, number[]>;
  /** Each footprint's edges and its box. */
  edges: number[][];
  box: [number, number, number, number][];
  all: [number, number, number, number];
}

const hashKey = (hx: number, hy: number) => hx * 1_048_576 + hy;

function indexFootprints(footprints: readonly Footprint[]): FootprintIndex {
  const idx: FootprintIndex = { caps: [], ex: [], fp: [], hash: new Map(), edges: [], box: [], all: [Infinity, Infinity, -Infinity, -Infinity] };
  for (const f of footprints) {
    if (!Number.isFinite(f.zCap)) continue;
    const k = idx.caps.length;
    const own: number[] = [];
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of f.rings) {
      for (let i = 0; i < ring.length; i++) {
        const [a, b] = [ring[i]!, ring[(i + 1) % ring.length]!];
        if (a[0] === b[0] && a[1] === b[1]) continue; // the closing point of a closed ring
        const e = idx.fp.length;
        idx.ex.push(a[0], a[1], b[0], b[1]);
        idx.fp.push(k);
        own.push(e);
        box[0] = Math.min(box[0], a[0], b[0]);
        box[1] = Math.min(box[1], a[1], b[1]);
        box[2] = Math.max(box[2], a[0], b[0]);
        box[3] = Math.max(box[3], a[1], b[1]);
        for (let hx = Math.floor((Math.min(a[0], b[0]) - TOUCH_M) / HASH_M); hx <= Math.floor((Math.max(a[0], b[0]) + TOUCH_M) / HASH_M); hx++) {
          for (let hy = Math.floor((Math.min(a[1], b[1]) - TOUCH_M) / HASH_M); hy <= Math.floor((Math.max(a[1], b[1]) + TOUCH_M) / HASH_M); hy++) {
            const list = idx.hash.get(hashKey(hx, hy));
            if (list) list.push(e);
            else idx.hash.set(hashKey(hx, hy), [e]);
          }
        }
      }
    }
    if (own.length === 0) continue;
    idx.caps.push(f.zCap - CARVE_GAP_M);
    idx.edges.push(own);
    idx.box.push(box);
    idx.all = [Math.min(idx.all[0], box[0]), Math.min(idx.all[1], box[1]), Math.max(idx.all[2], box[2]), Math.max(idx.all[3], box[3])];
  }
  return idx;
}

/** Squared distance from p to the segment a–b. */
function dist2PS(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const [qx, qy] = [ax + t * dx - px, ay + t * dy - py];
  return qx * qx + qy * qy;
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Are two segments within TOUCH_M of each other (crossing, touching or overlapping)? */
function segsMeet(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const [o1, o2, o3, o4] = [orient(ax, ay, bx, by, cx, cy), orient(ax, ay, bx, by, dx, dy), orient(cx, cy, dx, dy, ax, ay), orient(cx, cy, dx, dy, bx, by)];
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  // Not crossing: their distance is at an end of one of them.
  const t2 = TOUCH_M * TOUCH_M;
  return dist2PS(ax, ay, cx, cy, dx, dy) <= t2 || dist2PS(bx, by, cx, cy, dx, dy) <= t2 || dist2PS(cx, cy, ax, ay, bx, by) <= t2 || dist2PS(dx, dy, ax, ay, bx, by) <= t2;
}

/** Is p in the triangle (edges included)? */
function inTriangle(px: number, py: number, t: number[]): boolean {
  const d1 = orient(t[0]!, t[1]!, t[2]!, t[3]!, px, py);
  const d2 = orient(t[2]!, t[3]!, t[4]!, t[5]!, px, py);
  const d3 = orient(t[4]!, t[5]!, t[0]!, t[1]!, px, py);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
}

/** Does the segment (one of a footprint's edges) meet the triangle: an end inside it, or crossing or touching a side? */
function segMeetsTriangle(ax: number, ay: number, bx: number, by: number, t: number[]): boolean {
  if (inTriangle(ax, ay, t) || inTriangle(bx, by, t)) return true;
  return segsMeet(ax, ay, bx, by, t[0]!, t[1]!, t[2]!, t[3]!) || segsMeet(ax, ay, bx, by, t[2]!, t[3]!, t[4]!, t[5]!)
    || segsMeet(ax, ay, bx, by, t[4]!, t[5]!, t[0]!, t[1]!);
}

/** Even–odd: is (px, py) inside footprint k's solid area? */
function inSolid(idx: FootprintIndex, k: number, px: number, py: number): boolean {
  let inside = false;
  for (const e of idx.edges[k]!) {
    const [ax, ay, bx, by] = [idx.ex[4 * e]!, idx.ex[4 * e + 1]!, idx.ex[4 * e + 2]!, idx.ex[4 * e + 3]!];
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

// ---- the surface ----

/**
 * The relief as triangles, drawn from the coarse grid and, where `tiles` cover a coarse cell, from the tile instead; every
 * vertex of every triangle that meets a footprint pressed to min(z, zCap − CARVE_GAP_M) (the lowest cap when several do).
 * `k`: 높이 과장. `skip`: coarse cells left out (walls, terrainMesh's `skip`). Without tiles and footprints the cells are
 * terrainMesh(grid, 1, k, skip)'s, vertex for vertex.
 *
 * Why the relief is never above a footprint (I5): the mesh is piecewise linear, so a point of a triangle is a convex
 * combination of its three corners and is no higher than the highest of them. Every triangle that meets the footprint has
 * all three corners at or under zCap − gap, so every point of it is too; and every point of the footprint lies in some
 * triangle, which then meets the footprint. A tile vertex on an edge with no tile beside it stays on the straight line
 * between the edge's two coarse corners (that is what keeps it sewn to the coarse triangle beside it): when it must go
 * down, those two corners go down to its cap as well, so the line is under the cap too. "Meets" is tested in the plan with
 * a 1 mm tolerance (a triangle that only touches a ring, or comes within 1 mm of it, is pressed as well; TOUCH_M).
 *
 * Limits: the test is in the plan (EPSG:5186 m), while deck.gl draws [lng, lat] (the straight edge of a 50 m plaza bows by
 * well under a millimetre between the two). Where the grid has no data no triangle is drawn, so there is nothing to bury.
 * Without a tile (an older server, a plaza drawn after the solve, the budget spent) the coarse triangles are pressed: the
 * guarantee holds, but the hollow reaches up to a coarse cell past the edge. Walls' sections (wallMesh) are not pressed.
 */
export function terrainSurface(
  grid: TerrainGrid, tiles: readonly TerrainTile[], k: number, footprints: readonly Footprint[], skip?: ReadonlySet<number>,
): SurfaceMesh {
  const base = terrainBase(grid);
  const W = grid.width;
  const cells = tilesByCell(grid, tiles, skip);
  // A lattice fine enough for every tile: a vertex is keyed by its place on it, so tiles and coarse cells share vertices.
  let D = 1;
  for (const t of cells.values()) {
    const next = (D * t.sub) / gcd(D, t.sub);
    if (next <= 240) D = next;
    else cells.delete(t.r * W + t.c);
  }
  const span = W * D + 1;

  // Vertices: plan position, height (display m; NaN without data), and for an edge vertex its two corners and t.
  const px: number[] = [];
  const py: number[] = [];
  const z0: number[] = [];
  const dep: { v: number; a: number; b: number; t: number }[] = [];
  const index = new Map<number, number>();
  const coarseZ = (r: number, c: number) => {
    const h = grid.z[r * W + c];
    return h === null || h === undefined ? NaN : (h - base) * k;
  };
  const coarseVertex = (r: number, c: number): number => {
    const key = r * D * span + c * D;
    let v = index.get(key);
    if (v === undefined) {
      v = px.length;
      const [x, y] = coarseVertexXY(grid, r, c);
      px.push(x);
      py.push(y);
      z0.push(coarseZ(r, c));
      index.set(key, v);
    }
    return v;
  };

  const tris: number[] = [];
  const triCell: number[] = [];
  const skipped = new Set<number>();
  for (let r = 0; r + 1 < grid.height; r++) {
    for (let c = 0; c + 1 < W; c++) {
      const q = r * W + c;
      if (skip?.has(q)) {
        skipped.add(q);
        continue;
      }
      const t = cells.get(q);
      if (!t) {
        const [a, b, d, e] = [coarseVertex(r, c), coarseVertex(r, c + 1), coarseVertex(r + 1, c), coarseVertex(r + 1, c + 1)];
        tris.push(a, b, e, a, e, d);
        triCell.push(q, q);
        continue;
      }
      skipped.add(q);
      const n = t.sub + 1;
      const s = D / t.sub;
      const ids: number[] = new Array(n * n);
      for (let i = 0; i <= t.sub; i++) {
        for (let j = 0; j <= t.sub; j++) {
          const how = tileVertex(cells, W, t, i, j);
          if (how.kind === 'corner') {
            ids[i * n + j] = coarseVertex(how.r, how.c);
            continue;
          }
          const key = (r * D + i * s) * span + c * D + j * s;
          let v = index.get(key);
          if (v === undefined) {
            // An edge vertex's corners first (they may be new vertices themselves), then the vertex.
            const [a, b] = how.kind === 'edge' ? [coarseVertex(how.a[0], how.a[1]), coarseVertex(how.b[0], how.b[1])] : [-1, -1];
            v = px.length;
            const [x, y] = coarseVertexXY(grid, r + i / t.sub, c + j / t.sub);
            px.push(x);
            py.push(y);
            if (how.kind === 'edge') {
              z0.push(z0[a]! + (z0[b]! - z0[a]!) * how.t);
              dep.push({ v, a, b, t: how.t });
            } else {
              const h = t.z[i * n + j];
              z0.push(h === null || h === undefined || !Number.isFinite(h) ? NaN : (h - base) * k);
            }
            index.set(key, v);
          }
          ids[i * n + j] = v;
        }
      }
      for (let i = 0; i < t.sub; i++) {
        for (let j = 0; j < t.sub; j++) {
          const [a, b, d, e] = [ids[i * n + j]!, ids[i * n + j + 1]!, ids[(i + 1) * n + j]!, ids[(i + 1) * n + j + 1]!];
          tris.push(a, b, e, a, e, d);
          triCell.push(q, q);
        }
      }
    }
  }

  // The carve: the lowest cap of the footprints each vertex's triangles meet.
  const cap = new Float64Array(px.length).fill(Infinity);
  const carved = new Set<number>();
  const idx = indexFootprints(footprints);
  if (idx.caps.length > 0) {
    const seen = new Int32Array(idx.fp.length).fill(-1);
    const meets = new Uint8Array(idx.caps.length);
    const tri = [0, 0, 0, 0, 0, 0];
    for (let m = 0; m < tris.length; m += 3) {
      const [a, b, c] = [tris[m]!, tris[m + 1]!, tris[m + 2]!];
      if (Number.isNaN(z0[a]!) || Number.isNaN(z0[b]!) || Number.isNaN(z0[c]!)) continue; // not drawn
      tri[0] = px[a]!; tri[1] = py[a]!; tri[2] = px[b]!; tri[3] = py[b]!; tri[4] = px[c]!; tri[5] = py[c]!;
      const x0 = Math.min(tri[0], tri[2], tri[4]) - TOUCH_M;
      const x1 = Math.max(tri[0], tri[2], tri[4]) + TOUCH_M;
      const y0 = Math.min(tri[1], tri[3], tri[5]) - TOUCH_M;
      const y1 = Math.max(tri[1], tri[3], tri[5]) + TOUCH_M;
      if (x1 < idx.all[0] || x0 > idx.all[2] || y1 < idx.all[1] || y0 > idx.all[3]) continue;
      meets.fill(0);
      // A footprint edge near the triangle: does it meet it?
      for (let hx = Math.floor(x0 / HASH_M); hx <= Math.floor(x1 / HASH_M); hx++) {
        for (let hy = Math.floor(y0 / HASH_M); hy <= Math.floor(y1 / HASH_M); hy++) {
          for (const e of idx.hash.get(hashKey(hx, hy)) ?? []) {
            if (seen[e] === m) continue;
            seen[e] = m;
            const f = idx.fp[e]!;
            if (meets[f] === 1) continue;
            if (segMeetsTriangle(idx.ex[4 * e]!, idx.ex[4 * e + 1]!, idx.ex[4 * e + 2]!, idx.ex[4 * e + 3]!, tri)) meets[f] = 1;
            else meets[f] = 2; // near, but no edge of it meets the triangle yet
          }
        }
      }
      let lim = Infinity;
      for (let f = 0; f < idx.caps.length; f++) {
        if (meets[f] !== 1) {
          // No edge of f meets the triangle: the triangle is wholly inside f's solid area or wholly outside it.
          const bx = idx.box[f]!;
          if (x1 < bx[0] || x0 > bx[2] || y1 < bx[1] || y0 > bx[3]) continue;
          if (!inSolid(idx, f, tri[0], tri[1])) continue;
        }
        lim = Math.min(lim, idx.caps[f]!);
      }
      if (lim === Infinity) continue;
      const q = triCell[m / 3]!;
      if (!skipped.has(q)) carved.add(q);
      if (lim < cap[a]!) cap[a] = lim;
      if (lim < cap[b]!) cap[b] = lim;
      if (lim < cap[c]!) cap[c] = lim;
    }
    // An edge vertex that must go down takes its two corners down with it, so it stays on the line between them.
    for (const d of dep) {
      const lim = cap[d.v]!;
      if (lim === Infinity) continue;
      if (lim < cap[d.a]!) cap[d.a] = lim;
      if (lim < cap[d.b]!) cap[d.b] = lim;
    }
  }
  const z = z0.map((h, v) => (h > cap[v]! ? cap[v]! : h));
  for (const d of dep) z[d.v] = z[d.a]! + (z[d.b]! - z[d.a]!) * d.t;

  let lowered = 0;
  let maxLowerM = 0;
  for (let v = 0; v < z.length; v++) {
    if (z[v]! < z0[v]!) {
      lowered++;
      maxLowerM = Math.max(maxLowerM, z0[v]! - z[v]!);
    }
  }
  // Drawn: every triangle with all three corners (a vertex's [lng, lat, z] made once and shared by its triangles).
  const out: TerrainCell[] = [];
  const at: ([number, number, number] | undefined)[] = new Array(z.length);
  const point = (v: number): [number, number, number] => {
    let p = at[v];
    if (!p) {
      const [lng, lat] = fromKorea2000(px[v]!, py[v]!);
      p = [lng, lat, z[v]!];
      at[v] = p;
    }
    return p;
  };
  for (let m = 0; m < tris.length; m += 3) {
    const [a, b, c] = [tris[m]!, tris[m + 1]!, tris[m + 2]!];
    if (Number.isNaN(z[a]!) || Number.isNaN(z[b]!) || Number.isNaN(z[c]!)) continue;
    const polygon = [point(a), point(b), point(c)];
    out.push({ polygon, z: (polygon[0]![2] + polygon[1]![2] + polygon[2]![2]) / 3 });
  }
  return { cells: out, lowered, maxLowerM, skippedCells: skipped, carvedCells: carved };
}

/**
 * The ground from the tiles where there are some, the coarse relief elsewhere (z above the grid's lowest point, × k): for
 * the plaza's skirt, picking and draping. Inside a tiled cell it is bilinear between the tile's four vertices round the point
 * (an edge vertex with no tile beside it on the line between the coarse corners, as the mesh has it); not pressed.
 * 0 without a grid, the coarse relief (groundOf) where a tile has no data.
 */
export function fineGround(grid: TerrainGrid | null, tiles: readonly TerrainTile[], k: number): Ground {
  const coarse = groundOf(grid, k);
  if (!grid || tiles.length === 0) return coarse;
  const W = grid.width;
  const cells = tilesByCell(grid, tiles);
  if (cells.size === 0) return coarse;
  const base = terrainBase(grid);
  // Each tile's heights as the mesh draws them (corners from the coarse grid, unshared edges on the line between them).
  const heights = new Map<number, (number | null)[]>();
  const coarseAt = (r: number, c: number) => grid.z[r * W + c] ?? null;
  const heightsOf = (q: number, t: TerrainTile): (number | null)[] => {
    let hs = heights.get(q);
    if (hs) return hs;
    const n = t.sub + 1;
    hs = new Array(n * n);
    for (let i = 0; i <= t.sub; i++) {
      for (let j = 0; j <= t.sub; j++) {
        const how = tileVertex(cells, W, t, i, j);
        if (how.kind === 'corner') hs[i * n + j] = coarseAt(how.r, how.c);
        else if (how.kind === 'edge') {
          const [a, b] = [coarseAt(how.a[0], how.a[1]), coarseAt(how.b[0], how.b[1])];
          hs[i * n + j] = a === null || b === null ? null : a + (b - a) * how.t;
        } else hs[i * n + j] = t.z[i * n + j] ?? null;
      }
    }
    heights.set(q, hs);
    return hs;
  };
  return (p: Position) => {
    const [x, y] = toKorea2000(p);
    const fc = (x - grid.originX) / grid.res - 0.5;
    const fr = (grid.originY - y) / grid.res - 0.5;
    const [r, c] = [Math.floor(fr), Math.floor(fc)];
    const t = r >= 0 && c >= 0 ? cells.get(r * W + c) : undefined;
    if (!t || t.r !== r || t.c !== c) return coarse(p);
    const hs = heightsOf(r * W + c, t);
    const n = t.sub + 1;
    const [u, v] = [(fc - c) * t.sub, (fr - r) * t.sub];
    const j = Math.min(Math.max(Math.floor(u), 0), t.sub - 1);
    const i = Math.min(Math.max(Math.floor(v), 0), t.sub - 1);
    const [fu, fv] = [u - j, v - i];
    const q = [hs[i * n + j], hs[i * n + j + 1], hs[(i + 1) * n + j], hs[(i + 1) * n + j + 1]];
    if (q.some((h) => h === null || h === undefined)) return coarse(p);
    const [a, b, d, e] = q as number[];
    const h = a! * (1 - fu) * (1 - fv) + b! * fu * (1 - fv) + d! * (1 - fu) * fv + e! * fu * fv;
    return (h - base) * k;
  };
}

/** The plazas as footprints: their rings in the plan, their planes as the caps. */
export function plazaFootprints(flats: readonly PlazaFlat[]): Footprint[] {
  return flats.filter((f) => f.rings.length > 0).map((f) => ({
    id: f.id, kind: 'plaza' as const, rings: f.rings.map((ring) => ring.map((p) => toKorea2000(p))), zCap: f.z,
  }));
}
