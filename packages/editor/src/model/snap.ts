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

/** Distance in pixels from `p` to the segment a–b. */
export function distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
