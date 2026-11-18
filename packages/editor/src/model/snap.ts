import type { Position } from '@campo/core';

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

/** The point of segment a–b closest to `p`, and how far it is, in pixels. */
export function footOnSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): { point: ScreenPoint; dist: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

// ---- 마그넷: one resolver for 길 그리기, 지점 추가, 지점 끌기 and 평지 그리기 / 모양 수정 (screen pixels, any zoom) ----

/** A path point within this many pixels of an existing edge of its scope is put on the edge (and splits it). */
export const EDGE_SNAP_PX = 8;
/** A point within this many pixels of a plaza edge (outer ring or hole) is put on that edge. */
export const PLAZA_SNAP_PX = 10;

/** One straight piece of a line, on screen and on the map. */
export interface SnapSegment {
  a: ScreenPoint;
  b: ScreenPoint;
  pa: Position;
  pb: Position;
}

/** The pieces of a map line as seen through `toScreen`. */
export function segmentsOf(coords: readonly Position[], toScreen: (p: Position) => ScreenPoint): SnapSegment[] {
  const screen = coords.map(toScreen);
  const out: SnapSegment[] = [];
  for (let i = 0; i + 1 < coords.length; i++) out.push({ a: screen[i]!, b: screen[i + 1]!, pa: coords[i]!, pb: coords[i + 1]! });
  return out;
}

export interface SnapCandidates {
  /** Points a click attaches to (existing nodes; plaza corners when drawing plazas). */
  nodes?: readonly { id: string; screen: ScreenPoint; position: Position }[];
  /** Edges a path point lands on. */
  edges?: readonly { id: string; segments: readonly SnapSegment[] }[];
  /** Plaza rings (outer and holes) a point lands on. */
  plazas?: readonly { id: string; segments: readonly SnapSegment[] }[];
}

export interface SnapOptions {
  /** Alt held: no snapping at all, the point stays where it was clicked. */
  alt?: boolean;
  nodePx?: number;
  edgePx?: number;
  plazaPx?: number;
}

export type SnapHit = {
  kind: 'node' | 'edge' | 'plaza';
  id: string;
  /** Where the point goes: the node, or the foot on the segment (exactly on the map segment, also with 지형 3D on). */
  position: Position;
  screen: ScreenPoint;
  /** Pixels from the pointer. */
  px: number;
};

/** The foot of `point` on the nearest segment within `maxPx`, as a map position on that segment. */
function nearestOnSegments(kind: 'edge' | 'plaza', lines: SnapCandidates['edges'], point: ScreenPoint, maxPx: number): SnapHit | null {
  let best: SnapHit | null = null;
  for (const line of lines ?? []) {
    for (const s of line.segments) {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - s.a.x) * dx + (point.y - s.a.y) * dy) / len2));
      const screen = { x: s.a.x + t * dx, y: s.a.y + t * dy };
      const px = Math.hypot(point.x - screen.x, point.y - screen.y);
      if (px > maxPx || (best && px >= best.px)) continue;
      const position: Position = [s.pa[0] + t * (s.pb[0] - s.pa[0]), s.pa[1] + t * (s.pb[1] - s.pa[1])];
      best = { kind, id: line.id, position, screen, px };
    }
  }
  return best;
}

/**
 * Where a point clicked at `point` goes. Alt: nowhere (null). A node within `nodePx` (SNAP_PX) always wins: next to a node
 * the foot on its own edge is always as close, so "nearer" alone would never pick the node. Otherwise the nearer of the
 * foot on an edge (within `edgePx`) and on a plaza edge (within `plazaPx`); an edge wins a tie.
 */
export function resolveSnap(point: ScreenPoint, c: SnapCandidates, o: SnapOptions = {}): SnapHit | null {
  if (o.alt) return null;
  const node = nearestWithin(c.nodes ?? [], point, o.nodePx ?? SNAP_PX);
  if (node) return { kind: 'node', id: node.id, position: node.position, screen: node.screen, px: Math.hypot(node.screen.x - point.x, node.screen.y - point.y) };
  const edge = nearestOnSegments('edge', c.edges, point, o.edgePx ?? EDGE_SNAP_PX);
  const plaza = nearestOnSegments('plaza', c.plazas, point, o.plazaPx ?? PLAZA_SNAP_PX);
  if (edge && plaza) return plaza.px < edge.px ? plaza : edge;
  return edge ?? plaza;
}
