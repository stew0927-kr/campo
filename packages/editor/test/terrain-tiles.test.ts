// 지형 3D tiles (server/terrain.ts terrainTiles, sampleGridValues, coarseVertexXY, plazaTileAreas, readTerrain tiles/roads):
// the thinned 10 m grid re-drawn at 1 m round each 평지 from the full grid, sewn to the coarse cells without cracks, within
// a triangle budget.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLAZA_TILE_RES_M, TILE_MARGIN_M, TILE_MAX_TRIANGLES, coarseVertexXY, decodeGrid, gridValues, plazaTileAreas, readTerrain,
  sampleGridValues, terrainTiles, type TerrainTileJson, type TileArea,
} from '../server/terrain.ts';
import { fromKorea2000, terrainMesh } from '../src/model/terrain3d.ts';
import { L_OUTER, META, OX, OY, RAW_N, bboxXY, coarseOf, rawGrid, xy } from './terrainSynth.ts';

const { bytes, g } = rawGrid();
const coarse = coarseOf(bytes);

const grow = (b: [number, number, number, number], m = TILE_MARGIN_M): [number, number, number, number] => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
const plazaArea = (id: string, ring: readonly [number, number][]): TileArea => ({ kind: 'plaza', id, box: grow(bboxXY(ring)) });
const triangles = (tiles: readonly TerrainTileJson[]) => tiles.reduce((s, t) => s + 2 * t.sub * t.sub, 0);

describe('constants', () => {
  it('as the plan says', () => {
    expect(TILE_MARGIN_M).toBe(10);
    expect(PLAZA_TILE_RES_M).toBe(1);
    expect(TILE_MAX_TRIANGLES).toBe(250_000);
  });
});

describe('coarseVertexXY matches decodeGrid', () => {
  it('a thinned vertex (r, c) is the centre of the full cell (r × stride, c × stride) it was read from', () => {
    expect([coarse.width, coarse.height, coarse.res]).toEqual([60, 60, 10]);
    const raw = { originX: META.origin_x, originY: META.origin_y, res: META.res };
    for (const [r, c] of [[0, 0], [0, 59], [59, 0], [17, 33], [59, 59], [41, 2]] as const) {
      const [x, y] = coarseVertexXY(coarse, r, c);
      const [rx, ry] = coarseVertexXY(raw, r * 10, c * 10);
      expect(Math.abs(x - rx)).toBeLessThan(1e-9);
      expect(Math.abs(y - ry)).toBeLessThan(1e-9);
      expect([rx, ry]).toEqual([OX + c * 10 + 0.5, OY - (r * 10 + 0.5)]);
      expect(coarse.z[r * coarse.width + c]).toBe(g.at(r * 10, c * 10));
    }
  });
  it('a stride that does not divide the size (decodeGrid with 23 cells) keeps the same rule', () => {
    const t = decodeGrid(META, bytes, 'dem', 23);
    const stride = Math.ceil(RAW_N / 23);
    for (const [r, c] of [[0, 0], [5, 7], [t.height - 1, t.width - 1]] as const) {
      const [x, y] = coarseVertexXY(t, r, c);
      expect(Math.abs(x - (OX + c * stride + 0.5))).toBeLessThan(1e-9);
      expect(Math.abs(y - (OY - (r * stride + 0.5)))).toBeLessThan(1e-9);
    }
  });
  it('and it is the very vertex terrainMesh draws', () => {
    const cells = terrainMesh(coarse);
    const [x, y] = coarseVertexXY(coarse, 0, 0);
    expect(cells[0]!.polygon[0]!.slice(0, 2)).toEqual(fromKorea2000(x, y));
  });
});

describe('sampleGridValues', () => {
  it('the cell value at a centre, bilinear between centres, null off the grid or next to no data', () => {
    expect(sampleGridValues(g, OX + 10.5, OY - 20.5)).toBe(g.at(20, 10));
    const mid = sampleGridValues(g, OX + 11, OY - 21)!;
    expect(mid).toBeCloseTo((g.at(20, 10)! + g.at(20, 11)! + g.at(21, 10)! + g.at(21, 11)!) / 4, 9);
    const q = sampleGridValues(g, OX + 10.75, OY - 20.5)!;
    expect(q).toBeCloseTo(0.75 * g.at(20, 10)! + 0.25 * g.at(20, 11)!, 9);
    expect(sampleGridValues(g, OX - 5, OY - 5)).toBeNull();
    expect(sampleGridValues(g, OX + RAW_N + 1, OY - 5)).toBeNull();
    const f = new Float32Array(4).fill(10);
    f[1] = -9999;
    const small = gridValues({ ...META, width: 2, height: 2 }, new Uint8Array(f.buffer));
    expect(sampleGridValues(small, OX + 1, OY - 1)).toBeNull();
    expect(sampleGridValues(small, OX + 0.5, OY - 1.5)).toBe(10); // the empty cell has no weight there
  });
});

