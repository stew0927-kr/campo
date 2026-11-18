// Plaza test helpers: rings drawn in metres on a local plane around [127, 37].
import { localFrame, type Position } from '../../src/index.ts';

export const ORIGIN: Position = [127, 37];
export const F = localFrame(ORIGIN);
export const P = (x: number, y: number): Position => F.toPos(x, y);

/** Closed ring through metre corners (as given, then closed). */
export function ring(pts: [number, number][]): Position[] {
  const r = pts.map(([x, y]) => P(x, y));
  r.push([r[0]![0], r[0]![1]]);
  return r;
}

/** Axis-aligned rectangle, counter-clockwise (ccw = false gives clockwise). */
export function rect(x0: number, y0: number, x1: number, y1: number, ccw = true): Position[] {
  const pts: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return ring(ccw ? pts : pts.reverse());
}
