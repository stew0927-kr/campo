// 옹벽 in 지형 3D (model/terrain3d.ts wallMesh, wallCells, terrainMesh's skipped cells; map/deck3d.ts): the 1 m sections
// across each wall drawn as strips with an upright face, and the thinned mesh cut where a wall runs so it neither covers
// nor pokes through the face, without leaving a hole.
import { describe, expect, it } from 'vitest';
import { decodeGrid, gridValues, terrainWalls } from '../server/terrain.ts';
import { deckLayers } from '../src/map/deck3d.ts';
import {
  fromKorea2000, terrainBase, terrainMesh, terrainWire, wallCells, wallMesh, wallPoint, type TerrainGrid, type TerrainWall,
} from '../src/model/terrain3d.ts';
import { fixtureSession } from './fixture.ts';

const X = 204000;
const Y = 550900;

/** A hand-made section: 4 rows (-1, 0, 0, 1) × 3 columns going north, high side east; one value missing. */
const handWall = (): TerrainWall => ({
  id: 'w', lowSide: 'left', dropM: 2, offsets: [-1, 0, 0, 1],
  x: [X, X, X], y: [Y, Y + 1, Y + 2], nx: [1, 1, 1], ny: [0, 0, 0], drawn: [0, 2],
  z: [10, 10, 10, 10, 10, null, 12, 12, 12, 12, 12, 12],
});
/** A 4 × 4 grid around the hand wall, lowest point 8 m. */
const smallGrid = (): TerrainGrid => ({
  source: 'corrected', crs: 'EPSG:5186', originX: X - 20, originY: Y + 20, res: 10, width: 4, height: 4, z: Array.from({ length: 16 }, (_, i) => 8 + i * 0.1),
});

describe('wallMesh', () => {
  it('triangulates rows × cols, skipping cells with a missing corner; the cells between the two 0 rows are the face', () => {
    const tris = wallMesh(smallGrid(), [handWall()], 2);
    // 3 × 2 cells, the two touching the missing value skipped: 4 cells, 8 triangles.
    expect(tris).toHaveLength(8);
    const face = tris.filter((t) => t.role === 'face');
    expect(face).toHaveLength(2);
    expect(tris.filter((t) => t.role === 'strip')).toHaveLength(6);
  });

  it('z is (height − the grid base) × k and x, y are turned into lng, lat; rows sit offset × the normal from the line', () => {
    const g = smallGrid();
    expect(terrainBase(g)).toBe(8);
    const tris = wallMesh(g, [handWall()], 2);
    const face = tris.find((t) => t.role === 'face')!;
    const zs = face.polygon.map((p) => p[2]).sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo((10 - 8) * 2, 9);
    expect(zs[2]).toBeCloseTo((12 - 8) * 2, 9);
    // The first strip cell (row -1 → 0, col 0 → 1) has a corner one metre west of the line.
    const west = fromKorea2000(X - 1, Y);
    expect(tris.some((t) => t.polygon.some((p) => Math.abs(p[0] - west[0]) < 1e-10 && Math.abs(p[1] - west[1]) < 1e-10))).toBe(true);
    expect(wallPoint(handWall(), 3, 1)).toEqual([X + 1, Y + 1]);
    // Without exaggeration the face is the true 2 m.
    const f1 = wallMesh(g, [handWall()], 1).find((t) => t.role === 'face')!.polygon.map((p) => p[2]);
    expect(Math.max(...f1) - Math.min(...f1)).toBeCloseTo(2, 9);
    // A lift raises every vertex.
    const lifted = wallMesh(g, [handWall()], 1, 0.03).find((t) => t.role === 'face')!.polygon.map((p) => p[2]);
    expect(Math.min(...lifted)).toBeCloseTo(2.03, 9);
  });
});

