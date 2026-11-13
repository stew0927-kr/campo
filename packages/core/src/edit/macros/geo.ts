// Turf helpers of the macros. Every call passes { units: 'meters' } (Turf's default is kilometres, SPEC-v0.2 §6).
// The foot of a perpendicular is footOnLine in ../geo.ts, shared with the actions.
import along from '@turf/along';
import type { Position } from '../../types.ts';
import { lineLength, metres } from '../geo.ts';

const line = (coords: readonly Position[]) => ({ type: 'LineString' as const, coordinates: coords.map((p) => [p[0], p[1]]) });

/** The point `d` metres along the polyline (clamped to its ends). */
export function pointAlong(coords: readonly Position[], d: number): Position {
  const [lng, lat] = along(line(coords), Math.max(0, d), { units: 'meters' }).geometry.coordinates;
  return [lng!, lat!];
}

/** Metres per degree of longitude and of latitude around `p` (Turf distance, metres). */
function scale(p: Position): [number, number] {
  const d = 1e-6;
  return [metres(p, [p[0] + d, p[1]]) / d, metres(p, [p[0], p[1] + d]) / d];
}

/**
 * The point `dist` metres from `p`, perpendicular to the direction a → b: to the left of it, or to the right.
 * The direction is taken in a local metric frame; the distance is measured with Turf along (metres).
 */
export function sideways(a: Position, b: Position, p: Position, dist: number, side: 'left' | 'right'): Position {
  const [kx, ky] = scale(p);
  const vx = (b[0] - a[0]) * kx;
  const vy = (b[1] - a[1]) * ky;
  const n = Math.hypot(vx, vy);
  if (n === 0 || dist === 0) return [p[0], p[1]];
  const sign = side === 'left' ? 1 : -1;
  // left normal of (vx, vy) is (-vy, vx); one metre that way, then exactly `dist` metres along it
  const far: Position = [p[0] + (sign * -vy) / n / kx * Math.max(1, dist * 2), p[1] + (sign * vx) / n / ky * Math.max(1, dist * 2)];
  return pointAlong([p, far], dist);
}

/** Ray casting on lng/lat; fine for room-sized rings. */
export function pointInRing(p: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The segment of the polyline that holds the point `d` metres along it, as [start, end]. */
export function segmentAt(coords: readonly Position[], d: number): [Position, Position] {
  let walked = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const len = lineLength([coords[i]!, coords[i + 1]!]);
    if (d <= walked + len || i === coords.length - 2) return [coords[i]!, coords[i + 1]!];
    walked += len;
  }
  return [coords[0]!, coords[coords.length - 1]!];
}

export { lineLength, metres };
