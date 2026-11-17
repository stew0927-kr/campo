// The points a record could snap to, bucketed in a grid of SNAP_M-sized cells (map metres). The crosshair moves on every
// frame of a drag; with the grid only the 3 × 3 cells around it are looked at, not every point of the floor.
import type { XY } from './project.ts';

export interface SnapPoint {
  id: string;
  xy: XY;
}

export interface SnapIndex {
  /** The nearest point within `radius` (at most the cell size) of `at`, or null. */
  nearest(at: XY, radius: number): SnapPoint | null;
  byId(id: string): SnapPoint | null;
  readonly size: number;
}

export function buildSnapIndex(points: readonly SnapPoint[], cell: number): SnapIndex {
  const side = cell > 0 && Number.isFinite(cell) ? cell : 1;
  const cells = new Map<string, SnapPoint[]>();
  const ids = new Map<string, SnapPoint>();
  const key = (i: number, j: number) => `${i}:${j}`;
  for (const p of points) {
    // A point that is not a number would land in a "NaN:NaN" cell and be found by nothing; leave it out.
    if (!Number.isFinite(p.xy[0]) || !Number.isFinite(p.xy[1])) continue;
    ids.set(p.id, p);
    const k = key(Math.floor(p.xy[0] / side), Math.floor(p.xy[1] / side));
    const list = cells.get(k);
    if (list) list.push(p);
    else cells.set(k, [p]);
  }
  return {
    size: ids.size,
    byId: (id) => ids.get(id) ?? null,
    nearest(at, radius) {
      if (!Number.isFinite(at[0]) || !Number.isFinite(at[1])) return null;
      const r = Math.min(radius, side);
      const [ci, cj] = [Math.floor(at[0] / side), Math.floor(at[1] / side)];
      let best: SnapPoint | null = null;
      let bestSq = r * r;
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
          for (const p of cells.get(key(i, j)) ?? []) {
            const sq = (p.xy[0] - at[0]) ** 2 + (p.xy[1] - at[1]) ** 2;
            if (sq <= bestSq) {
              best = p;
              bestSq = sq;
            }
          }
        }
      }
      return best;
    },
  };
}