describe('terrainTiles', () => {
  const area = plazaArea('L', L_OUTER);
  const tiles = terrainTiles(g, coarse, [area]);
  const byQuad = new Map(tiles.map((t) => [t.r * coarse.width + t.c, t]));

  it('every coarse cell the grown box meets, split 10 × 10 (10 m cells at 1 m)', () => {
    const [x0, y0, x1, y1] = area.box;
    const want: number[] = [];
    for (let r = 0; r + 1 < coarse.height; r++) {
      for (let c = 0; c + 1 < coarse.width; c++) {
        const [ax, ay] = coarseVertexXY(coarse, r, c);
        const [bx, by] = coarseVertexXY(coarse, r + 1, c + 1);
        if (bx >= x0 && ax <= x1 && ay >= y0 && by <= y1) want.push(r * coarse.width + c);
      }
    }
    expect([...byQuad.keys()].sort((a, b) => a - b)).toEqual(want);
    for (const t of tiles) {
      expect(t.sub).toBe(10);
      expect(t.z).toHaveLength(121);
    }
  });

  it('corners are the coarse values; inside, the full grid read at the point (to the mm)', () => {
    for (const t of tiles) {
      const n = t.sub + 1;
      expect(t.z[0]).toBe(coarse.z[t.r * coarse.width + t.c]);
      expect(t.z[t.sub]).toBe(coarse.z[t.r * coarse.width + t.c + 1]);
      expect(t.z[t.sub * n]).toBe(coarse.z[(t.r + 1) * coarse.width + t.c]);
      expect(t.z[n * n - 1]).toBe(coarse.z[(t.r + 1) * coarse.width + t.c + 1]);
      for (const [i, j] of [[3, 4], [5, 5], [9, 1]] as const) {
        const [x, y] = coarseVertexXY(coarse, t.r + i / t.sub, t.c + j / t.sub);
        expect(Math.abs(t.z[i * n + j]! - sampleGridValues(g, x, y)!)).toBeLessThanOrEqual(0.0005 + 1e-12);
      }
    }
  });

  it('tiles are watertight: tile–tile edges identical, tile–coarse edges on the straight line between the corners', () => {
    let shared = 0;
    let free = 0;
    for (const t of tiles) {
      const n = t.sub + 1;
      const at = (i: number, j: number) => t.z[i * n + j]!;
      const sides = [
        { dr: -1, dc: 0, mine: (k: number) => at(0, k), theirs: (o: TerrainTileJson, k: number) => o.z[t.sub * n + k]!, ends: [at(0, 0), at(0, t.sub)] },
        { dr: 1, dc: 0, mine: (k: number) => at(t.sub, k), theirs: (o: TerrainTileJson, k: number) => o.z[k]!, ends: [at(t.sub, 0), at(t.sub, t.sub)] },
        { dr: 0, dc: -1, mine: (k: number) => at(k, 0), theirs: (o: TerrainTileJson, k: number) => o.z[k * n + t.sub]!, ends: [at(0, 0), at(t.sub, 0)] },
        { dr: 0, dc: 1, mine: (k: number) => at(k, t.sub), theirs: (o: TerrainTileJson, k: number) => o.z[k * n]!, ends: [at(0, t.sub), at(t.sub, t.sub)] },
      ];
      for (const s of sides) {
        const other = byQuad.get((t.r + s.dr) * coarse.width + t.c + s.dc);
        for (let k = 0; k <= t.sub; k++) {
          if (other) {
            expect(s.mine(k)).toBe(s.theirs(other, k));
            shared++;
          } else {
            const lerp = s.ends[0]! + (s.ends[1]! - s.ends[0]!) * (k / t.sub);
            expect(Math.abs(s.mine(k) - lerp)).toBeLessThanOrEqual(1e-9);
            free++;
          }
        }
      }
    }
    expect(shared).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
  });

  it('no areas, or a grid already as fine as the tiles: none', () => {
    expect(terrainTiles(g, coarse, [])).toEqual([]);
    const fine = decodeGrid({ ...META, width: 50, height: 50 }, bytes, 'dem', 160);
    expect(fine.res).toBe(1);
    expect(terrainTiles(gridValues({ ...META, width: 50, height: 50 }, bytes), fine, [{ kind: 'plaza', id: 'a', box: [OX, OY - 20, OX + 20, OY] }])).toEqual([]);
  });

  it('a box off the grid gives none; a cell with no data at a corner keeps its null', () => {
    expect(terrainTiles(g, coarse, [{ kind: 'plaza', id: 'far', box: [OX - 500, OY + 100, OX - 400, OY + 200] }])).toEqual([]);
    const holed = { ...coarse, z: coarse.z.map((v, i) => (i === 20 * coarse.width + 20 ? null : v)) };
    // A point box at (201, 201): inside the coarse cell between vertices (20, 20) (at 200.5 m) and (21, 21) only.
    const [px, py] = xy(201, 201);
    const tt = terrainTiles(g, holed, [{ kind: 'plaza', id: 'a', box: [px, py, px, py] }]);
    expect(tt.map((t) => [t.r, t.c])).toEqual([[20, 20]]);
    expect(tt[0]!.z[0]).toBeNull();
    // The two edges that start at the empty corner have nothing to run between: null too; the inside is read from the full grid.
    expect(tt[0]!.z[5]).toBeNull();
    expect(tt[0]!.z[5 * 11]).toBeNull();
    expect(tt[0]!.z[5 * 11 + 5]).not.toBeNull();
  });
});

