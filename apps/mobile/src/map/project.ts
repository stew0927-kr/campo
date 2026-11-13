// The survey map's arithmetic: positions as metres around the campus centre, and the view (what is under the crosshair, how far zoomed in).
// A campus is a couple of kilometres across, so a flat projection around its centre is accurate to centimetres.
import type { Position } from '@campo/core';

const M_PER_DEG_LAT = 111_320;

/** Metres east and north of the campus centre. */
export type XY = [number, number];

export interface Projection {
  toXY(p: Position): XY;
  toPosition(xy: XY): Position;
}

export function projection(center: Position): Projection {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((center[1] * Math.PI) / 180);
  return {
    toXY: (p) => [(p[0] - center[0]) * mPerDegLon, (p[1] - center[1]) * M_PER_DEG_LAT],
    toPosition: (xy) => [center[0] + xy[0] / mPerDegLon, center[1] + xy[1] / M_PER_DEG_LAT],
  };
}

/** The point under the crosshair (the middle of the screen), and pixels per metre. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

/** About a 400 m wide screen down to a 6 m wide one on a phone. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 60;

/** Screen pixels of a map point. Screen y grows downwards, north is up. */
export function toScreen(view: View, size: Size, xy: XY): XY {
  return [size.width / 2 + (xy[0] - view.x) * view.scale, size.height / 2 - (xy[1] - view.y) * view.scale];
}

/** The view after the finger dragged the map by (dx, dy) pixels: the map follows the finger. */
export function panned(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x - dx / view.scale, y: view.y + dy / view.scale };
}

/** The view zoomed by `factor` around the crosshair, kept inside the scale limits. */
export function zoomed(view: View, factor: number): View {
  return { ...view, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor)) };
}

/** A view that shows all of `points` with a margin; the campus centre at a walking scale when there are none. */
export function fitView(points: readonly XY[], size: Size, marginPx = 48): View {
  if (points.length === 0) return { x: 0, y: 0, scale: 4 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const fit = Math.min((size.width - 2 * marginPx) / Math.max(maxX - minX, 1), (size.height - 2 * marginPx) / Math.max(maxY - minY, 1));
  return zoomed({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, scale: 1 }, Number.isFinite(fit) && fit > 0 ? fit : 4);
}
