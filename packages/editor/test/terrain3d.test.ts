// 지형 3D / 건물 3D geometry (model/terrain3d.ts) and the height grid the dev server sends (server/terrain.ts).
import { describe, expect, it } from 'vitest';
import type { EditState, Position } from '@campo/core';
import { decodeGrid } from '../server/terrain.ts';
import {
  buildingGround, buildingSegments, drapePath, floorBases, fromKorea2000, groundOf, nodeHeights, sampleTerrain, sampleTerrainGrid, terrainBase,
  terrainMesh, terrainWire, toKorea2000, type TerrainGrid,
} from '../src/model/terrain3d.ts';
import { fixtureSession } from './fixture.ts';

const state = (): EditState => fixtureSession().history.current();

/** A grid whose cell centres sit on whole metres around `at`, with heights from `h(col, row)`. */
function gridAround(at: Position, width: number, height: number, res: number, h: (c: number, r: number) => number | null): TerrainGrid {
  const [x, y] = toKorea2000(at);
  const z: (number | null)[] = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) z.push(h(c, r));
  return { source: 'corrected', crs: 'EPSG:5186', originX: Math.round(x) - res / 2, originY: Math.round(y) + res / 2, res, width, height, z };
}
const centre = (g: TerrainGrid, c: number, r: number): Position => fromKorea2000(g.originX + (c + 0.5) * g.res, g.originY - (r + 0.5) * g.res);

describe('EPSG:5186 (the grid files of tools/elevation)', () => {
  it('matches pyproj to a centimetre and goes back to the same position', () => {
    const cases: [Position, [number, number]][] = [
      [[127, 38], [200000, 600000]],
      [[127.045, 37.557], [203976.11840504408, 550831.3669468669]],
      [[126.9779, 37.5663], [198047.52682016182, 551862.8350036372]],
      [[127.3, 36.5], [226877.3664101803, 433568.32801444374]],
    ];
    for (const [p, xy] of cases) {
      const [x, y] = toKorea2000(p);
      expect(Math.abs(x - xy[0])).toBeLessThan(0.01);
      expect(Math.abs(y - xy[1])).toBeLessThan(0.01);
      const back = fromKorea2000(x, y);
      expect(Math.abs(back[0] - p[0])).toBeLessThan(1e-8);
      expect(Math.abs(back[1] - p[1])).toBeLessThan(1e-8);
    }
  });
});

describe('the height grid', () => {
  const g = gridAround([127.045, 37.557], 3, 3, 10, (c, r) => (c === 2 && r === 2 ? null : 30 + c - r * 2));
  it('is exact on a cell centre, bilinear between, null outside; a cell without data takes a neighbour', () => {
    expect(sampleTerrain(g, centre(g, 0, 0))).toBeCloseTo(30, 4);
    expect(sampleTerrain(g, centre(g, 1, 1))).toBeCloseTo(29, 4);
    const mid = fromKorea2000(g.originX + 10, g.originY - 10); // between the four upper-left centres
    expect(sampleTerrain(g, mid)).toBeCloseTo((30 + 31 + 28 + 29) / 4, 4);
    expect(sampleTerrain(g, [127.05, 37.6])).toBeNull();
    expect(sampleTerrain(g, centre(g, 1.5, 1.5) as Position)).not.toBeNull();
  });
  it('the 3D ground is the height above the grid’s lowest point, and flat without a grid', () => {
    expect(terrainBase(g)).toBe(26);
    expect(groundOf(g)(centre(g, 0, 0))).toBeCloseTo(4, 4);
    expect(groundOf(null)([127, 37])).toBe(0);
  });
  it('the mesh is two triangles a cell (none over a gap) and the wire follows rows and columns', () => {
    const mesh = terrainMesh(g);
    expect(mesh).toHaveLength(2 * 4 - 2);
    expect(Math.min(...mesh.flatMap((t) => t.polygon.map((v) => v[2])))).toBeCloseTo(0, 6);
    const wire = terrainWire(g, 2);
    expect(wire.length).toBe(4);
    expect(wire.every((l) => l.length >= 2)).toBe(true);
  });
  it('a path laid on the ground gets a point every few metres, each a little above it', () => {
    const ground = groundOf(g);
    const path = drapePath([centre(g, 0, 0), centre(g, 2, 0)], ground, 4, 0.4);
    expect(path.length).toBe(1 + 4 + 1);
    expect(path[0]![2]).toBeCloseTo(ground(centre(g, 0, 0)) + 0.4, 6);
    expect(path.at(-1)![2]).toBeCloseTo(ground(centre(g, 2, 0)) + 0.4, 6);
  });
  it('a sample hill is there to try the view without any grid', () => {
    const s = sampleTerrainGrid([127.045, 37.557]);
    expect(s.source).toBe('sample');
    expect(sampleTerrain(s, [127.045, 37.557])).not.toBeNull();
  });
});