describe('tile budget', () => {
  // 40 plazas of 40 × 40 m, 70 m apart: 49 coarse cells each with the margin, 40 × 49 × 200 = 392,000 triangles > 250,000.
  const rings: [number, number][][] = [];
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 5; j++) {
      const [x, y] = [15.3 + i * 70, 15.7 + j * 70];
      rings.push([[x, y], [x + 40, y], [x + 40, y + 40], [x, y + 40]]);
    }
  }
  const plazas = rings.map((r, i) => plazaArea(`p${i}`, r));
  const road: TileArea = { kind: 'road', id: 'road', box: [OX + 10, OY - 590, OX + 590, OY - 10] };

  it('over the cap: plazas first (a whole plaza at a time), roads only after them, the total ≤ 250,000', () => {
    const tiles = terrainTiles(g, coarse, [road, ...plazas]);
    const n = triangles(tiles);
    expect(n).toBeLessThanOrEqual(TILE_MAX_TRIANGLES);
    expect(n).toBeGreaterThan(TILE_MAX_TRIANGLES - 49 * 200);
    const quads = new Set(tiles.map((t) => t.r * coarse.width + t.c));
    // Every plaza is either tiled whole or not at all.
    let whole = 0;
    for (const p of plazas) {
      const own = terrainTiles(g, coarse, [p]).map((t) => t.r * coarse.width + t.c);
      const hit = own.filter((q) => quads.has(q)).length;
      expect(hit === 0 || hit === own.length).toBe(true);
      if (hit === own.length) whole++;
    }
    expect(whole).toBeGreaterThan(20);
    // The road's box covers the whole grid: had it gone first, it alone would have spent the budget.
    expect(triangles(terrainTiles(g, coarse, [road]))).toBeLessThanOrEqual(TILE_MAX_TRIANGLES);
  });

  it('a smaller cap is kept too; under the cap every area is tiled', () => {
    expect(triangles(terrainTiles(g, coarse, plazas, { maxTriangles: 10_000 }))).toBeLessThanOrEqual(10_000);
    const few = terrainTiles(g, coarse, plazas.slice(0, 3));
    expect(triangles(few)).toBe(3 * 49 * 200);
  });
});

