// 지형 3D 길 리본: every road the solver fixed (solve_report.json roads[], after the plaza cut, GET /terrain `roads`) drawn
// as its own surface, apart from the grid (map/deck3d.ts `road-ribbon`).
//
// The solver (tools/elevation grid_grading.py rasterize_corridors) fixes a cell at the height of the segment whose corridor
// it is deepest inside (signed distance d − w, ties to the earlier segment), at that segment's (1 − t)·z0 + t·z1 with t the
// projection clamped to [0, 1]: a function of the station alone, level across the width. Its corridor of one segment is a
// capsule (a rectangle and a half disc at each end, flat at the end's height). The ribbon is that shape:
//   - strips: each segment cut into equal pieces of at most RIBBON_PIECE_M, each a rectangle square to its own segment
//     whose two corners at a station have the very same z (I7: a plane, level across, width_m wide exactly);
//   - caps: at a free end a half disc of radius width_m / 2 (CAP_STEPS chords) flat at the end's height; at a bend of one
//     road the gap on the outer side is a wedge of that disc, flat at the joint's height (the solver's ties at the joint);
//     the inner side is covered by both strips already (an overlap of two nearly equal planes, ≤ w·tan(θ/2) wide).
// No mitre joins (a mitred quad is not planar: it would tilt across the width), and no z offsets between pieces (the carve
// under them, I5, is measured from their own z): the draw order is the data order (roads as given, then segment order).
import type { Position } from '@campo/core';
import { fromKorea2000, type Ground } from './terrain3d.ts';
import type { Footprint } from './terrainFootprint.ts';

/** A road's corridor as the solver fixed it (solve_report.json roads[]; server/terrain.ts roadsFromReport). */
export interface RoadSegmentJson {
  id: string;
  width_m: number;
  /** [x0, y0, z0, x1, y1, z1]: EPSG:5186 m and absolute heights m. */
  segments: [number, number, number, number, number, number][];
}

/** The longest strip (m): the carve under a strip is measured from its lower end, so it is off by at most slope × this. */
export const RIBBON_PIECE_M = 2;
/** Chords of a free end's half disc. */
export const CAP_STEPS = 8;

export interface RibbonPiece {
  edgeId: string;
  kind: 'strip' | 'cap';
  /** For drawing: [lng, lat, z], z = (height − base) × k. */
  polygon: [number, number, number][];
  /** The same vertices in the plan (EPSG:5186 m): the carve's footprint, and the tests'. */
  plan: [number, number][];
  /** The lowest z of the piece (display m): the relief stays CARVE_GAP_M under it wherever it meets the piece. */
  zMin: number;
  /** The segment it belongs to, counted over all roads in order (roads[0]'s segments first). */
  seg: number;
  /** The outer edges: i for the edge plan[i] → plan[i + 1] (a strip's two long sides, a cap's arc). */
  outer: number[];
}

type XY = [number, number];

const JOINT_M = 1e-6;
const JOINT_Z = 1e-9;
const STRAIGHT_RAD = 1e-9;

const finiteSeg = (s: readonly number[]) => s.length === 6 && s.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * The ribbon of `roads`: strips and caps (see above), z = (h − base) × k. A road without a positive finite width, or a
 * segment that is not six finite numbers, is left out (the segments are still counted in `seg`).
 */
