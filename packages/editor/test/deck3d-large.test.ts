// 지형 3D with a very fine grid (1 m / 2 m tiles → hundreds of thousands of cells): deckLayers must not spread the cells into
// a function call (`Math.max(...cells)` overflows the call stack with "Maximum call stack size exceeded" and blanks the view).
import { describe, expect, it } from 'vitest';
import { deckLayers } from '../src/map/deck3d.ts';
import { terrainMesh, type TerrainGrid } from '../src/model/terrain3d.ts';
import { fixtureSession } from './fixture.ts';

const OX = 204000;
const OY = 550900;
// 320 × 320 grid cells → 2 triangles each = 204,800 mesh cells (well over the ~125k a spread argument list can take).
const N = 320;
// The terrain-mesh layer's props as this test uses them (deck.gl's generic `Layer` props type does not declare them).
type MeshCell = { polygon: [number, number, number][]; z: number };
type TerrainMeshProps = { data: MeshCell[]; getFillColor: (c: MeshCell) => number[] };
const isTerrainMeshProps = (p: unknown): p is TerrainMeshProps =>
  typeof p === 'object' && p !== null && Array.isArray((p as { data?: unknown }).data) && typeof (p as { getFillColor?: unknown }).getFillColor === 'function';

const bigGrid = (): TerrainGrid => ({
  source: 'corrected', crs: 'EPSG:5186', originX: OX, originY: OY, res: 1, width: N, height: N,
  z: Array.from({ length: N * N }, (_, i) => 40 + 0.01 * (i % N) + 0.005 * Math.floor(i / N)),
});

describe('deckLayers with hundreds of thousands of terrain cells', () => {
  const state = fixtureSession().history.current();
  const grid = bigGrid();
  const input = {
    state, scope: { kind: 'outdoor' as const }, grid, walls: [], terrain: true, buildings: false, measured: () => new Map(), exaggeration: 1, routes: [], slopes: [],
  };

  it('has more than 150,000 cells and still builds the layers without a RangeError', () => {
    expect(terrainMesh(grid, 1, 1).length).toBeGreaterThan(150_000);
    let layers: ReturnType<typeof deckLayers> = [];
    expect(() => { layers = deckLayers(input); }).not.toThrow();
    const mesh = layers.find((l) => l.id === 'terrain-mesh')!;
    expect((mesh.props.data as unknown[]).length).toBeGreaterThan(150_000);
  });

  it('colours the relief against the highest cell', () => {
    const mesh = deckLayers(input).find((l) => l.id === 'terrain-mesh')!;
    const props: unknown = mesh.props;
    if (!isTerrainMeshProps(props)) throw new Error('terrain-mesh layer has unexpected props');
    const cells = props.data;
    let top = 1;
    for (const c of cells) if (c.z > top) top = c.z;
    const getFill = props.getFillColor;
    const highest = cells.find((c) => c.z === top)!;
    expect(getFill(highest)).toEqual(getFill({ ...highest, z: top }));
    expect(getFill(highest)).not.toEqual(getFill({ ...highest, z: 0 }));
  });
});
