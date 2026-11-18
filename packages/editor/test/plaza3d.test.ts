// 평지 in 지형 3D (model/terrain3d.ts): the ground with the plazas on it, the relief clamped and cut out under them, the
// cliff on the fill side, H when the solver has none; and GET /terrain's plazaHeights.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { framePlaza, localFrame, locateXY, type Position } from '@campo/core';
import { createElevationApi } from '../server/elevation-api.ts';
import { plazaHeightsFromReport } from '../server/terrain.ts';
import {
  fromKorea2000, groundOf, plazaGround, plazaHeight, plazaSkirt, terrainMesh, terrainWire, toKorea2000, type Ground, type PlazaFlat, type TerrainGrid,
} from '../src/model/terrain3d.ts';

// A 1 m grid, 60 × 60 cells, rising 0.1 m per metre to the east (40 m at the west edge).
const OX = 203900;
const OY = 550960;
const N = 60;
const at = (x: number, y: number): Position => fromKorea2000(OX + x, OY - y);
function grid(h: (x: number, y: number) => number = (x) => 40 + 0.1 * x): TerrainGrid {
  const z: number[] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) z.push(h(c + 0.5, r + 0.5));
  return { source: 'corrected', crs: 'EPSG:5186', originX: OX, originY: OY, res: 1, width: N, height: N, z };
}
/** A ring of grid metres (x east, y south of the top-left corner), closed. */
const ring = (x0: number, y0: number, x1: number, y1: number): Position[] => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
const OUTER = ring(10.2, 10.2, 50.2, 50.2);
const HOLE = ring(25.2, 25.2, 35.2, 35.2);
const flat = (z: number, rings = [OUTER, HOLE]): PlazaFlat => ({ id: 'p', rings, z });

describe('plazaGround', () => {
  it('the plane on the solid area, the relief in a hole and outside', () => {
    const g = grid();
    const ground = groundOf(g);
    const on = plazaGround(ground, [flat(2)]);
    expect(on(at(15, 15))).toBe(2);
    expect(on(at(10.2, 30))).toBe(2); // on the edge
    expect(on(at(30, 30))).toBeCloseTo(ground(at(30, 30)), 9);
    expect(on(at(5, 5))).toBeCloseTo(ground(at(5, 5)), 9);
    expect(plazaGround(ground, [])).toBe(ground);
  });
});

describe('terrainMesh / terrainWire with plazas', () => {
  const g = grid();
  const f = flat(1.5);
  const framed = framePlaza(f.rings);
  const inSolid = (p: [number, number, number]) => locateXY(framed.rings, framed.frame.toXY([p[0], p[1]])) === 'solid';
  const inHole = (p: Position) => locateXY(framed.rings, framed.frame.toXY(p)) === 'hole';
  it('without plazas the mesh and the wire are as before', () => {
    expect(terrainMesh(g, 1, 1, undefined, [])).toEqual(terrainMesh(g, 1, 1));
    expect(terrainWire(g, 4, 1, undefined, [])).toEqual(terrainWire(g, 4, 1));
  });
  it('corners on the plaza take its plane; triangles wholly on it are left out; the hole keeps its relief', () => {
    const plain = terrainMesh(g, 1, 1);
    const cells = terrainMesh(g, 1, 1, undefined, [f]);
    expect(cells.length).toBeLessThan(plain.length);
    const corners = cells.flatMap((c) => c.polygon);
    const onPlaza = corners.filter(inSolid);
    expect(onPlaza.length).toBeGreaterThan(0);
    expect(onPlaza.every((p) => p[2] === 1.5)).toBe(true);
    // no triangle lies wholly on the solid area
    expect(cells.some((c) => c.polygon.every(inSolid))).toBe(false);
    // the hole is still covered by relief triangles, at the relief's height in the middle
    const holeTris = cells.filter((c) => inHole([(c.polygon[0]![0] + c.polygon[1]![0] + c.polygon[2]![0]) / 3, (c.polygon[0]![1] + c.polygon[1]![1] + c.polygon[2]![1]) / 3]));
    expect(holeTris.length).toBeGreaterThan(50);
    const middle = holeTris.flatMap((c) => c.polygon).filter((p) => inHole([p[0], p[1]]) && !inSolid(p));
    expect(middle.some((p) => p[2] !== 1.5)).toBe(true);
  });
  it('the wire does not run over the plaza', () => {
    const lines = terrainWire(g, 4, 1, undefined, [f]);
    for (const l of lines) {
      for (let i = 0; i + 1 < l.length; i++) expect(inSolid(l[i]!) && inSolid(l[i + 1]!)).toBe(false);
    }
  });
});