export function roadPieces(roads: readonly RoadSegmentJson[], base: number, k: number): RibbonPiece[] {
  const out: RibbonPiece[] = [];
  const zOf = (h: number) => (h - base) * k;
  let seg0 = 0;
  for (const road of roads) {
    const segs = road.segments;
    const w = road.width_m / 2;
    const first = seg0;
    seg0 += segs.length;
    if (!(Number.isFinite(w) && w > 0)) continue;
    const push = (kind: RibbonPiece['kind'], plan: XY[], zs: number[], seg: number, outer: number[]) => {
      out.push({
        edgeId: road.id, kind, seg, outer, plan, zMin: Math.min(...zs),
        polygon: plan.map((p, i): [number, number, number] => {
          const [lng, lat] = fromKorea2000(p[0], p[1]);
          return [lng, lat, zs[i]!];
        }),
      });
    };
    /** A half disc at p, outward along `out` (unit), flat at display z. */
    const halfDisc = (p: XY, out: XY, z: number, seg: number) => {
      const a0 = Math.atan2(out[0], -out[1]); // the left of `out`
      const plan: XY[] = [];
      for (let q = 0; q <= CAP_STEPS; q++) {
        const a = a0 - (Math.PI * q) / CAP_STEPS;
        plan.push([p[0] + w * Math.cos(a), p[1] + w * Math.sin(a)]);
      }
      push('cap', plan, plan.map(() => z), seg, plan.slice(1).map((_, i) => i));
    };
    // Each segment's direction and length (null: left out).
    const dirs = segs.map((s) => {
      if (!finiteSeg(s)) return null;
      const L = Math.hypot(s[3] - s[0], s[4] - s[1]);
      return { L, u: (L > 0 ? [(s[3] - s[0]) / L, (s[4] - s[1]) / L] : [1, 0]) as XY };
    });
    /** Does segment j end where j + 1 starts (same point, same height)? */
    const joined = (j: number) => {
      const [a, b] = [segs[j], segs[j + 1]];
      return !!a && !!b && !!dirs[j] && !!dirs[j + 1] && Math.hypot(a[3] - b[0], a[4] - b[1]) <= JOINT_M && Math.abs(a[5] - b[2]) <= JOINT_Z;
    };
    /** At a joint: a wedge on the outer side ('wedge'), nothing ('straight'), or free half discs ('free'; a segment shorter than w). */
    const joint = (j: number): 'wedge' | 'straight' | 'free' => {
      if (!joined(j)) return 'free';
      const [d0, d1] = [dirs[j]!, dirs[j + 1]!];
      const turn = Math.atan2(d0.u[0] * d1.u[1] - d0.u[1] * d1.u[0], d0.u[0] * d1.u[0] + d0.u[1] * d1.u[1]);
      if (Math.abs(turn) < STRAIGHT_RAD) return 'straight';
      // A strip covers the half disc behind its end only when it is at least w long.
      return d0.L >= w && d1.L >= w ? 'wedge' : 'free';
    };
    for (let j = 0; j < segs.length; j++) {
      const d = dirs[j];
      if (!d) continue;
      const s = segs[j]!;
      const [x0, y0, z0, x1, y1, z1] = s;
      const seg = first + j;
      const n: XY = [-d.u[1], d.u[0]]; // left
      const start = j === 0 ? 'free' : joint(j - 1);
      if (start === 'free') halfDisc([x0, y0], [-d.u[0], -d.u[1]], zOf(z0), seg);
      if (d.L > 0) {
        const m = Math.max(1, Math.ceil(d.L / RIBBON_PIECE_M - 1e-9));
        const [dx, dy] = [x1 - x0, y1 - y0];
        for (let i = 0; i < m; i++) {
          const [ta, tb] = [i / m, (i + 1) / m];
          const [ax, ay] = i === 0 ? [x0, y0] : [x0 + dx * ta, y0 + dy * ta];
          const [bx, by] = i + 1 === m ? [x1, y1] : [x0 + dx * tb, y0 + dy * tb];
          // The solver's height along the segment, the same number at both corners of a station.
          const za = zOf(i === 0 ? z0 : (1 - ta) * z0 + ta * z1);
          const zb = zOf(i + 1 === m ? z1 : (1 - tb) * z0 + tb * z1);
          const plan: XY[] = [[ax + n[0] * w, ay + n[1] * w], [bx + n[0] * w, by + n[1] * w], [bx - n[0] * w, by - n[1] * w], [ax - n[0] * w, ay - n[1] * w]];
          push('strip', plan, [za, zb, zb, za], seg, [0, 2]);
        }
      }
      const end = j + 1 === segs.length ? 'free' : joint(j);
      if (end === 'free') halfDisc([x1, y1], d.u, zOf(z1), seg);
      else if (end === 'wedge') {
        // The outer side of the bend: the right when the road turns left, the left when it turns right.
        const d1 = dirs[j + 1]!;
        const turn = Math.atan2(d.u[0] * d1.u[1] - d.u[1] * d1.u[0], d.u[0] * d1.u[0] + d.u[1] * d1.u[1]);
        const side = turn > 0 ? -1 : 1;
        const a0 = Math.atan2(side * n[1], side * n[0]);
        const steps = Math.max(1, Math.ceil((CAP_STEPS * Math.abs(turn)) / Math.PI - 1e-9));
        const plan: XY[] = [[x1, y1]];
        for (let q = 0; q <= steps; q++) {
          const a = a0 + (turn * q) / steps;
          plan.push([x1 + w * Math.cos(a), y1 + w * Math.sin(a)]);
        }
        const z = zOf(z1);
        push('cap', plan, plan.map(() => z), seg, plan.slice(2).map((_, i) => i + 1));
      }
    }
  }
  return out;
}

