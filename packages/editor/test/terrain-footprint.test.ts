// 평지 in 지형 3D, the exact way (model/terrainFootprint.ts terrainSurface, fineGround, plazaFootprints; map/deck3d.ts): the
// relief re-drawn at 1 m round each plaza and every vertex of every triangle that meets a plaza pressed to ≤ its plane − 2 cm,
// so the relief is never above the plane anywhere on its solid area (I5) and the plane is one flat sheet (I6).
import { describe, expect, it } from 'vitest';
import { framePlaza, localFrame, locateXY, type EditState, type Position } from '@campo/core';
import { TILE_MARGIN_M, terrainTiles, type TerrainTileJson } from '../server/terrain.ts';
import { deckLayers } from '../src/map/deck3d.ts';
import { coarseVertexXY } from '../src/model/gridXY.ts';
import {
  fromKorea2000, groundOf, plazaHeight, plazaSkirt, terrainBase, terrainMesh, toKorea2000, type PlazaFlat, type TerrainCell,
} from '../src/model/terrain3d.ts';
import { CARVE_GAP_M, fineGround, plazaFootprints, terrainSurface, type Footprint } from '../src/model/terrainFootprint.ts';
import { fixtureSession } from './fixture.ts';
import { L_HOLE, L_OUTER, bboxXY, coarseOf, pos, rawGrid, ringPos, rng, xy } from './terrainSynth.ts';

type XY = [number, number];

// ---- helpers, written apart from the code under test ----

/** Even–odd over every ring (the rings as the footprint has them, EPSG:5186 m). */
function inSolid(rings: readonly XY[][], p: XY): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i]!, ring[j]!];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
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

/** Points to check: random ones on the solid area, points on the rings (corners, middles, random), points 1 mm inside. */
function probePoints(rings: readonly XY[][], seed = 11): { solid: XY[]; ring: XY[]; inner: XY[] } {
  const rand = rng(seed);
  const all = rings.flat();
  const [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const solid: XY[] = [];
  while (solid.length < 20_000) {
    const p: XY = [x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0)];
    if (inSolid(rings, p)) solid.push(p);
  }
  const edges = rings.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]!] as [XY, XY])).filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
  const ring: XY[] = [];
  for (const [a, b] of edges) ring.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  while (ring.length < 2_000) {
    const [a, b] = edges[Math.floor(rand() * edges.length)]!;
    const t = rand();
    ring.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  const inner: XY[] = [];
  while (inner.length < 2_000) {
    const [a, b] = edges[Math.floor(rand() * edges.length)]!;
    const t = 0.001 + rand() * 0.998;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n: XY = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    const m: XY = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const q: XY = [m[0] + n[0] * 0.001, m[1] + n[1] * 0.001];
    inner.push(inSolid(rings, q) ? q : [m[0] - n[0] * 0.001, m[1] - n[1] * 0.001]);
  }
  return { solid, ring, inner };
}

function scene(cone: number, k: number) {
  const { bytes, g } = rawGrid(cone);
  const grid = coarseOf(bytes);
  const tiles = terrainTiles(g, grid, [{ kind: 'plaza', id: 'L', box: grow(bboxXY(L_OUTER)) }]);
  const rings = [ringPos(L_OUTER), ringPos(L_HOLE)];
  const H = plazaHeight(grid, { id: 'L', rings, h: null })!;
  const flat: PlazaFlat = { id: 'L', rings, z: (H - terrainBase(grid)) * k };
  return { g, grid, tiles, rings, H, flat, fps: plazaFootprints([flat]) };
}
const grow = (b: [number, number, number, number], m = TILE_MARGIN_M): [number, number, number, number] => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];

// ---- I5 ----