describe('plazaSkirt', () => {
  const F = localFrame(OUTER[0]!);
  it('fill: upright quads from the plane down to the ground − 0.2 m, on the outside of the outer ring', () => {
    const quads = plazaSkirt(flat(3, [OUTER]), () => 0);
    expect(quads.length).toBeGreaterThanOrEqual(160); // 160 m of ring in pieces of at most 1 m
    for (const q of quads) {
      expect(q.polygon[0]![2]).toBe(3);
      expect(q.polygon[1]![2]).toBe(3);
      expect(q.polygon[2]![2]).toBeCloseTo(-0.2, 9);
      expect(q.polygon[3]![2]).toBeCloseTo(-0.2, 9);
    }
  });
  it('cut (ground higher than the plane): no skirt', () => {
    expect(plazaSkirt(flat(-1, [OUTER]), () => 0)).toEqual([]);
    expect(plazaSkirt(flat(0.01, [OUTER]), () => 0)).toEqual([]); // within 2 cm
  });
  it('a hole drops into the hole: the ground is low only there', () => {
    const framed = framePlaza([OUTER, HOLE]);
    const ground: Ground = (p) => (locateXY(framed.rings, framed.frame.toXY(p)) === 'hole' ? 0 : 5);
    const quads = plazaSkirt(flat(5), ground);
    expect(quads.length).toBeGreaterThanOrEqual(40); // the hole ring, 40 m
    const holeXY = HOLE.map((p) => F.toXY(p));
    const [hx0, hx1] = [Math.min(...holeXY.map((p) => p[0])), Math.max(...holeXY.map((p) => p[0]))];
    for (const q of quads) {
      const [x] = F.toXY([q.polygon[0]![0], q.polygon[0]![1]]);
      expect(x).toBeGreaterThan(hx0 - 1e-6);
      expect(x).toBeLessThan(hx1 + 1e-6);
      // the ground under it is read 0.6 m into the hole (at a hole corner one end reads the corner's edge: 5 m)
      expect(Math.min(q.polygon[2]![2], q.polygon[3]![2])).toBeCloseTo(-0.2, 9);
    }
  });
});

describe('plazaHeight', () => {
  it("the solver's H, else the median of the relief inside the solid area", () => {
    const g = grid();
    expect(plazaHeight(g, { id: 'p', rings: [OUTER, HOLE], h: 47.25 })).toBe(47.25);
    const h = plazaHeight(g, { id: 'p', rings: [OUTER, HOLE], h: null })!;
    // brute force: the cell centres inside the solid area (10.5 … 49.5, the hole 25.5 … 34.5 left out)
    const vals: number[] = [];
    for (let y = 0.5; y < N; y++) for (let x = 0.5; x < N; x++) {
      const inOuter = x > 10.2 && x < 50.2 && y > 10.2 && y < 50.2;
      const inHole = x > 25.2 && x < 35.2 && y > 25.2 && y < 35.2;
      if (inOuter && !inHole) vals.push(40 + 0.1 * x);
    }
    vals.sort((a, b) => a - b);
    const m = vals.length >> 1;
    expect(h).toBeCloseTo(vals.length % 2 ? vals[m]! : (vals[m - 1]! + vals[m]!) / 2, 6);
    expect(plazaHeight(null, { id: 'p', rings: [OUTER], h: null })).toBeNull();
    // smaller than a cell: the corners' relief
    const tiny = ring(20.6, 20.6, 20.9, 20.9);
    expect(plazaHeight(g, { id: 't', rings: [tiny], h: null })).toBeCloseTo(40 + 0.1 * 20.75, 1);
    expect(toKorea2000(at(1, 1))[0]).toBeCloseTo(OX + 1, 3);
  });
});

describe('GET /terrain plazaHeights', () => {
  let root: string;
  let server: Server;
  let base: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'campo-plaza3d-'));
    const api = createElevationApi({ elevationDir: root, solverScript: 'solver.py', run: async () => ({ code: 1, output: '' }) });
    server = createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await mkdir(join(root, 'campus-a', 'solve'), { recursive: true });
    const meta = { format: 'campo-grid/1', crs: 'EPSG:5186', origin_x: OX, origin_y: OY, res: 1, width: 4, height: 4, dtype: 'float32', nodata: -9999, bin: 'corrected_dem.bin' };
    await writeFile(join(root, 'campus-a', 'solve', 'corrected_dem.json'), JSON.stringify(meta));
    await writeFile(join(root, 'campus-a', 'solve', 'corrected_dem.bin'), new Uint8Array(new Float32Array(16).fill(40).buffer));
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });
  const terrain = async () => (await (await fetch(`${base}/api/elevation/campus-a/terrain`)).json()) as { grid: unknown; plazaHeights: Record<string, number> };

  it('from solve_report.json plazas[]; none or a broken report: {} and the grid as before', async () => {
    let t = await terrain();
    expect(t.grid).not.toBeNull();
    expect(t.plazaHeights).toEqual({});
    await writeFile(join(root, 'campus-a', 'solve', 'solve_report.json'), '{ broken');
    t = await terrain();
    expect(t.grid).not.toBeNull();
    expect(t.plazaHeights).toEqual({});
    await writeFile(join(root, 'campus-a', 'solve', 'solve_report.json'), JSON.stringify({ plazas: [{ id: 'plaza_a', h_m: 42.5 }, { id: 'bad', h_m: null }] }));
    expect((await terrain()).plazaHeights).toEqual({ plaza_a: 42.5 });
  });

  it('plazaHeightsFromReport', () => {
    expect(plazaHeightsFromReport(null)).toEqual({});
    expect(plazaHeightsFromReport('{"grid":{}}')).toEqual({});
    expect(plazaHeightsFromReport('{"plazas":[{"id":"a","h_m":1.5}]}')).toEqual({ a: 1.5 });
  });
});