/**
 * The solver's height at plan point (x, y) (EPSG:5186 m, absolute m): the segment whose corridor the point is deepest inside
 * (d − width_m / 2, ties to the earlier one, roads in order), at (1 − t)·z0 + t·z1 with t clamped; null outside every
 * corridor. The same arithmetic as grid_grading.py rasterize_corridors (_project), so it gives its numbers.
 */
export function corridorZ(roads: readonly RoadSegmentJson[], x: number, y: number): number | null {
  let best = Infinity;
  let z: number | null = null;
  for (const road of roads) {
    const hw = road.width_m / 2;
    if (!(Number.isFinite(hw) && hw > 0)) continue;
    for (const s of road.segments) {
      if (!finiteSeg(s)) continue;
      const [xi, yi, zi, xj, yj, zj] = s;
      const [vx, vy] = [xj - xi, yj - yi];
      const L2 = vx * vx + vy * vy;
      const t = L2 > 0 ? Math.min(Math.max(((x - xi) * vx + (y - yi) * vy) / L2, 0), 1) : 0;
      const sd = Math.hypot(x - (xi + t * vx), y - (yi + t * vy)) - hw;
      if (sd < best) {
        best = sd;
        z = (1.0 - t) * zi + t * zj;
      }
    }
  }
  return best <= 0 ? z : null;
}

/**
 * The ribbon's cliff where the ground beside it is lower (fill): an upright quad under every outer edge (a strip's long
 * sides, a cap's chords) whose ground `probeM` out (away from the piece) is more than 2 cm under the edge, from the edge
 * down to the ground there − `extraM`. None on the cut side (the relief is pressed under the ribbon there and rises from it
 * as a slope). `ground`: the bare relief (fineGround), display m. [top start, top end, foot end, foot start].
 */
export function ribbonSkirt(
  pieces: readonly RibbonPiece[], ground: Ground, opts: { probeM?: number; extraM?: number } = {},
): { polygon: [number, number, number][]; z: number }[] {
  const probeM = opts.probeM ?? 0.6;
  const extraM = opts.extraM ?? 0.2;
  const out: { polygon: [number, number, number][]; z: number }[] = [];
  const at = (x: number, y: number): Position => fromKorea2000(x, y);
  for (const pc of pieces) {
    const cx = pc.plan.reduce((s, p) => s + p[0], 0) / pc.plan.length;
    const cy = pc.plan.reduce((s, p) => s + p[1], 0) / pc.plan.length;
    for (const i of pc.outer) {
      const [a, b] = [pc.plan[i]!, pc.plan[(i + 1) % pc.plan.length]!];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len === 0) continue;
      let n: XY = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if ((mx - cx) * n[0] + (my - cy) * n[1] < 0) n = [-n[0], -n[1]]; // away from the piece
      const [za, zb] = [pc.polygon[i]![2], pc.polygon[(i + 1) % pc.plan.length]![2]];
      if (!(ground(at(mx + n[0] * probeM, my + n[1] * probeM)) < (za + zb) / 2 - 0.02)) continue;
      const ga = Math.min(za, ground(at(a[0] + n[0] * probeM, a[1] + n[1] * probeM))) - extraM;
      const gb = Math.min(zb, ground(at(b[0] + n[0] * probeM, b[1] + n[1] * probeM))) - extraM;
      const [pa, pb] = [pc.polygon[i]!, pc.polygon[(i + 1) % pc.plan.length]!];
      out.push({ polygon: [[pa[0], pa[1], za], [pb[0], pb[1], zb], [pb[0], pb[1], gb], [pa[0], pa[1], ga]], z: Math.min(za, zb) });
    }
  }
  return out;
}

/** The pieces as footprints for terrainSurface: each piece's plan, capped at its own lowest z (I5 under the ribbon). */
export function footprintsOfRoads(pieces: readonly RibbonPiece[]): Footprint[] {
  return pieces.map((p, i) => ({ id: `${p.edgeId}#${i}`, kind: 'road' as const, rings: [p.plan], zCap: p.zMin }));
}

/** The outer edges of the pieces as lines ([lng, lat, z + lift]): the ribbon's two sides and its caps' arcs. */
export function ribbonEdges(pieces: readonly RibbonPiece[], lift = 0): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (const pc of pieces) {
    let line: [number, number, number][] = [];
    let last = -2;
    for (const i of pc.outer) {
      const [a, b] = [pc.polygon[i]!, pc.polygon[(i + 1) % pc.polygon.length]!];
      if (i !== last + 1 && line.length > 0) {
        out.push(line);
        line = [];
      }
      if (line.length === 0) line.push([a[0], a[1], a[2] + lift]);
      line.push([b[0], b[1], b[2] + lift]);
      last = i;
    }
    if (line.length > 1) out.push(line);
  }
  return out;
}
