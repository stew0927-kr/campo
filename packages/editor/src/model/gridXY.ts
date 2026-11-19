// Where a vertex of a height grid is in EPSG:5186 metres. One formula for the dev server (server/terrain.ts: decodeGrid's
// thinned grid, terrainTiles) and the view (model/terrainFootprint.ts), so a tile's corner is the very point of the coarse
// vertex it sits on. No imports, so both sides can use it (like korea2000.ts).

/** A grid's frame: its left and top edges (cell edges) and its cell size, metres. */
export interface GridFrame {
  originX: number;
  originY: number;
  res: number;
}

/**
 * The centre of cell (r, c) (row from the north, column from the west) = the mesh vertex (r, c), EPSG:5186 m.
 * `r` and `c` may be fractional: a tile's vertex (i, j) of `sub` is coarseVertexXY(grid, r + i / sub, c + j / sub), so a
 * tile vertex on a cell's edge is computed the same way from both cells that share the edge (bit for bit).
 * For decodeGrid's thinned grid, coarseVertexXY(thinned, r, c) is the centre of the full cell (r × stride, c × stride).
 */
export function coarseVertexXY(grid: GridFrame, r: number, c: number): [number, number] {
  return [grid.originX + (c + 0.5) * grid.res, grid.originY - (r + 0.5) * grid.res];
}