describe('plaza footprint: terrain never exceeds the plane (I5)', () => {
  const cases = [-0.5, 0, 0.5].flatMap((cone) => [0.5, 1, 2.5].map((k) => ({ cone, k })));
  it.each(cases)('ground cone $cone m/m (+ cut, − fill), 높이 과장 $k', ({ cone, k }) => {
    const { grid, tiles, flat, fps } = scene(cone, k);
    expect(fps).toHaveLength(1);
    expect(fps[0]!.zCap).toBe(flat.z);
    const s = terrainSurface(grid, tiles, k, fps);
    const zAt = meshIndex(s.cells);
    const pts = probePoints(fps[0]!.rings);
    const limit = flat.z - CARVE_GAP_M + 1e-9;
    let checked = 0;
    const bad: string[] = [];
    for (const [name, list] of Object.entries(pts)) {
      for (const p of list) {
        const z = zAt(p);
        if (z === null) continue;
        checked++;
        if (z > limit) bad.push(`${name} ${p[0].toFixed(3)},${p[1].toFixed(3)}: ${z} > ${limit}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(checked).toBe(24_000); // the relief is there under every point (nothing is left out under the plane)
    // The relief was pressed where it stood above the plane (a cut, or the up-slope half of the plain slope).
    if (cone >= 0) {
      expect(s.lowered).toBeGreaterThan(0);
      expect(s.maxLowerM).toBeGreaterThan(0);
    }
  });

  it('the plaza off the tiles (moved since the solve): pressed on the coarse cells, still never above the plane', () => {
    const { g, grid, flat, fps } = scene(0.5, 1);
    for (const tiles of [[], terrainTiles(g, grid, [{ kind: 'plaza', id: 'old', box: bboxXY([[150, 150], [215, 215]]) }])]) {
      const s = terrainSurface(grid, tiles, 1, fps);
      const zAt = meshIndex(s.cells);
      const { solid, ring, inner } = probePoints(fps[0]!.rings, 5);
      for (const p of [...solid.slice(0, 5000), ...ring, ...inner]) {
        const z = zAt(p);
        expect(z).not.toBeNull();
        expect(z!).toBeLessThanOrEqual(flat.z - CARVE_GAP_M + 1e-9);
      }
      expect(s.lowered).toBeGreaterThan(0);
    }
  });

  it('two footprints on one vertex: the lower cap wins', () => {
    const { grid } = scene(0, 1);
    const sq = (x0: number, y0: number, x1: number, y1: number): XY[] => [xy(x0, y0), xy(x1, y0), xy(x1, y1), xy(x0, y1)];
    const fps: Footprint[] = [
      { id: 'a', kind: 'plaza', rings: [sq(300.2, 300.2, 320.2, 320.2)], zCap: 30 },
      { id: 'b', kind: 'plaza', rings: [sq(315.2, 300.2, 340.2, 320.2)], zCap: -5 },
    ];
    const s = terrainSurface(grid, [], 1, fps);
    const zAt = meshIndex(s.cells);
    // The coarse vertex at (320.5, 310.5) belongs to triangles that meet both.
    const v = zAt(xy(320.5, 310.5))!;
    expect(v).toBeLessThanOrEqual(-5 - CARVE_GAP_M);
  });
});

// ---- I6 ----

const state = (): EditState => fixtureSession().history.current();
const deckInput = (sc: ReturnType<typeof scene>, k: number, tiles: readonly TerrainTileJson[], exactFootprints?: boolean) => ({
  state: state(), scope: { kind: 'outdoor' as const }, grid: sc.grid, terrain: true, buildings: false, measured: () => new Map(), exaggeration: k,
  routes: [], slopes: [], plazas: [{ id: 'L', rings: sc.rings }], plazaHeights: { L: sc.H }, tiles, ...(exactFootprints === undefined ? {} : { exactFootprints }),
});

describe('plaza plane is exactly flat (I6) and deck3d switches', () => {
  it('every vertex of plaza-surface has one z, the plane itself (no lift)', () => {
    for (const k of [0.5, 1, 2.5]) {
      const sc = scene(0.5, k);
      const layers = deckLayers(deckInput(sc, k, sc.tiles));
      const surface = layers.find((l) => l.id === 'plaza-surface')!;
      const data = surface.props.data as PlazaFlat[];
      const getPolygon = (surface.props as unknown as { getPolygon: (f: PlazaFlat) => [number, number, number][][] }).getPolygon;
      const zs = new Set(data.flatMap((f) => getPolygon(f).flat().map((v) => v[2])));
      expect(zs.size).toBe(1);
      expect([...zs][0]).toBe(sc.flat.z);
    }
  });

  it('the layer ids stay; terrain-mesh is terrainSurface; exactFootprints: false is the old mesh (clamp + lift) exactly', () => {
    const sc = scene(0.5, 1);
    const exact = deckLayers(deckInput(sc, 1, sc.tiles));
    const old = deckLayers(deckInput(sc, 1, sc.tiles, false));
    expect(exact.map((l) => l.id)).toEqual(old.map((l) => l.id));
    for (const id of ['terrain-mesh', 'terrain-wire', 'plaza-skirt', 'plaza-surface', 'plaza-outline']) expect(exact.map((l) => l.id)).toContain(id);
    const mesh = (ls: typeof exact) => ls.find((l) => l.id === 'terrain-mesh')!.props.data as TerrainCell[];
    expect(mesh(exact)).toEqual(terrainSurface(sc.grid, sc.tiles, 1, sc.fps).cells);
    expect(mesh(old)).toEqual(terrainMesh(sc.grid, 1, 1, undefined, [sc.flat]));
    const surf = old.find((l) => l.id === 'plaza-surface')!;
    const z = (surf.props as unknown as { getPolygon: (f: PlazaFlat) => [number, number, number][][] }).getPolygon((surf.props.data as PlazaFlat[])[0]!)[0]![0]![2];
    expect(z).toBeCloseTo(sc.flat.z + 0.03, 12);
    // No tiles in the answer (an older server): the same carve on the coarse cells.
    expect(mesh(deckLayers(deckInput(sc, 1, [])))).toEqual(terrainSurface(sc.grid, [], 1, sc.fps).cells);
  });

  it('the wire does not run over the plaza (tiled or only pressed on the coarse cells)', () => {
    const sc = scene(0.5, 1);
    for (const tiles of [sc.tiles, []]) {
      const wire = deckLayers(deckInput(sc, 1, tiles)).find((l) => l.id === 'terrain-wire')!.props.data as [number, number, number][][];
      expect(wire.length).toBeGreaterThan(0);
      for (const line of wire) {
        for (let i = 1; i < line.length; i++) {
          const [a, b] = [toKorea2000([line[i - 1]![0], line[i - 1]![1]]), toKorea2000([line[i]![0], line[i]![1]])];
          expect(inSolid(sc.fps[0]!.rings, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])).toBe(false);
        }
      }
    }
  });

  it('no plaza: the mesh is the plain one whatever the tiles', () => {
    const sc = scene(0, 1);
    const layers = deckLayers({ ...deckInput(sc, 1, sc.tiles), plazas: [] });
    expect(layers.find((l) => l.id === 'terrain-mesh')!.props.data).toEqual(terrainMesh(sc.grid, 1, 1, undefined, []));
  });
});

// ---- holes, no footprint, watertight ----

describe('holes are not covered', () => {
  it('a vertex well inside the hole keeps its height; triangles over the hole edge are pressed', () => {
    const sc = scene(0, 1);
    // A plane under all of it, so every triangle that meets the solid area must go down.
    const low: PlazaFlat = { ...sc.flat, z: -3 };
    const fps = plazaFootprints([low]);
    const before = terrainSurface(sc.grid, sc.tiles, 1, []);
    const after = terrainSurface(sc.grid, sc.tiles, 1, fps);
    const zAt0 = meshIndex(before.cells);
    const zAt1 = meshIndex(after.cells);
    // The hole is 208.3 … 219.7 × 208.2 … 219.6 m; the 1 m triangles round its middle (212 … 216) are 3 m off its edge.
    for (let x = 212; x <= 216; x += 0.25) {
      for (let y = 212; y <= 216; y += 0.25) expect(zAt1(xy(x, y))).toBe(zAt0(xy(x, y)));
    }
    // Just inside the hole, in a triangle that the hole's edge crosses (the 1 m lattice is on the half metres): pressed.
    for (const p of [xy(208.4, 214), xy(214, 219.55), xy(219.6, 210)]) expect(zAt1(p)!).toBeLessThanOrEqual(-3 - CARVE_GAP_M + 1e-9);
    expect(after.lowered).toBeGreaterThan(0);
  });
});

describe('no footprint equals terrainMesh', () => {
  it('cells identical (count and every vertex), with and without skipped cells; nothing lowered', () => {
    const { grid } = scene(0, 1);
    for (const k of [0.5, 1, 2.5]) {
      const s = terrainSurface(grid, [], k, []);
      expect(s.cells).toEqual(terrainMesh(grid, 1, k));
      expect(s.lowered).toBe(0);
      expect(s.maxLowerM).toBe(0);
    }
    const skip = new Set([5 * grid.width + 7, 30 * grid.width + 30]);
    expect(terrainSurface(grid, [], 1, [], skip).cells).toEqual(terrainMesh(grid, 1, 1, skip));
  });
});

describe('tiles are watertight in the drawn mesh, before and after the carve', () => {
  it.each([0.5, -0.5])('cone %s: one z per drawn point; a tile edge with no tile beside it lies on the coarse edge', (cone) => {
    const sc = scene(cone, 1);
    for (const fps of [[], sc.fps]) {
      const s = terrainSurface(sc.grid, sc.tiles, 1, fps);
      const zOf = new Map<string, number>();
      for (const c of s.cells) {
        for (const [lng, lat, z] of c.polygon) {
          const key = `${lng},${lat}`;
          const seen = zOf.get(key);
          if (seen !== undefined) expect(z).toBe(seen);
          else zOf.set(key, z);
        }
      }
      const tiled = new Set(sc.tiles.map((t) => t.r * sc.grid.width + t.c));
      const keyAt = (r: number, c: number) => fromKorea2000(...coarseVertexXY(sc.grid, r, c)).join(',');
      let checked = 0;
      for (const t of sc.tiles) {
        const sides: [number, number, (q: number) => [number, number]][] = [
          [-1, 0, (q) => [t.r, t.c + q]], [1, 0, (q) => [t.r + 1, t.c + q]], [0, -1, (q) => [t.r + q, t.c]], [0, 1, (q) => [t.r + q, t.c + 1]],
        ];
        for (const [dr, dc, at] of sides) {
          if (tiled.has((t.r + dr) * sc.grid.width + t.c + dc)) continue;
          const [z0, z1] = [zOf.get(keyAt(...at(0))), zOf.get(keyAt(...at(1)))];
          expect(z0).toBeDefined();
          expect(z1).toBeDefined();
          for (let q = 1; q < t.sub; q++) {
            const z = zOf.get(keyAt(...at(q / t.sub)));
            expect(z).toBeDefined();
            expect(Math.abs(z! - (z0! + (z1! - z0!) * (q / t.sub)))).toBeLessThanOrEqual(1e-9);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(100);
    }
  });
});

// ---- the skirt, fineGround ----

describe('fineGround and the skirt', () => {
  it('fineGround: the tile inside a tiled cell (bilinear), the coarse relief elsewhere', () => {
    const sc = scene(0, 1);
    const fine = fineGround(sc.grid, sc.tiles, 1);
    const coarse = groundOf(sc.grid, 1);
    const base = terrainBase(sc.grid);
    const t = sc.tiles[Math.floor(sc.tiles.length / 2)]!;
    const n = t.sub + 1;
    for (const [i, j] of [[2, 3], [7, 7], [4, 9]] as const) {
      const p = fromKorea2000(...coarseVertexXY(sc.grid, t.r + i / t.sub, t.c + j / t.sub));
      // (to 0.1 mm: [lng, lat] → EPSG:5186 moves a point by ≈ 10 µm, and the noise is steep between 1 m samples)
      expect(fine(p)).toBeCloseTo((t.z[i * n + j]! - base), 4);
    }
    const out: Position = pos(30, 30);
    expect(fine(out)).toBe(coarse(out));
    expect(fineGround(null, [], 1)(out)).toBe(0);
    expect(fineGround(sc.grid, [], 2)(pos(222, 222))).toBe(groundOf(sc.grid, 2)(pos(222, 222)));
  });

  it('skirt reaches the true ground: on the fill side its foot is fineGround − 0.2 m, read 0.6 m out', () => {
    const sc = scene(-0.5, 1);
    const fine = fineGround(sc.grid, sc.tiles, 1);
    const coarse = groundOf(sc.grid, 1);
    const skirts = plazaSkirt(sc.flat, fine);
    expect(skirts.length).toBeGreaterThan(50);
    // plazaSkirt works in the plaza's own local frame (core framePlaza / localFrame): read the probe point the same way.
    const framed = framePlaza(sc.flat.rings);
    const frame = localFrame(framed.positions[0]![0]!);
    let differs = 0;
    for (const q of skirts) {
      const [a, b] = [frame.toXY([q.polygon[0]![0], q.polygon[0]![1]]), frame.toXY([q.polygon[1]![0], q.polygon[1]![1]])];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let n: XY = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      const mid: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (locateXY(framed.rings, [mid[0] + n[0] * 0.3, mid[1] + n[1] * 0.3]) === 'solid') n = [-n[0], -n[1]];
      const probe = frame.toPos(a[0] + n[0] * 0.6, a[1] + n[1] * 0.6);
      const want = Math.min(sc.flat.z, fine(probe)) - 0.2;
      expect(Math.abs(q.polygon[3]![2] - want)).toBeLessThanOrEqual(1e-3);
      if (Math.abs(q.polygon[3]![2] - (Math.min(sc.flat.z, coarse(probe)) - 0.2)) > 1e-3) differs++;
    }
    expect(differs).toBeGreaterThan(skirts.length / 2); // it is the 1 m ground, not the 10 m one
    // A plaza sunk in a cut has no skirt at all.
    const cut = scene(0.5, 1);
    expect(plazaSkirt({ ...cut.flat, z: cut.flat.z - 30 }, fineGround(cut.grid, cut.tiles, 1))).toEqual([]);
  });
});

// ---- performance ----

describe('performance', () => {
  it('terrainSurface on 5 plazas with ≈ 100,000 tile triangles: target ≤ 500 ms, fails over 1,500 ms', () => {
    const { bytes, g } = rawGrid(0.2, [300, 300]);
    const grid = coarseOf(bytes);
    const squares: [number, number][][] = [[40.3, 40.7], [300.3, 40.7], [40.3, 300.7], [300.3, 300.7], [170.3, 470.7]].map(([x, y]) =>
      [[x!, y!], [x! + 70, y!], [x! + 70, y! + 70], [x!, y! + 70]]);
    const holes: [number, number][][] = squares.map((s) => [[s[0]![0] + 30, s[0]![1] + 30], [s[0]![0] + 40, s[0]![1] + 30], [s[0]![0] + 40, s[0]![1] + 40], [s[0]![0] + 30, s[0]![1] + 40]]);
    const tiles = terrainTiles(g, grid, squares.map((s, i) => ({ kind: 'plaza', id: `p${i}`, box: grow(bboxXY(s)) })));
    const tileTris = tiles.reduce((s, t) => s + 2 * t.sub * t.sub, 0);
    expect(tileTris).toBeGreaterThanOrEqual(90_000);
    const base = terrainBase(grid);
    const flats: PlazaFlat[] = squares.map((s, i) => {
      const rings = [ringPos(s), ringPos(holes[i]!)];
      return { id: `p${i}`, rings, z: plazaHeight(grid, { id: `p${i}`, rings, h: null })! - base };
    });
    const fps = plazaFootprints(flats);
    terrainSurface(grid, tiles, 1, fps); // warm-up (JIT)
    const runs: number[] = [];
    let s = terrainSurface(grid, tiles, 1, fps);
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      s = terrainSurface(grid, tiles, 1, fps);
      runs.push(performance.now() - t0);
    }
    const ms = Math.min(...runs);
    console.log(`[perf] terrainSurface: ${ms.toFixed(1)} ms (best of 3; ${runs.map((r) => r.toFixed(0)).join(', ')}), tiles ${tiles.length}, tile triangles ${tileTris}, `
      + `drawn triangles ${s.cells.length}, lowered ${s.lowered} vertices, max ${s.maxLowerM.toFixed(3)} m, /terrain tiles JSON ${(JSON.stringify(tiles).length / 1e6).toFixed(2)} MB`);
    expect(ms).toBeLessThanOrEqual(1500);
  });
});