describe('terrainMesh without the cells a wall runs through', () => {
  it('leaves out the skipped cells and keeps the default call as it was', () => {
    const g = smallGrid();
    expect(terrainMesh(g)).toHaveLength(18);
    expect(terrainMesh(g, 1, 1, new Set([1 * 4 + 1]))).toHaveLength(16);
    expect(terrainMesh(g, 1, 1, new Set())).toEqual(terrainMesh(g));
  });
  it('the wire breaks where a cell is skipped', () => {
    const g = smallGrid();
    const all = terrainWire(g, 1).reduce((s, l) => s + l.length - 1, 0);
    const cut = terrainWire(g, 1, 1, new Set([1 * 4 + 1])).reduce((s, l) => s + l.length - 1, 0);
    expect(cut).toBe(all - 4);
  });
});

// ---- the real case: a 1 m grid thinned to 9 m cells, walls sectioned from it ----

const OX = 203900;
const OY = 551000;
const N = 200;
const META = { crs: 'EPSG:5186', origin_x: OX, origin_y: OY, res: 1, width: N, height: N, dtype: 'float32' as const, nodata: -9999 };
const bin = (() => {
  const f = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) f[r * N + c] = 40 + 0.05 * c + 0.03 * r + (c > 100 ? 2 : 0);
  return new Uint8Array(f.buffer);
})();
const thinned = decodeGrid(META, bin, 'corrected', 23);
const full = gridValues(META, bin);
const drawn = (id: string, pts: [number, number][]) => ({
  id, source: 'manual', createdAt: 1, lowSide: 'left', dropM: 2,
  coordinates: pts.map(([x, y]) => {
    const [lng, lat] = fromKorea2000(x, y);
    return { lat, lng };
  }),
});

/** Is (px, py) inside a triangle of some wall's mesh (cells with all four values only, as wallMesh draws them)? */
function covered(walls: readonly TerrainWall[], px: number, py: number): boolean {
  const inTri = (a: number[], b: number[], c: number[]) => {
    const s = (p: number[], q: number[]) => (q[0]! - p[0]!) * (py - p[1]!) - (q[1]! - p[1]!) * (px - p[0]!);
    const [d1, d2, d3] = [s(a, b), s(b, c), s(c, a)];
    const eps = 1e-6;
    return (d1 >= -eps && d2 >= -eps && d3 >= -eps) || (d1 <= eps && d2 <= eps && d3 <= eps);
  };
  for (const w of walls) {
    const cols = w.x.length;
    for (let c = 0; c + 1 < cols; c++) {
      if (Math.hypot(w.x[c]! - px, w.y[c]! - py) > w.offsets.at(-1)! + 3) continue;
      for (let r = 0; r + 1 < w.offsets.length; r++) {
        const zs = [w.z[r * cols + c], w.z[r * cols + c + 1], w.z[(r + 1) * cols + c], w.z[(r + 1) * cols + c + 1]];
        if (zs.some((z) => z === null)) continue;
        const [a, b, d, e] = [wallPoint(w, r, c), wallPoint(w, r, c + 1), wallPoint(w, r + 1, c), wallPoint(w, r + 1, c + 1)];
        if (inTri(a, b, e) || inTri(a, e, d)) return true;
      }
    }
  }
  return false;
}

function holes(grid: TerrainGrid, walls: readonly TerrainWall[]): string[] {
  const cells = wallCells(grid, walls);
  expect(cells.size).toBeGreaterThan(0);
  const out: string[] = [];
  for (const key of cells) {
    const [r, c] = [Math.floor(key / grid.width), key % grid.width];
    // The cell between centres (r, c) and (r + 1, c + 1): its corners and points inside.
    for (let i = 0; i <= 5; i++) {
      for (let j = 0; j <= 5; j++) {
        const px = grid.originX + (c + 0.5 + j / 5) * grid.res;
        const py = grid.originY - (r + 0.5 + i / 5) * grid.res;
        if (!covered(walls, px, py)) out.push(`${r},${c} @ ${px.toFixed(1)},${py.toFixed(1)}`);
      }
    }
  }
  return out;
}

