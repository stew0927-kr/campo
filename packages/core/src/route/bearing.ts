// Walking direction at each node of a found route, from the route's geometry alone (no compass, no GPS course).
// Used to pick the photo of a point that looks the way the route goes (survey/photos.ts) and to draw the arrow on it.
// Display only: no floor number is read here; a floor change is recognised by the step kind and by its two ends
// being drawn at one spot.
import { straight } from '../graph.ts';
import type { RouteStep } from '../route-text.ts';
import { normalizeDeg } from '../survey/vertical.ts';

/** [lng, lat] (WGS84), the same order as GeoJSON positions. */
export type LngLat = readonly [number, number];

/** How far along the route (horizontal metres) the direction at a node looks ahead. A field estimate; tune 3–6 m on site. */
export const LOOKAHEAD_M = 4;
/** Less horizontal walk than this ahead (or behind) gives no direction: coordinate noise would be the whole answer. */
export const MIN_SEGMENT_M = 1;

/** Two positions closer than this (metres) count as one spot: an elevator ride or an indoor flight of stairs. */
const SAME_SPOT_M = 1e-6;

export type FloorChangeKind = 'stairs' | 'elevator' | 'escalator';

/** Directions at one node of a route, degrees clockwise from north. null where none can be told. */
export interface StepBearing {
  /** Leaving the node (first choice for the photo). null at the destination. */
  outDeg: number | null;
  /** Arriving at the node (the destination's direction, and the photo fallback). null at the start. */
  inDeg: number | null;
  /** signedDiffDeg(outDeg, inDeg): -180..180, negative = turn left. null unless both are known. */
  turnDeg: number | null;
  /** The step that leaves this node changes floor this way. */
  floorChange?: FloorChangeKind;
}

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Great-circle initial bearing from `a` to `b`, 0 up to 360. 0 when the two are the same spot. */
export function initialBearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = rad(a[1]);
  const φ2 = rad(b[1]);
  const Δλ = rad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(deg(Math.atan2(y, x)));
}

/** `a` minus `b` the short way round: -180 up to (not including) 180. Positive = `a` is to the right (clockwise) of `b`. */
export function signedDiffDeg(a: number, b: number): number {
  const d = ((normalizeDeg(a) - normalizeDeg(b) + 540) % 360) - 180;
  return d === 0 ? 0 : d; // no -0
}

const lerp = (a: LngLat, b: LngLat, t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const metres = (a: LngLat, b: LngLat): number => straight([a[0], a[1]], [b[0], b[1]]);

/**
 * The bearing from `line[startIndex]` to the point `lookaheadM` horizontal metres along the line in direction `dir`
 * (+1 forward, -1 backward). Stretches of no horizontal length (a floor change, a repeated position) are skipped. When the
 * line ends sooner, the bearing to its last point is used, as long as at least MIN_SEGMENT_M was walked; otherwise null
 * (the caller falls back to the other direction). Backward, the result points back along the route, not the way walked.
 */
export function bearingAlong(line: readonly LngLat[], startIndex: number, dir: 1 | -1, lookaheadM: number = LOOKAHEAD_M): number | null {
  const origin = line[startIndex];
  if (origin === undefined) return null;
  let walked = 0;
  let last: LngLat = origin;
  for (let i = startIndex; ; i += dir) {
    const a = line[i];
    const b = line[i + dir];
    if (a === undefined || b === undefined) break;
    const seg = metres(a, b);
    if (seg < SAME_SPOT_M) continue;
    if (walked + seg >= lookaheadM) return initialBearingDeg(origin, lerp(a, b, (lookaheadM - walked) / seg));
    walked += seg;
    last = b;
  }
  return walked >= MIN_SEGMENT_M ? initialBearingDeg(origin, last) : null;
}

const FLOOR_CHANGE: ReadonlySet<RouteStep['kind']> = new Set(['stairs', 'elevator', 'escalator']);

/** Horizontal metres covered by line[from..to]. */
function spanM(line: readonly LngLat[], from: number, to: number): number {
  let m = 0;
  for (let i = from; i < to; i++) m += metres(line[i]!, line[i + 1]!);
  return m;
}

/**
 * The direction at every node where a step starts, and at the destination: `steps.length + 1` entries, the last one for
 * the end of the last step (outDeg null). `line` is the position of each route node in order (Route.nodes: elevator cars
 * collapsed into their stops), so step i starts at the sum of the earlier steps' edge counts. Empty when the line does not
 * fit the steps (then nothing is filled in).
 *
 * - outDeg looks LOOKAHEAD_M ahead along the route; inDeg looks the same distance back and turns it round.
 * - A floor change drawn at one spot (an elevator, indoor stairs) has no direction of its own: it takes the direction of
 *   the first horizontal stretch after it. So the node where it ends faces that way on arrival (inDeg = outDeg there,
 *   never the corridor of the floor left behind), and the node where it starts keeps the direction it was entered by
 *   (facing the elevator or the stairs), or, at the very start of a route, the direction after it.
 */
export function computeStepBearings(steps: readonly RouteStep[], line: readonly LngLat[]): StepBearing[] {
  const starts: number[] = [];
  let at = 0;
  for (const step of steps) {
    starts.push(at);
    at += step.edgeIds.length;
  }
  if (steps.length === 0 || at !== line.length - 1) return [];
  starts.push(at); // the destination

  const ahead = starts.map((i) => bearingAlong(line, i, 1));
  const back = starts.map((i) => {
    const b = bearingAlong(line, i, -1);
    return b === null ? null : normalizeDeg(b + 180);
  });
  // A step that changes floor at one spot: no horizontal walk between its two ends.
  const vertical = steps.map((step, s) => FLOOR_CHANGE.has(step.kind) && spanM(line, starts[s]!, starts[s + 1]!) < MIN_SEGMENT_M);

  return starts.map((_, s) => {
    const last = s === steps.length;
    const step = steps[s];
    let inDeg = back[s] ?? null;
    let outDeg = last ? null : (ahead[s] ?? null);
    // Arriving out of a floor change: face the way the route goes on from here.
    if (s > 0 && vertical[s - 1]) inDeg = ahead[s] ?? back[s - 1] ?? null;
    // Leaving by a floor change: keep facing the way it was entered; at the start of the route, the way after it.
    if (!last && vertical[s]) outDeg = inDeg ?? ahead[s] ?? null;
    if (!last && outDeg === null) outDeg = inDeg;
    const bearing: StepBearing = {
      outDeg,
      inDeg,
      turnDeg: outDeg !== null && inDeg !== null ? signedDiffDeg(outDeg, inDeg) : null,
    };
    if (step && FLOOR_CHANGE.has(step.kind)) bearing.floorChange = step.kind as FloorChangeKind;
    return bearing;
  });
}
