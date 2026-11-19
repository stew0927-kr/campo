// 길 리본 (model/roadRibbon.ts; map/deck3d.ts roadRender): every road the solver fixed (solve_report roads[]) drawn as its
// own surface, width_m wide, level across its width (I7), with the solver's own plan shape and heights (I8).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EditState } from '@campo/core';
import { deckLayers } from '../src/map/deck3d.ts';
import { CAP_STEPS, RIBBON_PIECE_M, corridorZ, roadPieces, type RibbonPiece, type RoadSegmentJson } from '../src/model/roadRibbon.ts';
import { fixtureSession } from './fixture.ts';
import { manyRoads, road } from './roadSynth.ts';
import { roadTileAreas, terrainTiles } from '../server/terrain.ts';
import { coarseOf, rawGrid } from './terrainSynth.ts';

type XY = [number, number];
type Seg = RoadSegmentJson['segments'][number];

// ---- helpers, written apart from the code under test ----

/** Even–odd: is p inside the polygon (plan)? */
function inPolygon(poly: readonly XY[], p: XY): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i]!, poly[j]!];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** z at plan point p on the plane through a piece's plan vertices and its display z (the first three that span it). */
function planeZ(piece: RibbonPiece, p: XY): number {
  const v = piece.plan.map((q, i) => [q[0], q[1], piece.polygon[i]![2]] as [number, number, number]);
  const [a] = v;
  for (let i = 1; i < v.length; i++) {
    for (let j = i + 1; j < v.length; j++) {
      const [b, c] = [v[i]!, v[j]!];
      const det = (b[0] - a![0]) * (c[1] - a![1]) - (c[0] - a![0]) * (b[1] - a![1]);
      if (Math.abs(det) < 1e-6) continue;
      const u = ((p[0] - a![0]) * (c[1] - a![1]) - (c[0] - a![0]) * (p[1] - a![1])) / det;
      const w = ((b[0] - a![0]) * (p[1] - a![1]) - (p[0] - a![0]) * (b[1] - a![1])) / det;
      return a![2] + u * (b[2] - a![2]) + w * (c[2] - a![2]);
    }
  }
  throw new Error('degenerate piece');
}

/** Residual of the 4th vertex of a quad off the plane of the first three (plan relative to the first vertex). */
function planeResidual(piece: RibbonPiece): number {
  const o = piece.plan[0]!;
  const v = piece.plan.map((q, i) => [q[0] - o[0], q[1] - o[1], piece.polygon[i]![2]] as [number, number, number]);
  const [a, b, c, d] = v as [number, number, number][];
  const u = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const w = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
  const len = Math.hypot(n[0]!, n[1]!, n[2]!);
  return Math.abs(n[0]! * (d![0] - a![0]) + n[1]! * (d![1] - a![1]) + n[2]! * (d![2] - a![2])) / len;
}

const rot = (p: XY, deg: number): XY => {
  const a = (deg * Math.PI) / 180;
  return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
};
const strips = (ps: readonly RibbonPiece[]) => ps.filter((p) => p.kind === 'strip');
const caps = (ps: readonly RibbonPiece[]) => ps.filter((p) => p.kind === 'cap');

// 한양대 plan coordinates (EPSG:5186): real-sized numbers, for the tests that do not need 1e-12 in the plan itself.
const HX = 203_900;
const HY = 551_000;

// ---- I7 ----