describe('readTerrain tiles and roads', () => {
  it('tiles round every plaza with a bbox_xy in the report; roads [] for now; no report or no bbox_xy: no tiles', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'campo-tiles-'));
    try {
      const json = join(dir, 'corrected_dem.json');
      await writeFile(json, JSON.stringify({ ...META, format: 'campo-grid/1', bin: 'corrected_dem.bin' }));
      await writeFile(join(dir, 'corrected_dem.bin'), bytes);
      const report = JSON.stringify({ plazas: [{ id: 'L', h_m: 60, bbox_xy: bboxXY(L_OUTER) }] });
      const t = await readTerrain(json, 'corrected', null, 60, report);
      expect(t.roads).toEqual([]);
      expect(t.tiles).toEqual(terrainTiles(g, t.grid, [plazaArea('L', L_OUTER)]));
      expect(t.tiles.length).toBeGreaterThan(0);
      expect(t.plazaHeights).toEqual({ L: 60 });
      expect((await readTerrain(json, 'corrected', null, 60, null)).tiles).toEqual([]);
      expect((await readTerrain(json, 'corrected', null, 60, JSON.stringify({ plazas: [{ id: 'L', h_m: 60 }] }))).tiles).toEqual([]);
      expect((await readTerrain(json, 'corrected', null, 60, '{ broken')).tiles).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('plazaTileAreas: bbox_xy grown by the margin, rows without a finite 4-number bbox_xy left out', () => {
    const b = bboxXY(L_OUTER);
    expect(plazaTileAreas(JSON.stringify({ plazas: [{ id: 'L', bbox_xy: b }, { id: 'x', bbox_xy: [1, 2, null, 4] }, { id: 'y' }] })))
      .toEqual([{ kind: 'plaza', id: 'L', box: grow(b) }]);
    expect(plazaTileAreas(null)).toEqual([]);
    expect(plazaTileAreas('{"plazas": 3}')).toEqual([]);
  });
});

describe('/terrain on a 한양대-sized grid (1464 × 1092 at 1 m): time and size', () => {
  it('the tiles add ≤ 800 ms (target 300 ms) and the answer stays ≤ 12 MB (target 6 MB), even with the budget spent', async () => {
    const [w, h] = [1464, 1092];
    const f = new Float32Array(w * h);
    const rand = (() => { let a = 3; return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648); })();
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) f[r * w + c] = 30 + 0.04 * c + 0.03 * r + rand() * 0.3;
    const meta = { ...META, width: w, height: h, format: 'campo-grid/1', bin: 'corrected_dem.bin' };
    const dir = await mkdtemp(join(tmpdir(), 'campo-tiles-big-'));
    try {
      const json = join(dir, 'corrected_dem.json');
      await writeFile(json, JSON.stringify(meta));
      await writeFile(join(dir, 'corrected_dem.bin'), new Uint8Array(f.buffer));
      const box = (x: number, y: number, s: number) => [OX + x, OY - y - s, OX + x + s, OY - y];
      const reports = {
        // 10 plazas of 50 × 50 m spread over the campus
        ten: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, h_m: 40, bbox_xy: box(60 + (i % 5) * 270, 80 + Math.floor(i / 5) * 500, 50) })),
        // 60 plazas of 80 × 80 m: more than the budget holds
        full: Array.from({ length: 60 }, (_, i) => ({ id: `q${i}`, h_m: 40, bbox_xy: box(20 + (i % 10) * 140, 20 + Math.floor(i / 10) * 175, 80) })),
      };
      const plain = await readTerrain(json, 'corrected', null, 160, null);
      for (const [name, plazas] of Object.entries(reports)) {
        const report = JSON.stringify({ plazas });
        await readTerrain(json, 'corrected', null, 160, report); // warm-up
        const t0 = performance.now();
        const t = await readTerrain(json, 'corrected', null, 160, report);
        const ms = performance.now() - t0;
        const t1 = performance.now();
        await readTerrain(json, 'corrected', null, 160, null);
        const base = performance.now() - t1;
        const bytesOut = JSON.stringify(t).length;
        const tris = triangles(t.tiles);
        console.log(`[perf] /terrain ${name}: grid ${t.grid.width}×${t.grid.height} @ ${t.grid.res} m, tiles ${t.tiles.length}, tile triangles ${tris}, `
          + `readTerrain ${ms.toFixed(0)} ms (without tiles ${base.toFixed(0)} ms, + ${(ms - base).toFixed(0)} ms), answer ${(bytesOut / 1e6).toFixed(2)} MB `
          + `(without tiles ${(JSON.stringify(plain).length / 1e6).toFixed(2)} MB)`);
        expect(tris).toBeLessThanOrEqual(TILE_MAX_TRIANGLES);
        expect(ms - base).toBeLessThanOrEqual(800);
        expect(bytesOut).toBeLessThanOrEqual(12e6);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
