/** SPEC §8: clicking within this many pixels of an existing node attaches to it. */
export const SNAP_PX = 5;

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Nearest candidate within `maxPx` of `point` on screen, or undefined. */
export function nearestWithin<T extends { screen: ScreenPoint }>(
  candidates: Iterable<T>,
  point: ScreenPoint,
  maxPx = SNAP_PX,
): T | undefined {
  let best: T | undefined;
  let bestD = maxPx;
  for (const c of candidates) {
    const d = Math.hypot(c.screen.x - point.x, c.screen.y - point.y);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
