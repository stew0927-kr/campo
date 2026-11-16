import type { EdgeProperties, Position } from '../types.ts';
import type { BreakLine, BreakLineSide } from './types.ts';

/**
 * Is this campus edge a terrain break-line (EdgeProperties.is_breakline)? is_breakline when set, else outdoor steps
 * (edge_type 'outdoor' + highway 'steps'). The height solver draws the break as a short line across the edge's middle
 * (tools/elevation/campo_height_solver.py breaklines_from_campus) and keeps residual corrections on their own side.
 */
export function isBreakline(edge: Pick<EdgeProperties, 'is_breakline' | 'edge_type' | 'highway'>): boolean {
  return edge.is_breakline ?? (edge.edge_type === 'outdoor' && edge.highway === 'steps');
}

// ---- 사람이 그린 고도 단절선(ElevationStore.breaklines): 낮은 쪽 면과 단차 ----

/** Local metric plane around `lat0` (east, north in metres): left / right keep their meaning (no reflection). */
function planar(lat0: number): (p: Position) => [number, number] {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return ([lng, lat]) => [lng * 111_320 * k, lat * 110_540];
}

/**
 * Which side of the polyline `coords` (WGS84 [lng, lat], in drawing order) the point `at` lies on: 'left' or 'right' of the
 * direction of travel, judged on the nearest segment. A point exactly on the line counts as 'right'. Fewer than 2 points: null.
 */
export function breaklineSideOf(coords: readonly Position[], at: Position): BreakLineSide | null {
  if (coords.length < 2) return null;
  const xy = planar(at[1]);
  const [px, py] = xy(at);
  let best = Infinity;
  let cross = 0;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [ax, ay] = xy(coords[i]!);
    const [bx, by] = xy(coords[i + 1]!);
    const [dx, dy] = [bx - ax, by - ay];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) {
      best = d;
      cross = dx * (py - ay) - dy * (px - ax);
    }
  }
  return cross > 0 ? 'left' : 'right';
}

export const oppositeSide = (side: BreakLineSide): BreakLineSide => (side === 'left' ? 'right' : 'left');

/** Why `v` cannot be a break line's dropM (Korean), or null. dropM is a height in metres, 0 or more, finite. */
export function dropMError(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '높이차는 숫자(m)로 넣어 주세요.';
  if (v < 0) return '높이차는 0 이상이어야 합니다. 낮은 쪽은 면으로 정합니다.';
  if (v > 100) return '높이차가 100 m를 넘습니다. 단위(m)를 확인해 주세요.';
  return null;
}

/**
 * The break line with `lowSide` / `dropM` set or cleared (null clears). Throws nothing: an invalid dropM gives `{ error }`.
 * The input line is not changed.
 */
export function withBreakLineProps(
  line: BreakLine,
  patch: { lowSide?: BreakLineSide | null; dropM?: number | null },
): BreakLine | { error: string } {
  const next: BreakLine = { ...line };
  if (patch.lowSide !== undefined) {
    if (patch.lowSide === null) delete next.lowSide;
    else if (patch.lowSide === 'left' || patch.lowSide === 'right') next.lowSide = patch.lowSide;
    else return { error: '낮은 쪽 면은 왼쪽(left) 또는 오른쪽(right)입니다.' };
  }
  if (patch.dropM !== undefined) {
    if (patch.dropM === null) delete next.dropM;
    else {
      const err = dropMError(patch.dropM);
      if (err) return { error: err };
      next.dropM = patch.dropM;
    }
  }
  return next;
}
