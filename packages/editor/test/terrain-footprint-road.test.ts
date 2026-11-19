// 길 in 지형 3D, the exact way: the solver's corridors (solve_report roads[]) read by the server (server/terrain.ts
// roadsFromReport, roadTileAreas: 2 m tiles round every road), the ribbon's pieces as footprints (model/roadRibbon.ts
// footprintsOfRoads) pressing the relief under the ribbon (I5 for roads), and the skirt on the fill side (ribbonSkirt).
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Position } from '@campo/core';
import {
  PLAZA_TILE_RES_M, ROAD_TILE_MARGIN_M, ROAD_TILE_RES_M, TILE_MAX_TRIANGLES, coarseVertexXY, readTerrain, roadTileAreas, roadsFromReport,
  sampleGridValues, terrainTiles, type TerrainTileJson, type TileArea,
} from '../server/terrain.ts';
import { fromKorea2000, terrainBase, toKorea2000, type TerrainCell } from '../src/model/terrain3d.ts';
import { CARVE_GAP_M, fineGround, terrainSurface } from '../src/model/terrainFootprint.ts';
import { footprintsOfRoads, ribbonSkirt, roadPieces, type RibbonPiece, type RoadSegmentJson } from '../src/model/roadRibbon.ts';
import { manyRoads, road } from './roadSynth.ts';
import { META, OX, OY, bboxXY, coarseOf, rawGrid, rng } from './terrainSynth.ts';

type XY = [number, number];
type Seg = RoadSegmentJson['segments'][number];
const triangles = (tiles: readonly TerrainTileJson[]) => tiles.reduce((s, t) => s + 2 * t.sub * t.sub, 0);

// ---- helpers, written apart from the code under test ----

function inPolygon(poly: readonly XY[], p: XY): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i]!, poly[j]!];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** The drawn mesh in the plan: z at a point = the linear interpolation over the triangle that holds it best. */
function meshIndex(cells: readonly TerrainCell[]) {
  const B = 2;
  const tris = cells.map((c) => c.polygon.map(([lng, lat, z]) => [...toKorea2000([lng, lat]), z] as [number, number, number]));
  const buckets = new Map<string, number[]>();
  tris.forEach((t, i) => {
    const xs = t.map((v) => v[0]);
    const ys = t.map((v) => v[1]);
    for (let bx = Math.floor(Math.min(...xs) / B); bx <= Math.floor(Math.max(...xs) / B); bx++) {
      for (let by = Math.floor(Math.min(...ys) / B); by <= Math.floor(Math.max(...ys) / B); by++) {
        const k = `${bx},${by}`;
        const list = buckets.get(k);
        if (list) list.push(i);
        else buckets.set(k, [i]);
      }
    }
  });
  return (p: XY): number | null => {
    let best: { w: number; z: number } | null = null;
    for (const i of buckets.get(`${Math.floor(p[0] / B)},${Math.floor(p[1] / B)}`) ?? []) {
      const [a, b, c] = tris[i]!;
      const det = (b![1] - c![1]) * (a![0] - c![0]) + (c![0] - b![0]) * (a![1] - c![1]);
      if (det === 0) continue;
      const l1 = ((b![1] - c![1]) * (p[0] - c![0]) + (c![0] - b![0]) * (p[1] - c![1])) / det;
      const l2 = ((c![1] - a![1]) * (p[0] - c![0]) + (a![0] - c![0]) * (p[1] - c![1])) / det;
      const l3 = 1 - l1 - l2;
      const w = Math.min(l1, l2, l3);
      if (w < -1e-9 || (best && best.w >= w)) continue;
      best = { w, z: l1 * a![2] + l2 * b![2] + l3 * c![2] };
    }
    return best ? best.z : null;
  };
}