describe('wallCells: the 9 m cells a wall crosses are cut, and the sections cover them', () => {
  it('the thinned grid is the real case (9 m cells)', () => {
    expect(thinned.res).toBe(9);
  });
  const cases: [string, [number, number][][]][] = [
    ['upright (north-south)', [[[OX + 100, OY - 40], [OX + 100, OY - 150]]]],
    ['diagonal', [[[OX + 40, OY - 50], [OX + 150, OY - 130]]]],
    ['two walls crossing', [[[OX + 40, OY - 100], [OX + 160, OY - 104]], [[OX + 97, OY - 40], [OX + 103, OY - 160]]]],
    ['bent (an L)', [[[OX + 50, OY - 50], [OX + 140, OY - 60], [OX + 120, OY - 150]]]],
    ['short (shorter than a cell)', [[[OX + 95, OY - 95], [OX + 99, OY - 98]]]],
  ];
  for (const [name, lines] of cases) {
    it(`${name}: no hole`, () => {
      const walls = terrainWalls(full, lines.map((l, i) => drawn(`w${i}`, l)), thinned.res);
      expect(walls).toHaveLength(lines.length);
      expect(holes(thinned, walls)).toEqual([]);
      // The cut cells really are left out of the mesh.
      const cells = wallCells(thinned, walls);
      expect(terrainMesh(thinned, 1, 1, cells)).toHaveLength(terrainMesh(thinned).length - 2 * cells.size);
    });
  }
  it('a cell next to a wall but not crossed by it stays', () => {
    const walls = terrainWalls(full, [drawn('w', [[OX + 100, OY - 40], [OX + 100, OY - 150]])], thinned.res);
    const cells = wallCells(thinned, walls);
    // Centres are at OX + 0.5 + 9c: x = OX + 100 lies between centres 11 (99.5) and 12 (108.5): only that column of cells.
    const cols = new Set([...cells].map((k) => k % thinned.width));
    expect([...cols]).toEqual([11]);
  });
});

describe('deckLayers: the walls in 지형 3D', () => {
  const state = fixtureSession().history.current();
  const walls = terrainWalls(full, [drawn('w', [[OX + 100, OY - 40], [OX + 100, OY - 150]])], thinned.res);
  const input = (k: number, grid: TerrainGrid | null, terrain = true) => ({
    state, scope: { kind: 'outdoor' as const }, grid, walls, terrain, buildings: false, measured: () => new Map(), exaggeration: k, routes: [], slopes: [],
  });
  type Tri = { polygon: [number, number, number][] };
  const faceSpan = (k: number) => {
    const layer = deckLayers(input(k, thinned)).find((l) => l.id === 'terrain-wall-face')!;
    const data = layer.props.data as Tri[];
    return Math.max(...data.flatMap((t) => t.polygon.map((p) => p[2]))) - Math.min(...data.flatMap((t) => t.polygon.map((p) => p[2])));
  };
  it('draws the strips and the faces, and 높이 과장 stretches the faces with the relief', () => {
    const ids = deckLayers(input(1, thinned)).map((l) => l.id);
    expect(ids).toContain('terrain-wall-strip');
    expect(ids).toContain('terrain-wall-face');
    expect(faceSpan(2)).toBeCloseTo(faceSpan(1) * 2, 6);
    const mesh = deckLayers(input(1, thinned)).find((l) => l.id === 'terrain-mesh')!.props.data as unknown[];
    expect(mesh.length).toBe(terrainMesh(thinned).length - 2 * wallCells(thinned, walls).size);
  });
  it('no walls without a grid or with the terrain off', () => {
    expect(deckLayers(input(1, null)).some((l) => l.id.startsWith('terrain-wall'))).toBe(false);
    expect(deckLayers(input(1, thinned, false)).some((l) => l.id.startsWith('terrain-wall'))).toBe(false);
  });
});
