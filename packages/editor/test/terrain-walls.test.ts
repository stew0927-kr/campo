// 옹벽 단면 (server/terrain.ts terrainWalls): the 1 m grid read across every drawn wall with lowSide and dropM > 0,
// so 지형 3D can draw the step the solver made instead of the thinned grid's smooth slope. Also GET /terrain's walls.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElevationApi } from '../server/elevation-api.ts';
import { gridValues, terrainWalls, wallHalfWidth, wallsFromStore, type TerrainWallJson } from '../server/terrain.ts';
import { fromKorea2000 } from '../src/model/terrain3d.ts';

// A 1 m grid of 120 × 120 cells; cell edges on whole metres. West of X0 the ground is at 50 m, east of it 53 m (a 3 m wall).
const OX = 203900;
const OY = 550900;
const N = 120;
const X0 = 203960;
function stepBin(h: (x: number, y: number) => number | null, n = N): Float32Array {
  const f = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) f[r * n + c] = h(OX + c + 0.5, OY - r - 0.5) ?? -9999;
  return f;
}
const META = { crs: 'EPSG:5186', origin_x: OX, origin_y: OY, res: 1, width: N, height: N, dtype: 'float32' as const, nodata: -9999 };
const westLow = (x: number) => (x < X0 ? 50 : 53);
const full = (h: (x: number, y: number) => number | null = westLow) => gridValues(META, new Uint8Array(stepBin(h).buffer));

/** A drawn line in the store's form (WGS84 lat/lng) from EPSG:5186 points. */
const line = (id: string, pts: [number, number][], extra: Record<string, unknown>) => ({
  id, source: 'manual', createdAt: 1, coordinates: pts.map(([x, y]) => {
    const [lng, lat] = fromKorea2000(x, y);
    return { lat, lng };
  }), ...extra,
});
const NORTH: [number, number][] = [[X0, 550820], [X0, 550860]];

const zeroRows = (w: TerrainWallJson) => {
  const i = w.offsets.indexOf(0);
  return [i, i + 1] as const;
};
const at = (w: TerrainWallJson, row: number, col: number) => w.z[row * w.x.length + col];

describe('옹벽 단면 (terrainWalls)', () => {
  it('only lines with lowSide and dropM > 0 become walls; others (dropM only, lowSide only, dropM 0) are left out', () => {
    const walls = terrainWalls(full(), [
      line('A', NORTH, { lowSide: 'left', dropM: 3 }),
      line('B', NORTH, { dropM: 3 }),
      line('C', NORTH, { lowSide: 'left', dropM: 0 }),
      line('D', NORTH, {}),
      line('E', NORTH, { lowSide: 'up', dropM: 3 }),
    ], 9);
    expect(walls.map((w) => w.id)).toEqual(['A']);
    expect(walls[0]).toMatchObject({ lowSide: 'left', dropM: 3 });
    expect(terrainWalls(full(), [], 9)).toEqual([]);
  });

  it('offsets are symmetric with 0 twice in a row, 1 m apart; x, y, z have the sizes of rows × cols', () => {
    const [w] = terrainWalls(full(), [line('A', NORTH, { lowSide: 'left', dropM: 3 })], 9);
    const W = wallHalfWidth(9);
    expect(W).toBeGreaterThan(Math.SQRT2 * 9); // a crossed 9 m cell's far corner is up to 9√2 m from the line
    expect(w!.offsets).toEqual([...Array.from({ length: W }, (_, i) => i - W), 0, 0, ...Array.from({ length: W }, (_, i) => i + 1)]);
    expect(w!.offsets.map((o) => 0 - o)).toEqual([...w!.offsets].reverse());
    const cols = w!.x.length;
    expect(w!.y).toHaveLength(cols);
    expect(w!.nx).toHaveLength(cols);
    expect(w!.ny).toHaveLength(cols);
    expect(w!.z).toHaveLength(w!.offsets.length * cols);
    // On the line, every metre, reaching W past both ends; the drawn part is marked.
    for (let c = 0; c < cols; c++) expect(Math.abs(w!.x[c]! - X0)).toBeLessThan(0.01);
    expect(w!.y[0]).toBeCloseTo(550820 - W, 1);
    expect(w!.y.at(-1)).toBeCloseTo(550860 + W, 1);
    for (let c = 1; c < cols; c++) expect(Math.abs(w!.y[c]! - w!.y[c - 1]!)).toBeLessThanOrEqual(1.0001);
    const [d0, d1] = w!.drawn;
    expect(w!.y[d0]).toBeCloseTo(550820, 1);
    expect(w!.y[d1]).toBeCloseTo(550860, 1);
    // The high side is east: the normal points that way.
    expect(w!.nx[0]).toBeCloseTo(1, 3);
  });

  it('the two 0 rows are the low and the high ground at the line: 3 m apart', () => {
    const [w] = terrainWalls(full(), [line('A', NORTH, { lowSide: 'left', dropM: 3 })], 9);
    const [lo, hi] = zeroRows(w!);
    for (let c = 0; c < w!.x.length; c++) {
      expect(at(w!, lo, c)).toBeCloseTo(50, 3);
      expect(Math.abs(at(w!, hi, c)! - at(w!, lo, c)! - 3)).toBeLessThan(0.2);
    }
    // The outer rows are the ground well away from the wall.
    expect(at(w!, 0, 10)).toBeCloseTo(50, 3);
    expect(at(w!, w!.offsets.length - 1, 10)).toBeCloseTo(53, 3);
  });

  it('a diagonal wall: the face is still the full step', () => {
    // High to the north-east of x + y = S (no cell centre on the line); drawn south-east, so the low side is on its right.
    const S = X0 + 550860 + 0.3;
    const [w] = terrainWalls(full((x, y) => (x + y > S ? 53 : 50)), [line('G', [[X0, 550860.3], [X0 + 40, 550820.3]], { lowSide: 'right', dropM: 3 })], 9);
    const [lo, hi] = zeroRows(w!);
    for (let c = w!.drawn[0]; c <= w!.drawn[1]; c++) expect(Math.abs(at(w!, hi, c)! - at(w!, lo, c)! - 3)).toBeLessThan(0.2);
  });

  it('when the ground plainly says the other side is low, the measured sides win', () => {
    const [w] = terrainWalls(full(), [line('A', NORTH, { lowSide: 'right', dropM: 3 })], 9);
    const [lo, hi] = zeroRows(w!);
    expect(at(w!, lo, 20)).toBeCloseTo(50, 3);
    expect(at(w!, hi, 20)).toBeCloseTo(53, 3);
    expect(w!.lowSide).toBe('right'); // what was drawn is reported as it is
  });

  it('rows off the grid are null, rows on it have values', () => {
    // 3 m inside the west edge: the low (west) end of the section leaves the grid.
    const [w] = terrainWalls(full(), [line('E', [[OX + 3, 550820], [OX + 3, 550860]], { lowSide: 'left', dropM: 1 })], 9);
    expect(at(w!, 0, 20)).toBeNull();
    expect(at(w!, w!.offsets.length - 1, 20)).toBeCloseTo(50, 3);
    // No data cells are skipped, not read as -9999.
    const holes = gridValues(META, new Uint8Array(stepBin(() => null).buffer));
    const [v] = terrainWalls(holes, [line('A', NORTH, { lowSide: 'left', dropM: 3 })], 9);
    expect(v!.z.every((z) => z === null)).toBe(true);
  });

  it('wallsFromStore: the drawn lines of a store text; none for no text or text that is not JSON', () => {
    expect(wallsFromStore(null)).toEqual([]);
    expect(wallsFromStore('{ not json')).toEqual([]);
    expect(wallsFromStore('{"schemaVersion":1}')).toEqual([]);
    expect(wallsFromStore(JSON.stringify({ breaklines: [line('A', NORTH, { lowSide: 'left', dropM: 3 })] }))).toHaveLength(1);
  });
});

