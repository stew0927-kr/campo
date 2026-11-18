// 곡선 길 (curved paths): a smooth line through the clicked control points, as the bend points (`vertices`) of one edge per pair.
// Centripetal Catmull-Rom (alpha 0.5, Barry-Goldman form): it passes exactly through every control point and does not loop or
// overshoot at uneven spacing. Pure and deterministic: the live preview and the finished path call the same function.
// The data model is unchanged: an edge keeps from / to nodes and `vertices` (core `edgeLine` = [from, ...vertices, to]).
import type { Position } from '@campo/core';

/** How densely a curve is sampled: about one point per `spacingM` metres of a segment, never fewer than `min` or more than `max`. */
export const CURVE_SAMPLING = { spacingM: 1.5, min: 8, max: 24 } as const;

/** Coordinates are rounded to 7 decimals (about 1 cm), like the rest of the data. */
const DECIMALS = 1e7;
const round7 = (v: number) => Math.round(v * DECIMALS) / DECIMALS;
/** A sample closer than this (metres) to the point before it, or to the segment's end, is dropped. */
const MIN_GAP_M = 0.05;

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LNG_EQ = 111320;

type XY = readonly [number, number];

interface Frame {
  lng0: number;
  lat0: number;
  kx: number;
}

const frameOf = (p: Position): Frame => ({ lng0: p[0], lat0: p[1], kx: M_PER_DEG_LNG_EQ * Math.cos((p[1] * Math.PI) / 180) });
const toXY = (f: Frame, p: Position): XY => [(p[0] - f.lng0) * f.kx, (p[1] - f.lat0) * M_PER_DEG_LAT];
const toPos = (f: Frame, p: XY): Position => [round7(f.lng0 + p[0] / f.kx), round7(f.lat0 + p[1] / M_PER_DEG_LAT)];
const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);

const mix = (a: XY, b: XY, w: number): XY => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];

/** Barry-Goldman evaluation of the Catmull-Rom piece between p1 and p2 at knot parameter t in [t1, t2]. */
function pointAt(p: readonly [XY, XY, XY, XY], t: readonly [number, number, number, number], at: number): XY {
  const [p0, p1, p2, p3] = p;
  const [t0, t1, t2, t3] = t;
  const lerp = (a: XY, b: XY, ta: number, tb: number): XY => (tb - ta < 1e-12 ? a : mix(a, b, (at - ta) / (tb - ta)));
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/**
 * The curve through `controls`, one list per segment (controls[i] -> controls[i + 1]): the points strictly BETWEEN the two
 * controls, in order. The controls themselves are not in the lists, so they are passed through exactly (the nodes keep their own
 * coordinates). Repeated controls are ignored. Two controls give the straight line: one empty list.
 * The two ends are extended by mirroring the neighbouring control (a free end that bends naturally, no kink).
 */
export function curveSegments(controls: readonly Position[]): Position[][] {
  const pts: Position[] = [];
  for (const c of controls) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) pts.push([c[0], c[1]]);
  }
  if (pts.length < 2) return [];
  if (pts.length === 2) return [[]];
  const f = frameOf(pts[0]!);
  const xy = pts.map((p) => toXY(f, p));
  const first = xy[0]!;
  const lastP = xy[xy.length - 1]!;
  const ext: XY[] = [[2 * first[0] - xy[1]![0], 2 * first[1] - xy[1]![1]], ...xy, [2 * lastP[0] - xy[xy.length - 2]![0], 2 * lastP[1] - xy[xy.length - 2]![1]]];
  const out: Position[][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const q = [ext[i]!, ext[i + 1]!, ext[i + 2]!, ext[i + 3]!] as const;
    const t: [number, number, number, number] = [0, 0, 0, 0];
    for (let k = 1; k < 4; k++) t[k] = t[k - 1]! + Math.sqrt(dist(q[k - 1]!, q[k]!));
    const length = dist(q[1], q[2]);
    const n = Math.min(CURVE_SAMPLING.max, Math.max(CURVE_SAMPLING.min, Math.ceil(length / CURVE_SAMPLING.spacingM)));
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const seg: Position[] = [];
    let prev: XY = q[1];
    for (let s = 1; s < n; s++) {
      const p = pointAt(q, t, t[1] + ((t[2] - t[1]) * s) / n);
      const pos = toPos(f, p);
      const rounded = toXY(f, pos);
      if (dist(rounded, prev) < MIN_GAP_M || dist(rounded, q[2]) < MIN_GAP_M) continue;
      if ((pos[0] === a[0] && pos[1] === a[1]) || (pos[0] === b[0] && pos[1] === b[1])) continue;
      seg.push(pos);
      prev = rounded;
    }
    out.push(seg);
  }
  return out;
}

/** The whole curve as one polyline: control, its segment's points, next control, ... (what the live preview draws). */
export function curveLine(controls: readonly Position[]): Position[] {
  const pts: Position[] = [];
  for (const c of controls) {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) pts.push([c[0], c[1]]);
  }
  if (pts.length < 2) return pts;
  const segs = curveSegments(pts);
  const line: Position[] = [pts[0]!];
  for (let i = 0; i < segs.length; i++) line.push(...segs[i]!, pts[i + 1]!);
  return line;
}