describe('strip is planar and level across its width (I7)', () => {
  it('(0, 0, 30) → (10, 0, 31), 2 m: five 2 m strips at (2i, ±1) … (2i + 2, ±1), z 30 + 0.2·i to 30 + 0.2·(i + 1)', () => {
    expect(RIBBON_PIECE_M).toBe(2);
    const ps = roadPieces([road('r', 2, [[0, 0, 30, 10, 0, 31]])], 0, 1);
    const ss = strips(ps);
    expect(ss).toHaveLength(5);
    ss.forEach((s, i) => {
      expect(s.edgeId).toBe('r');
      expect(s.plan).toHaveLength(4);
      const want: XY[] = [[2 * i, 1], [2 * i + 2, 1], [2 * i + 2, -1], [2 * i, -1]];
      for (const w of want) expect(s.plan.some((q) => Math.abs(q[0] - w[0]) < 1e-12 && Math.abs(q[1] - w[1]) < 1e-12)).toBe(true);
      const zAt = (x: number) => s.polygon.filter((_, j) => Math.abs(s.plan[j]![0] - x) < 1e-12).map((v) => v[2]);
      const [za, zb] = [zAt(2 * i), zAt(2 * i + 2)];
      expect(za).toHaveLength(2);
      expect(zb).toHaveLength(2);
      expect(za[0]).toBe(za[1]); // left and right: the very same number
      expect(zb[0]).toBe(zb[1]);
      expect(Math.abs(za[0]! - (30 + 0.2 * i))).toBeLessThan(1e-12);
      expect(Math.abs(zb[0]! - (30 + 0.2 * (i + 1)))).toBeLessThan(1e-12);
      expect(s.zMin).toBe(Math.min(za[0]!, zb[0]!));
      expect(s.polygon.map((v) => v[2]).length).toBe(4);
    });
  });

  it.each([0, 30, 45, 90, 135])('turned %i°: every strip is a plane (residual ≤ 1e-12) and level across its width (difference exactly 0)', (deg) => {
    const [a, b] = [rot([0, 0], deg), rot([10, 0], deg)];
    const ps = roadPieces([road('r', 2, [[a[0], a[1], 30, b[0], b[1], 31]])], 0, 1);
    const ss = strips(ps);
    expect(ss).toHaveLength(5);
    const along: XY = [b[0] - a[0], b[1] - a[1]];
    for (const s of ss) {
      expect(planeResidual(s)).toBeLessThanOrEqual(1e-12);
      // The two corners at one station (the same distance along the axis) have the same z, exactly.
      const station = s.plan.map((q) => Math.round(((q[0] - a[0]) * along[0] + (q[1] - a[1]) * along[1]) / 10 * 1e6) / 1e6);
      const groups = new Map<number, number[]>();
      station.forEach((t, j) => groups.set(t, [...(groups.get(t) ?? []), s.polygon[j]![2]]));
      expect(groups.size).toBe(2);
      for (const zs of groups.values()) {
        expect(zs).toHaveLength(2);
        expect(zs[0]! - zs[1]!).toBe(0);
      }
    }
    // 높이 과장 and the grid's lowest point: z = (h − base) × k, still level across.
    for (const s of strips(roadPieces([road('r', 2, [[a[0], a[1], 30, b[0], b[1], 31]])], 25, 2.5))) {
      expect(planeResidual(s)).toBeLessThanOrEqual(1e-12);
      expect(Math.min(...s.polygon.map((v) => v[2]))).toBeGreaterThanOrEqual((30 - 25) * 2.5 - 1e-12);
    }
  });

  it('a segment of any length is cut into pieces of at most RIBBON_PIECE_M, all the same length', () => {
    for (const len of [0.7, 2, 2.0001, 9.3, 31]) {
      const ss = strips(roadPieces([road('r', 2, [[0, 0, 10, len, 0, 12]])], 0, 1));
      expect(ss).toHaveLength(Math.max(1, Math.ceil(len / RIBBON_PIECE_M - 1e-9)));
      for (const s of ss) {
        const xs = s.plan.map((q) => q[0]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(RIBBON_PIECE_M + 1e-12);
        expect(Math.abs(Math.max(...xs) - Math.min(...xs) - len / ss.length)).toBeLessThan(1e-12);
      }
    }
  });
});

describe('width is exact', () => {
  it.each([1, 2, 3.5, 20])('%f m: the left and right corners are width_m apart (1e-12; 1e-9 at 한양대 coordinates)', (w) => {
    for (const [ox, oy, tol] of [[0, 0, 1e-12], [HX, HY, 1e-9]] as const) {
      const [a, b] = [rot([3, 1], 30), rot([17, 1], 30)];
      for (const s of strips(roadPieces([road('r', w, [[ox + a[0], oy + a[1], 30, ox + b[0], oy + b[1], 31]])], 0, 1))) {
        // corners: 0 and 3 at the start station, 1 and 2 at the end one (left, then right)
        expect(Math.abs(Math.hypot(s.plan[0]![0] - s.plan[3]![0], s.plan[0]![1] - s.plan[3]![1]) - w)).toBeLessThan(tol);
        expect(Math.abs(Math.hypot(s.plan[1]![0] - s.plan[2]![0], s.plan[1]![1] - s.plan[2]![1]) - w)).toBeLessThan(tol);
      }
    }
  });
});

describe('cap is flat at the end height', () => {
  it('a free end: a half disc of radius width_m / 2 in CAP_STEPS steps, every vertex at the end z', () => {
    expect(CAP_STEPS).toBe(8);
    const ps = roadPieces([road('r', 3, [[0, 0, 30, 10, 0, 31]])], 0, 1);
    const cs = caps(ps);
    expect(cs).toHaveLength(2);
    for (const [end, z] of [[[0, 0], 30], [[10, 0], 31]] as [XY, number][]) {
      const c = cs.find((q) => q.polygon.every((v) => v[2] === z))!;
      expect(c).toBeDefined();
      expect(c.zMin).toBe(z);
      expect(c.plan).toHaveLength(CAP_STEPS + 1);
      for (const q of c.plan) expect(Math.abs(Math.hypot(q[0] - end[0], q[1] - end[1]) - 1.5)).toBeLessThan(1e-12);
      // outward: beyond the end, never over the strip
      const out = end[0] === 0 ? -1 : 1;
      for (const q of c.plan) expect((q[0] - end[0]) * out).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('a bend: the outer gap is filled at the joint z (a wedge of radius width_m / 2); a straight joint needs none', () => {
    const bent = roadPieces([road('r', 2, [[0, 0, 30, 10, 0, 31], [10, 0, 31, 10, 10, 33]])], 0, 1);
    const joint = caps(bent).filter((c) => c.polygon.every((v) => v[2] === 31));
    expect(joint).toHaveLength(1);
    // The wedge: the joint and an arc on the outer side (here the right of the way east then north: x > 10, y < 0).
    for (const q of joint[0]!.plan) {
      const r = Math.hypot(q[0] - 10, q[1]);
      expect(r < 1e-12 || Math.abs(r - 1) < 1e-12).toBe(true);
      expect(q[0]).toBeGreaterThanOrEqual(10 - 1e-12);
      expect(q[1]).toBeLessThanOrEqual(1e-12);
    }
    const straight = roadPieces([road('r', 2, [[0, 0, 30, 10, 0, 31], [10, 0, 31, 20, 0, 32]])], 0, 1);
    expect(caps(straight).filter((c) => c.polygon.every((v) => v[2] === 31))).toHaveLength(0);
    expect(caps(straight)).toHaveLength(2);
  });
});

// ---- I8: the solver's twin ----

interface Twin {
  res: number;
  roads: RoadSegmentJson[];
  points: { x: number; y: number; z: number | null; seg: number | null }[];
}
const twin = JSON.parse(readFileSync(new URL('./fixtures/road-twin.json', import.meta.url), 'utf8')) as Twin;

describe('ribbon z matches the solver twin (I8)', () => {
  const segs = twin.roads.flatMap((r) => r.segments.map((s) => ({ s, w: r.width_m })));

  it('corridorZ gives rasterize_corridors\' own numbers at 1,000 cell centres (fixture from tools/elevation)', () => {
    expect(twin.points).toHaveLength(1000);
    let road = 0;
    const bad: string[] = [];
    for (const p of twin.points) {
      const z = corridorZ(twin.roads, p.x, p.y);
      if (p.z === null) {
        if (z !== null) bad.push(`${p.x},${p.y}: ${z} off the corridor`);
        continue;
      }
      road++;
      if (z === null || Math.abs(z - p.z) > 1e-12) bad.push(`${p.x},${p.y}: ${z} ≠ ${p.z}`);
      // By hand, the solver's formula on the segment it chose: t clamped to [0, 1], (1 − t)·z0 + t·z1.
      const [x0, y0, z0, x1, y1, z1] = segs[p.seg!]!.s;
      const [vx, vy] = [x1 - x0, y1 - y0];
      const t = Math.min(1, Math.max(0, ((p.x - x0) * vx + (p.y - y0) * vy) / (vx * vx + vy * vy)));
      if (Math.abs((1 - t) * z0 + t * z1 - p.z) > 1e-12) bad.push(`${p.x},${p.y}: by hand ${(1 - t) * z0 + t * z1} ≠ ${p.z}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(road).toBe(700);
  });

  it('a point in a piece of the segment the solver chose (or in a cap) is at the solver\'s z on that piece\'s plane (1e-9)', () => {
    const ps = roadPieces(twin.roads, 0, 1);
    // Each piece's segment, numbered as the fixture numbers them (roads in order, their segments in order).
    expect(ps.every((p) => Number.isInteger(p.seg) && p.seg >= 0 && p.seg < segs.length)).toBe(true);
    const sagitta = Math.max(...twin.roads.map((r) => (r.width_m / 2) * (1 - Math.cos(Math.PI / (2 * CAP_STEPS)))));
    let compared = 0;
    let uncovered = 0;
    const bad: string[] = [];
    for (const p of twin.points) {
      if (p.z === null) continue;
      const q: XY = [p.x, p.y];
      const holders = ps.filter((pc) => inPolygon(pc.plan, q));
      if (holders.length === 0) {
        // Only where the cap's arc (CAP_STEPS chords) cuts inside the solver's circle: within the sagitta of the edge.
        const { s, w } = segs[p.seg!]!;
        const [vx, vy] = [s[3] - s[0], s[4] - s[1]];
        const t = Math.min(1, Math.max(0, ((p.x - s[0]) * vx + (p.y - s[1]) * vy) / (vx * vx + vy * vy)));
        const d = Math.hypot(p.x - (s[0] + t * vx), p.y - (s[1] + t * vy));
        if (w / 2 - d > sagitta + 1e-9) bad.push(`${p.x},${p.y}: in no piece, ${w / 2 - d} m inside`);
        uncovered++;
        continue;
      }
      for (const pc of holders) {
        if (pc.seg !== p.seg && pc.kind !== 'cap') continue; // an inner overlap: the solver took the other segment there
        compared++;
        const z = planeZ(pc, q);
        if (Math.abs(z - p.z) > 1e-9) bad.push(`${p.x},${p.y} (${pc.kind} of ${pc.seg}): ${z} ≠ ${p.z}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(compared).toBeGreaterThanOrEqual(690);
    expect(uncovered).toBeLessThanOrEqual(10);
  });

  it('off every corridor: null; no roads: null', () => {
    expect(corridorZ(twin.roads, 0, 0)).toBeNull();
    expect(corridorZ([], twin.points[0]!.x, twin.points[0]!.y)).toBeNull();
  });
});

// ---- size and time ----

describe('ribbon count and size', () => {
  it('139 roads, ≈ 2,000 segments: roadPieces target ≤ 200 ms (fails over 600 ms), strips ≤ segments, pieces ≤ 2,000 + caps', () => {
    const roads = manyRoads();
    const nSeg = roads.reduce((s, r) => s + r.segments.length, 0);
    expect(nSeg).toBeGreaterThan(1800);
    expect(nSeg).toBeLessThan(2200);
    roadPieces(roads, 0, 1); // warm-up (JIT)
    const runs: number[] = [];
    let ps: RibbonPiece[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      ps = roadPieces(roads, 0, 1);
      runs.push(performance.now() - t0);
    }
    const ms = Math.min(...runs);
    const nCaps = caps(ps).length;
    console.log(`[perf] roadPieces: ${ms.toFixed(1)} ms (best of 3), ${roads.length} roads, ${nSeg} segments, ${strips(ps).length} strips, ${nCaps} caps`);
    expect(strips(ps).length).toBeLessThanOrEqual(nSeg);
    expect(ps.length).toBeLessThanOrEqual(Math.max(2000, nSeg) + nCaps);
    expect(nCaps).toBeLessThanOrEqual(2 * nSeg);
    expect(ms).toBeLessThanOrEqual(600);
  });
});

// ---- deck3d: roadRender ----

const state = (): EditState => fixtureSession().history.current();

describe('roadRender in deckLayers', () => {
  // A road across the synthetic relief (grid metres from its north-west corner: x east, y south).
  const { bytes, g } = rawGrid(0);
  const grid = coarseOf(bytes);
  const OX = 203_900;
  const OY = 551_000;
  const roads: RoadSegmentJson[] = [road('e_any', 2, [[OX + 100.3, OY - 300.2, 80, OX + 160.7, OY - 290.1, 95], [OX + 160.7, OY - 290.1, 95, OX + 220.4, OY - 330.9, 110]])];
  const tiles = terrainTiles(g, grid, roadTileAreas(roads));
  const input = (extra: object) => ({
    state: state(), scope: { kind: 'outdoor' as const }, grid, terrain: true, buildings: false, measured: () => new Map(), exaggeration: 1,
    routes: [], slopes: [], ...extra,
  });
  const ids = (extra: object) => deckLayers(input(extra)).map((l) => l.id);
  const RIBBON = ['road-ribbon', 'road-edge', 'road-skirt'];

  it('ribbon (the default with roads and tiles): road-ribbon, road-edge, road-skirt instead of terrain-paths-casing / terrain-paths', () => {
    for (const extra of [{ roads, tiles }, { roads, tiles, roadRender: 'ribbon' }, { roads, roadRender: 'ribbon' }]) {
      const got = ids(extra);
      for (const id of RIBBON) expect(got).toContain(id);
      expect(got).not.toContain('terrain-paths');
      expect(got).not.toContain('terrain-paths-casing');
      // the ribbon is drawn after the relief and the plazas, before the routes
      expect(got.indexOf('road-ribbon')).toBeGreaterThan(got.indexOf('terrain-mesh'));
    }
  });

  it('path-meters: terrain-paths in metres (width_m, flat to the ground, rounded), no casing', () => {
    const layers = deckLayers(input({ roads, tiles, roadRender: 'path-meters' }));
    const got = layers.map((l) => l.id);
    expect(got).toContain('terrain-paths');
    expect(got).not.toContain('terrain-paths-casing');
    for (const id of RIBBON) expect(got).not.toContain(id);
    const p = layers.find((l) => l.id === 'terrain-paths')!.props as unknown as {
      widthUnits: string; billboard: boolean; capRounded: boolean; jointRounded: boolean; getWidth: (d: unknown) => number; data: unknown[];
    };
    expect(p.widthUnits).toBe('meters');
    expect(p.billboard).toBe(false);
    expect(p.capRounded && p.jointRounded).toBe(true);
    expect(p.data.length).toBeGreaterThan(0);
    expect(p.getWidth(p.data[0])).toBe(2);
  });

  it('path-pixels (the default without roads or without tiles): the layers of today', () => {
    const today = ids({});
    expect(today).toContain('terrain-paths-casing');
    expect(today).toContain('terrain-paths');
    for (const id of RIBBON) expect(today).not.toContain(id);
    expect(ids({ roads, tiles, roadRender: 'path-pixels' })).toEqual(today);
    expect(ids({ roads })).toEqual(today); // roads but no tiles
    expect(ids({ roads: [], tiles })).toEqual(today);
  });

  it('an older solve (/terrain without roads): no error and the layer list of today', () => {
    const old = input({ tiles: [] }) as Parameters<typeof deckLayers>[0];
    expect(() => deckLayers(old)).not.toThrow();
    expect(deckLayers(old).map((l) => l.id)).toEqual(ids({}));
  });

  it('the ribbon presses the relief: terrain-mesh is the carved surface (and exactFootprints: false keeps the old mesh and paths)', () => {
    const layers = deckLayers(input({ roads, tiles }));
    const plain = deckLayers(input({}));
    const mesh = (ls: typeof layers) => ls.find((l) => l.id === 'terrain-mesh')!.props.data as { polygon: [number, number, number][] }[];
    expect(mesh(layers)).not.toEqual(mesh(plain));
    expect(ids({ roads, tiles, exactFootprints: false })).toEqual(ids({}));
  });
});