/** A curved road through grid metres (x east, y south of the synthetic grid's corner), 7 m segments, heights from `zAt`. */
function bentRoad(zAt: (x: number, y: number) => number, width = 2): RoadSegmentJson {
  const pts: XY[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (-0.4 + (i / 14) * 1.9) * Math.PI / 2;
    pts.push([OX + 300 + 55 * Math.cos(a) + 0.37, OY - 300 - 55 * Math.sin(a) - 0.21]);
  }
  const segments: Seg[] = pts.slice(1).map((b, i) => {
    const a = pts[i]!;
    return [a[0], a[1], zAt(a[0], a[1]), b[0], b[1], zAt(b[0], b[1])];
  });
  return road('bend', width, segments);
}

/** Points on the ribbon's plan: random points in random pieces (rejection in each piece's box), and on their edges. */
function ribbonPoints(pieces: readonly RibbonPiece[], n: number, seed = 13): { p: XY; holders: RibbonPiece[] }[] {
  const rand = rng(seed);
  const out: { p: XY; holders: RibbonPiece[] }[] = [];
  while (out.length < n) {
    const pc = pieces[Math.floor(rand() * pieces.length)]!;
    const xs = pc.plan.map((q) => q[0]);
    const ys = pc.plan.map((q) => q[1]);
    const p: XY = [Math.min(...xs) + rand() * (Math.max(...xs) - Math.min(...xs)), Math.min(...ys) + rand() * (Math.max(...ys) - Math.min(...ys))];
    if (!inPolygon(pc.plan, p)) continue;
    out.push({ p, holders: pieces.filter((q) => inPolygon(q.plan, p)) });
  }
  return out;
}

// ---- server: roads from the report, tiles round them ----

describe('roadsFromReport', () => {
  const good = { id: 'e1', width_m: 2, segments: [[203000.1, 551000.2, 30, 203010.3, 551005.4, 31]] };
  it('the report\'s roads as they are', () => {
    expect(roadsFromReport(JSON.stringify({ format: 'campo-solve-report/1', roads: [good] }))).toEqual([good]);
  });
  it('no report, a broken one, no roads, or roads not an array: []', () => {
    for (const t of [null, '{ broken', '{}', '{"roads": 3}', '{"roads": null}', 'null', '[]']) expect(roadsFromReport(t)).toEqual([]);
  });
  it('a row without an id, a positive finite width or a list of segments is left out; so is a segment that is not 6 finite numbers', () => {
    const rows = [
      good, { width_m: 2, segments: good.segments }, { id: 'w0', width_m: 0, segments: good.segments }, { id: 'wn', width_m: 'x', segments: good.segments },
      { id: 'ns', width_m: 2 }, { id: 'bad', width_m: 3, segments: [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5, null], [1, 2, 3, 4, 5, 6], 'x'] },
      { id: 'none', width_m: 3, segments: [[1, 2, 3]] }, null,
    ];
    expect(roadsFromReport(JSON.stringify({ roads: rows }))).toEqual([good, { id: 'bad', width_m: 3, segments: [[1, 2, 3, 4, 5, 6]] }]);
  });
});

describe('roadTileAreas', () => {
  it('one area a road: each segment\'s box grown by half its width + 3 m (the length way too), the length of the road', () => {
    expect(ROAD_TILE_MARGIN_M).toBe(3);
    expect(ROAD_TILE_RES_M).toBe(2);
    const r = road('r', 4, [[100, 200, 30, 130, 200, 31], [130, 200, 31, 130, 240, 33]]);
    const [a] = roadTileAreas([r]);
    expect(a).toEqual({
      kind: 'road', id: 'r', box: [100 - 5, 200 - 5, 130 + 5, 240 + 5], lengthM: 70,
      boxes: [[95, 195, 135, 205], [125, 195, 135, 245]],
    });
    expect(roadTileAreas([])).toEqual([]);
  });
});