describe('floors and points of a building in 3D', () => {
  it('a building stands on the lowest ground under its ground floor; floors and basements stack from there', () => {
    const s = state();
    const a = Object.values(s.buildings).find((b) => b.id === 'bldg_A')!;
    const ground = (p: Position) => (p[0] - 127) * 10_000; // rises to the east
    const g = buildingGround(a, ground);
    expect(g).toBeCloseTo(Math.min(...a.polygon[0]!.map((p) => ground(p))), 9);
    const bases = floorBases({ ...a, props: { ...a.props, levels: [-1, ...a.props.levels] } }, ground);
    expect(bases.get(1)).toBeCloseTo(g, 9);
    expect(bases.get(2)).toBeCloseTo(g + 3.9, 9);
    expect(bases.get(-1)).toBeCloseTo(g - 3.9, 9);
    // Without terrain the ground is the map plane.
    expect(floorBases(a, () => 0).get(3)).toBeCloseTo(7.8, 9);
  });

  it('with plinth floors: terrain off keeps 1F on the map and B1 below; terrain on stacks B1, 1F… on the plinth block', () => {
    const s = state();
    const a = Object.values(s.buildings).find((b) => b.id === 'bldg_A')!;
    // Register: 7 floors; listed: B1, 1F–4F → 2 plinth floors.
    const b = { ...a, props: { ...a.props, levels: [-1, 1, 2, 3, 4], ext: { registry_floors: 7 } } };
    const flat = floorBases(b, () => 0);
    expect(flat.get(1)).toBeCloseTo(0, 9);
    expect(flat.get(-1)).toBeCloseTo(-3.9, 9);
    const ground = (p: Position) => (p[0] - 127) * 10_000;
    const g = buildingGround(b, ground);
    const onTerrain = floorBases(b, ground, undefined, 1, 'terrain');
    expect(onTerrain.get(-1)).toBeCloseTo(g + 7.8, 9);
    expect(onTerrain.get(1)).toBeCloseTo(g + 7.8 + 3.9, 9);
    // × the height exaggeration, plinth included.
    expect(floorBases(b, ground, undefined, 2, 'terrain').get(1)).toBeCloseTo(g + (7.8 + 3.9) * 2, 9);
  });

  it('indoor points sit on their floor, outdoor points on the ground; elevators and stairs between floors are upright lines', () => {
    const s = state();
    const z = nodeHeights(s, () => 0);
    expect(z.get('n_A_elevA_L1')).toBeCloseTo(0.3, 9);
    expect(z.get('n_A_elevA_L3')).toBeCloseTo(7.8 + 0.3, 9);
    expect(z.get('n_out_0002')).toBeCloseTo(0.4, 9);
    const segs = buildingSegments(s, 'bldg_A', 2, z);
    const lift = segs.filter((g) => g.kind === 'elevator');
    expect(lift.length).toBeGreaterThan(0);
    // Every elevator link is upright: the same spot at both ends, a different height.
    for (const l of lift) {
      expect(l.from[0]).toBeCloseTo(l.to[0], 9);
      expect(l.from[1]).toBeCloseTo(l.to[1], 9);
      expect(l.from[2]).not.toBeCloseTo(l.to[2], 3);
    }
    expect(segs.some((g) => g.kind === 'steps')).toBe(true);
    // Paths on the floor shown are strong, paths on other floors faint.
    const flat = segs.filter((g) => g.kind === 'flat');
    expect(flat.some((g) => g.strong && Math.abs(g.from[2] - (3.9 + 0.3)) < 1e-9)).toBe(true);
    expect(flat.some((g) => !g.strong)).toBe(true);
  });
});

describe('the dev server’s grid (campo-grid .json + .bin)', () => {
  const meta = { crs: 'EPSG:5186', origin_x: 200000, origin_y: 550000, res: 1, width: 4, height: 2, dtype: 'float32' as const, nodata: -9999 };
  it('reads float32 rows from the north, with no-data cells as null', () => {
    const f = new Float32Array([1, 2, 3, -9999, 5, 6, 7, 8]);
    const g = decodeGrid(meta, new Uint8Array(f.buffer), 'corrected');
    expect(g).toMatchObject({ source: 'corrected', width: 4, height: 2, res: 1, originX: 200000, originY: 550000 });
    expect(g.z).toEqual([1, 2, 3, null, 5, 6, 7, 8]);
  });
  it('thins a large grid, keeping cell centres in place, and reads uint16 with scale and offset', () => {
    const big = { ...meta, width: 6, height: 6 };
    const f = new Float32Array(36).map((_, i) => i);
    const g = decodeGrid(big, new Uint8Array(f.buffer), 'dem', 3);
    expect([g.width, g.height, g.res]).toEqual([3, 3, 2]);
    expect(g.z.slice(0, 3)).toEqual([0, 2, 4]);
    // The first centre stays where cell (0, 0)'s centre was.
    expect(g.originX + g.res / 2).toBe(200000.5);
    expect(g.originY - g.res / 2).toBe(549999.5);
    const u = new Uint16Array([0, 10, 65535, 20]);
    const q = decodeGrid({ ...meta, width: 2, height: 2, dtype: 'uint16', nodata: 65535, scale: 0.5, offset: 100 }, new Uint8Array(u.buffer), 'dem');
    expect(q.z).toEqual([100, 105, null, 110]);
    expect(() => decodeGrid({ ...meta, crs: 'EPSG:4326' }, new Uint8Array(f.buffer), 'dem')).toThrow('EPSG:5186');
  });
});
