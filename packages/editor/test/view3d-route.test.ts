// 높이 과장, 경로 테스트 in 3D and the relief under the cursor (model/terrain3d.ts, map/deck3d.ts).
import { describe, expect, it } from 'vitest';
import { WebMercatorViewport } from '@deck.gl/core';
import { buildingById, type EditState, type Position } from '@campo/core';
import {
  EXAGGERATION_MAX, EXAGGERATION_MIN, ROUTE_LIFT_M, clampExaggeration, floorBases, fromKorea2000, groundOf, nodeHeights, pickSurface,
  routePath3D, terrainMesh, terrainTop, toKorea2000, type TerrainGrid,
} from '../src/model/terrain3d.ts';
import { deckLayers } from '../src/map/deck3d.ts';
import { fixtureSession } from './fixture.ts';

const state = (): EditState => fixtureSession().history.current();

/** A plane rising to the east: 1 m every 10 m, from 20 m, cell centres on whole metres around `at`. */
function slopeGrid(at: Position, n = 40, res = 5): TerrainGrid {
  const [x, y] = toKorea2000(at);
  const z: number[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) z.push(20 + (c * res) / 10);
  return { source: 'corrected', crs: 'EPSG:5186', originX: Math.round(x) - (n / 2) * res, originY: Math.round(y) + (n / 2) * res, res, width: n, height: n, z };
}
const centre = (g: TerrainGrid, c: number, r: number): Position => fromKorea2000(g.originX + (c + 0.5) * g.res, g.originY - (r + 0.5) * g.res);

describe('높이 과장', () => {
  it('is kept between its bounds in steps of 0.1, and 1 when what was typed is not a number', () => {
    expect(clampExaggeration(2.345)).toBe(2.3);
    expect(clampExaggeration(0.1)).toBe(EXAGGERATION_MIN);
    expect(clampExaggeration(99)).toBe(EXAGGERATION_MAX);
    expect([EXAGGERATION_MIN, EXAGGERATION_MAX]).toEqual([0.5, 2.5]);
    expect(clampExaggeration(2.6)).toBe(2.5);
    expect(clampExaggeration(2.5)).toBe(2.5);
    expect(clampExaggeration(Number('abc'))).toBe(1);
  });
  it('multiplies the relief, its mesh and the floors by the same factor', () => {
    const g = slopeGrid([127.045, 37.557]);
    const p = centre(g, 10, 10);
    expect(groundOf(g, 3)(p)).toBeCloseTo(groundOf(g)(p) * 3, 6);
    expect(Math.max(...terrainMesh(g, 1, 2).flatMap((t) => t.polygon.map((v) => v[2])))).toBeCloseTo(terrainTop(g) * 2, 6);
    const s = state();
    const a = buildingById(s, 'bldg_A')!;
    expect(floorBases(a, () => 0, undefined, 2).get(2)).toBeCloseTo(3.9 * 2, 9);
    expect(nodeHeights(s, () => 0, () => new Map(), 2).get('n_A_elevA_L3')).toBeCloseTo(7.8 * 2 + 0.3, 9);
  });
});

describe('a route in 3D', () => {
  it('outdoors it follows the relief; indoors it stands on the floor of each point; a picked end on the floor it was picked in', () => {
    const s = state();
    const ground = (p: Position) => (p[0] - 127) * 10_000;
    const floorZ = (b: string, level: number) => floorBases(buildingById(s, b)!, ground).get(level);
    const out = [s.nodes.n_out_0002!, s.nodes.n_out_0003 ?? Object.values(s.nodes).find((n) => n.props.building_id === null && n.id !== 'n_out_0002')!];
    const path = routePath3D(s, out.map((n) => n.coord), out.map((n) => ({ node: n.id })), ground, floorZ);
    expect(path.length).toBeGreaterThanOrEqual(2);
    for (const v of path) expect(v[2]).toBeCloseTo(ground([v[0], v[1]]) + ROUTE_LIFT_M, 6);

    const lift = [s.nodes.n_A_elevA_L1!, s.nodes.n_A_elevA_L3!];
    const up = routePath3D(s, lift.map((n) => n.coord), lift.map((n) => ({ node: n.id })), ground, floorZ);
    expect(up).toHaveLength(2); // straight up, no draping indoors
    expect(up[1]![2] - up[0]![2]).toBeCloseTo(7.8, 6);
    const picked = routePath3D(s, [lift[0]!.coord], [{ scope: { kind: 'building', buildingId: 'bldg_A', level: 3 } }], ground, floorZ);
    expect(picked[0]![2]).toBeCloseTo(floorZ('bldg_A', 3)! + ROUTE_LIFT_M, 6);
  });

  it('the 3D views draw the routes, their caution parts and both pins', () => {
    const s = state();
    const a = s.nodes.n_A_elevA_L1!;
    const b = s.nodes.n_A_elevA_L3!;
    const layers = deckLayers({
      state: s, scope: { kind: 'outdoor' }, grid: null, terrain: true, buildings: true, measured: () => new Map(), exaggeration: 2,
      routes: [
        { profile: 'step_free', coordinates: [a.coord, b.coord], refs: [{ node: a.id }, { node: b.id }] },
        { profile: 'start', coordinates: [a.coord], refs: [{ node: a.id }] },
        { profile: 'end', coordinates: [b.coord], refs: [{ node: b.id }] },
      ],
      slopes: [{ cls: 'steep', coordinates: [a.coord, b.coord], ends: [a.id, b.id] }],
    });
    const byId = new Map(layers.map((l) => [l.id, l]));
    const line = byId.get('route-line')!.props.data as { path: [number, number, number][] }[];
    expect(line).toHaveLength(1);
    // Floor 3 is two floor heights up, × 2.
    expect(line[0]!.path.at(-1)![2] - line[0]!.path[0]![2]).toBeCloseTo(7.8 * 2, 6);
    expect((byId.get('route-pins')!.props.data as unknown[]).length).toBe(2);
    expect((byId.get('route-slope')!.props.data as unknown[]).length).toBe(1);
  });
});

describe('the relief under the cursor', () => {
  const g = slopeGrid([127.045, 37.557]);
  const at = centre(g, 20, 20);
  const vp = new WebMercatorViewport({ width: 800, height: 600, longitude: at[0], latitude: at[1], zoom: 18, pitch: 52, bearing: 20 });
  const ray = (x: number, y: number) => (z: number): Position => {
    const [lng, lat] = vp.unproject([x, y], { targetZ: z });
    return [lng!, lat!];
  };

  it('finds the point of the relief seen at a pixel: projected back with its height, it lands on that pixel', () => {
    for (const k of [1, 4]) {
      const ground = groundOf(g, k);
      const top = terrainTop(g) * k;
      for (const [x, y] of [[400, 300], [150, 420], [620, 180]] as const) {
        const p = pickSurface(ray(x, y), ground, top);
        const [sx, sy] = vp.project([p[0], p[1], ground(p)]);
        expect(Math.hypot(sx! - x, sy! - y)).toBeLessThan(0.5);
        // Not where the flat map would put it: the relief stands above the map plane.
        const flat = ray(x, y)(0);
        expect(Math.hypot(flat[0] - p[0], flat[1] - p[1])).toBeGreaterThan(1e-7);
      }
    }
  });
  it('without relief it is the flat map position', () => {
    const p = pickSurface(ray(400, 300), () => 0, 0);
    expect(p).toEqual(ray(400, 300)(0));
  });
});