describe('road tiles', () => {
  const { bytes, g } = rawGrid();
  const coarse = coarseOf(bytes);
  // An L-shaped road (grid metres → EPSG:5186): east 200 m, then south 200 m.
  const L: RoadSegmentJson = road('L', 2, [[OX + 100.3, OY - 100.6, 50, OX + 300.3, OY - 100.6, 55], [OX + 300.3, OY - 100.6, 55, OX + 300.3, OY - 300.6, 60]]);
  const quadsOf = (tiles: readonly TerrainTileJson[]) => new Set(tiles.map((t) => t.r * coarse.width + t.c));

  it('2 m tiles (sub = ceil(10 m / 2 m) = 5) on the coarse cells the grown segment boxes meet, not the whole box', () => {
    const tiles = terrainTiles(g, coarse, roadTileAreas([L]));
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.sub).toBe(Math.ceil(coarse.res / ROAD_TILE_RES_M));
      expect(t.sub).toBe(5);
      expect(t.z).toHaveLength(36);
    }
    // the corner of the L's box away from the road (south-west) has no tile
    const far = toQuad(coarse, OX + 150, OY - 250);
    expect(quadsOf(tiles).has(far)).toBe(false);
    // every cell a grown segment box meets is tiled
    for (const [x0, y0, x1, y1] of roadTileAreas([L])[0]!.boxes!) {
      for (let r = 0; r + 1 < coarse.height; r++) {
        for (let c = 0; c + 1 < coarse.width; c++) {
          const [ax, ay] = coarseVertexXY(coarse, r, c);
          const [bx, by] = coarseVertexXY(coarse, r + 1, c + 1);
          if (bx >= x0 && ax <= x1 && ay >= y0 && by <= y1) expect(quadsOf(tiles).has(r * coarse.width + c)).toBe(true);
        }
      }
    }
    // inside, the full grid read at the point (to the mm)
    const t = tiles[3]!;
    const [x, y] = coarseVertexXY(coarse, t.r + 2 / 5, t.c + 3 / 5);
    expect(t.z[2 * 6 + 3]).toBeCloseTo(Math.round(sampleGridValues(g, x, y)! * 1000) / 1000, 9);
  });

  it('a cell under a plaza and a road takes the plaza\'s 1 m tile; tiles of different sizes meet on the straight coarse edge', () => {
    const plaza: TileArea = { kind: 'plaza', id: 'P', box: bboxXY([[280, 90], [320, 90], [320, 130], [280, 130]]) };
    const tiles = terrainTiles(g, coarse, [...roadTileAreas([L]), plaza]);
    const bySub = new Map<number, number>();
    for (const t of tiles) bySub.set(t.sub, (bySub.get(t.sub) ?? 0) + 1);
    expect(bySub.get(10)).toBeGreaterThan(0);
    expect(bySub.get(5)).toBeGreaterThan(0);
    const corner = tiles.find((t) => t.r * coarse.width + t.c === toQuad(coarse, OX + 300.3, OY - 100.6))!;
    expect(corner.sub).toBe(Math.ceil(coarse.res / PLAZA_TILE_RES_M));
    // In the drawn mesh: one z per point, and a tile edge with no tile of its own size beside it on the coarse edge.
    const s = terrainSurface(coarse, tiles, 1, []);
    const zOf = new Map<string, number>();
    for (const c of s.cells) {
      for (const [lng, lat, z] of c.polygon) {
        const key = `${lng},${lat}`;
        const seen = zOf.get(key);
        if (seen !== undefined) expect(z).toBe(seen);
        else zOf.set(key, z);
      }
    }
    const subOf = new Map(tiles.map((t) => [t.r * coarse.width + t.c, t.sub]));
    const keyAt = (r: number, c: number) => fromKorea2000(...coarseVertexXY(coarse, r, c)).join(',');
    let mixed = 0;
    for (const t of tiles) {
      const sides: [number, number, (q: number) => [number, number]][] = [
        [-1, 0, (q) => [t.r, t.c + q]], [1, 0, (q) => [t.r + 1, t.c + q]], [0, -1, (q) => [t.r + q, t.c]], [0, 1, (q) => [t.r + q, t.c + 1]],
      ];
      for (const [dr, dc, at] of sides) {
        const other = subOf.get((t.r + dr) * coarse.width + t.c + dc);
        if (other === t.sub) continue;
        if (other !== undefined) mixed++;
        const [z0, z1] = [zOf.get(keyAt(...at(0)))!, zOf.get(keyAt(...at(1)))!];
        for (let q = 1; q < t.sub; q++) {
          const z = zOf.get(keyAt(...at(q / t.sub)));
          expect(z).toBeDefined();
          expect(Math.abs(z! - (z0 + (z1 - z0) * (q / t.sub)))).toBeLessThanOrEqual(1e-9);
        }
      }
    }
    expect(mixed).toBeGreaterThan(0);
  });

  it('budget: the plazas first, then the roads longest first, until one does not fit', () => {
    const short = road('short', 2, [[OX + 450.3, OY - 450.6, 50, OX + 480.3, OY - 450.6, 50]]);
    const areas = roadTileAreas([short, L]);
    const each = (a: TileArea) => triangles(terrainTiles(g, coarse, [a]));
    const [nShort, nL] = [each(areas[0]!), each(areas[1]!)];
    expect(nL).toBeGreaterThan(nShort);
    // Room for the long road only: it is tiled, and the short one (after it) is not.
    const only = terrainTiles(g, coarse, areas, { maxTriangles: nL + nShort - 1 });
    expect(triangles(only)).toBe(nL);
    // A plaza takes its room first, even given last.
    const plaza: TileArea = { kind: 'plaza', id: 'P', box: bboxXY([[400, 300], [440, 300], [440, 340], [400, 340]]) };
    const nP = each(plaza);
    const withPlaza = terrainTiles(g, coarse, [...areas, plaza], { maxTriangles: nP + nShort });
    expect(triangles(withPlaza)).toBe(nP); // the long road does not fit; the roads stop there (the short one is not tried)
    expect(triangles(terrainTiles(g, coarse, [...areas, plaza]))).toBe(nP + nL + nShort);
    expect(triangles(terrainTiles(g, coarse, roadTileAreas(manyRoads(3, OX - 400, OY + 300))))).toBeLessThanOrEqual(TILE_MAX_TRIANGLES);
  });

  it('readTerrain: roads from the report, and their tiles with the plazas\'; no roads key: roads [] and the plaza tiles alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'campo-roads-'));
    try {
      const json = join(dir, 'corrected_dem.json');
      await writeFile(json, JSON.stringify({ ...META, format: 'campo-grid/1', bin: 'corrected_dem.bin' }));
      await writeFile(join(dir, 'corrected_dem.bin'), bytes);
      const t = await readTerrain(json, 'corrected', null, 60, JSON.stringify({ roads: [L] }));
      expect(t.roads).toEqual([L]);
      expect(t.tiles).toEqual(terrainTiles(g, t.grid, roadTileAreas([L])));
      expect(t.tiles.length).toBeGreaterThan(0);
      for (const text of [null, '{ broken', JSON.stringify({ plazas: [] })]) {
        const u = await readTerrain(json, 'corrected', null, 60, text);
        expect(u.roads).toEqual([]);
        expect(u.tiles).toEqual([]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function toQuad(coarse: ReturnType<typeof coarseOf>, x: number, y: number): number {
  const c = Math.floor((x - coarse.originX) / coarse.res - 0.5);
  const r = Math.floor((coarse.originY - y) / coarse.res - 0.5);
  return r * coarse.width + c;
}

// ---- I5 for roads ----

describe('carve keeps terrain under the ribbon (I5, roads)', () => {
  const cases = [-0.5, 0.5].flatMap((offset) => [0.5, 1, 2.5].map((k) => ({ offset, k })));
  it.each(cases)('road $offset m off the ground (− cut, + fill), 높이 과장 $k: the relief ≤ every piece\'s zMin − 2 cm', ({ offset, k }) => {
    const { bytes, g } = rawGrid(0.3, [300, 300]);
    const grid = coarseOf(bytes);
    const r = bentRoad((x, y) => sampleGridValues(g, x, y)! + offset);
    const base = terrainBase(grid);
    for (const tiles of [terrainTiles(g, grid, roadTileAreas([r])), []]) {
      const pieces = roadPieces([r], base, k);
      const fps = footprintsOfRoads(pieces);
      expect(fps).toHaveLength(pieces.length);
      expect(fps.every((f, i) => f.kind === 'road' && f.zCap === pieces[i]!.zMin && f.rings[0] === pieces[i]!.plan)).toBe(true);
      const s = terrainSurface(grid, tiles, k, fps);
      const zAt = meshIndex(s.cells);
      const pts = ribbonPoints(pieces, tiles.length > 0 ? 20_000 : 4_000);
      const bad: string[] = [];
      for (const { p, holders } of pts) {
        const z = zAt(p);
        expect(z).not.toBeNull();
        const lim = Math.min(...holders.map((h) => h.zMin)) - CARVE_GAP_M + 1e-9;
        if (z! > lim) bad.push(`${p[0].toFixed(3)},${p[1].toFixed(3)}: ${z} > ${lim}`);
      }
      expect(bad.slice(0, 5)).toEqual([]);
      if (offset < 0) expect(s.lowered).toBeGreaterThan(0);
    }
  });
});

describe('fill side gets a skirt, cut side does not', () => {
  it('a road on ground 0.3 m higher on its left and 0.5 m lower on its right: skirts on the right only, foot at the ground − 0.2 m', () => {
    // East along y = HY in the plan, z = 10 (display m: base 0, k 1). Left (north, y > HY) is a cut, right (south) a fill.
    const [HX, HY] = [203_950.37, 550_800.21];
    const r = road('r', 2, [[HX, HY, 10, HX + 9, HY, 10], [HX + 9, HY, 10, HX + 20, HY, 10]]);
    const ground = (p: Position) => {
      const [, y] = toKorea2000(p);
      return y > HY + 1e-6 ? 10.3 : 9.5;
    };
    const pieces = roadPieces([r], 0, 1);
    const skirts = ribbonSkirt(pieces, ground);
    expect(skirts.length).toBeGreaterThanOrEqual(pieces.filter((p) => p.kind === 'strip').length - 1);
    for (const q of skirts) {
      expect(q.polygon).toHaveLength(4);
      const [a, b] = [toKorea2000([q.polygon[0]![0], q.polygon[0]![1]]), toKorea2000([q.polygon[1]![0], q.polygon[1]![1]])];
      // its top on the ribbon's edge, south of the axis, its foot at the ground − 0.2
      expect(q.polygon[0]![2]).toBeCloseTo(10, 12);
      expect(q.polygon[1]![2]).toBeCloseTo(10, 12);
      expect((a[1] + b[1]) / 2).toBeLessThan(HY + 1e-6);
      expect(q.polygon[2]![2]).toBeCloseTo(9.5 - 0.2, 12);
      expect(q.polygon[3]![2]).toBeCloseTo(9.5 - 0.2, 12);
    }
    // The ground higher all round (a cut): no skirt; lower all round (a fill): skirts on both sides.
    expect(ribbonSkirt(pieces, () => 10.4)).toEqual([]);
    const both = ribbonSkirt(pieces, () => 9);
    expect(both.length).toBeGreaterThan(skirts.length);
    expect(both.every((q) => Math.abs(q.polygon[2]![2] - 8.8) < 1e-12)).toBe(true);
  });
});

// ---- time and size on a 한양대-sized grid ----

describe('roads on a 한양대-sized grid (1464 × 1092 at 1 m)', () => {
  it('139 roads: /terrain adds ≤ 800 ms (target 300 ms), the answer ≤ 12 MB; the carve with every piece ≤ 1,500 ms (target 500 ms)', async () => {
    const [w, h] = [1464, 1092];
    const f = new Float32Array(w * h);
    const rand = rng(5);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) f[r * w + c] = 30 + 0.04 * c + 0.03 * r + rand() * 0.3;
    const meta = { ...META, width: w, height: h, format: 'campo-grid/1', bin: 'corrected_dem.bin' };
    const dir = await mkdtemp(join(tmpdir(), 'campo-roads-big-'));
    try {
      const json = join(dir, 'corrected_dem.json');
      await writeFile(json, JSON.stringify(meta));
      await writeFile(join(dir, 'corrected_dem.bin'), new Uint8Array(f.buffer));
      // Longer roads than manyRoads' (whose segments are 1–2 m): each segment stretched × 6, ≈ 15 km in all.
      const roads = manyRoads(3, OX, OY).map((r) => {
        let [x, y] = [r.segments[0]![0], r.segments[0]![1]];
        return { ...r, segments: r.segments.map(([x0, y0, z0, x1, y1, z1]): Seg => {
          const [nx, ny] = [x + (x1 - x0) * 6, y + (y1 - y0) * 6];
          const s: Seg = [x, y, 30 + 0.04 * (x - OX) + 0.03 * (OY - y) + (z0 - 55) * 0.01, nx, ny, 30 + 0.04 * (nx - OX) + 0.03 * (OY - ny) + (z1 - 55) * 0.01];
          [x, y] = [nx, ny];
          return s;
        }) };
      }).map((r) => ({ ...r, segments: r.segments.filter((s) => s.every(Number.isFinite)) }));
      const report = JSON.stringify({ roads });
      await readTerrain(json, 'corrected', null, 160, report); // warm-up
      const t0 = performance.now();
      const t = await readTerrain(json, 'corrected', null, 160, report);
      const ms = performance.now() - t0;
      const t1 = performance.now();
      const plain = await readTerrain(json, 'corrected', null, 160, null);
      const base = performance.now() - t1;
      const bytesOut = JSON.stringify(t).length;
      const lengthKm = roads.reduce((s, r) => s + r.segments.reduce((a, q) => a + Math.hypot(q[3] - q[0], q[4] - q[1]), 0), 0) / 1000;
      expect(t.roads).toHaveLength(139);
      const k = 1;
      const pieces = roadPieces(t.roads, terrainBase(t.grid), k);
      const fps = footprintsOfRoads(pieces);
      terrainSurface(t.grid, t.tiles, k, fps); // warm-up
      const runs: number[] = [];
      let s = terrainSurface(t.grid, t.tiles, k, fps);
      for (let i = 0; i < 3; i++) {
        const t2 = performance.now();
        s = terrainSurface(t.grid, t.tiles, k, fps);
        runs.push(performance.now() - t2);
      }
      const carve = Math.min(...runs);
      const t3 = performance.now();
      const skirts = ribbonSkirt(pieces, fineGround(t.grid, t.tiles, k));
      const skirtMs = performance.now() - t3;
      console.log(`[perf] /terrain roads: ${t.roads.length} roads ${lengthKm.toFixed(1)} km, tiles ${t.tiles.length} (${triangles(t.tiles)} triangles), `
        + `readTerrain + ${(ms - base).toFixed(0)} ms, answer ${(bytesOut / 1e6).toFixed(2)} MB (without roads ${(JSON.stringify(plain).length / 1e6).toFixed(2)} MB); `
        + `pieces ${pieces.length}, terrainSurface ${carve.toFixed(0)} ms (best of 3), drawn triangles ${s.cells.length}, lowered ${s.lowered}, `
        + `ribbonSkirt ${skirtMs.toFixed(0)} ms (${skirts.length} quads)`);
      expect(triangles(t.tiles)).toBeLessThanOrEqual(TILE_MAX_TRIANGLES);
      expect(ms - base).toBeLessThanOrEqual(800);
      expect(bytesOut).toBeLessThanOrEqual(12e6);
      expect(carve).toBeLessThanOrEqual(1500);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