describe('GET /api/elevation/:id/terrain walls', () => {
  let root: string;
  let server: Server;
  let base: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'campo-walls-'));
    const api = createElevationApi({ elevationDir: root, solverScript: 'solver.py', run: async () => ({ code: 1, output: '' }) });
    server = createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await mkdir(join(root, 'campus-a', 'solve'), { recursive: true });
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });
  const terrain = async () => (await (await fetch(`${base}/api/elevation/campus-a/terrain`)).json()) as { grid: { source: string } | null; walls: TerrainWallJson[] };
  const store = (lines: unknown[]) => JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], breaklines: lines });

  it('sends the walls of the store with the corrected grid', async () => {
    await writeFile(join(root, 'campus-a', 'solve', 'corrected_dem.json'), JSON.stringify(META));
    await writeFile(join(root, 'campus-a', 'solve', 'corrected_dem.bin'), stepBin(westLow));
    await writeFile(join(root, 'campus-a', 'store.json'), store([line('A', NORTH, { lowSide: 'left', dropM: 3 }), line('B', NORTH, { dropM: 3 })]));
    const t = await terrain();
    expect(t.grid?.source).toBe('corrected');
    expect(t.walls.map((w) => w.id)).toEqual(['A']);
    const [lo, hi] = zeroRows(t.walls[0]!);
    expect(at(t.walls[0]!, hi, 20)! - at(t.walls[0]!, lo, 20)!).toBeCloseTo(3, 1);
  });

  it('with the plain DEM the walls come the same way (a DEM without a step gives a face of about 0)', async () => {
    await writeFile(join(root, 'campus-a', 'dem.json'), JSON.stringify(META));
    await writeFile(join(root, 'campus-a', 'dem.bin'), stepBin(() => 40));
    await writeFile(join(root, 'campus-a', 'store.json'), store([line('A', NORTH, { lowSide: 'left', dropM: 3 })]));
    const t = await terrain();
    expect(t.grid?.source).toBe('dem');
    const [lo, hi] = zeroRows(t.walls[0]!);
    expect(at(t.walls[0]!, hi, 20)! - at(t.walls[0]!, lo, 20)!).toBeCloseTo(0, 3);
  });

  it('no store or a broken one: walls [] and the grid as before; no grid: { grid: null, walls: [] }', async () => {
    expect(await terrain()).toEqual({ grid: null, walls: [] });
    await writeFile(join(root, 'campus-a', 'dem.json'), JSON.stringify(META));
    await writeFile(join(root, 'campus-a', 'dem.bin'), stepBin(westLow));
    expect((await terrain()).walls).toEqual([]);
    await writeFile(join(root, 'campus-a', 'store.json'), '{ broken');
    const t = await terrain();
    expect(t.grid?.source).toBe('dem');
    expect(t.walls).toEqual([]);
  });
});
