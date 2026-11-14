// The survey map's arithmetic: positions as metres around the campus centre, and the view (what is under the crosshair,
// how far zoomed in, and how far the map is turned). A campus is a couple of kilometres across, so a flat projection
// around its centre is accurate to centimetres.
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

/** The point under the crosshair (the middle of the screen), pixels per metre, and the map's turn. */
export interface View {
  x: number;
  y: number;
  scale: number;
  /**
   * The map direction (degrees clockwise from north) that points to the top of the screen. 0 or left out: north is up.
   * At 90 east is up and north points to the left.
   */
  rotation?: number;
}

export interface Size {
  width: number;
  height: number;
}

/** About a 400 m wide screen down to a 6 m wide one on a phone. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 60;

const rad = (deg: number): number => (deg * Math.PI) / 180;
/** 0 up to 360. */
export const normalizeRotation = (deg: number): number => ((deg % 360) + 360) % 360;
export const rotationOf = (view: View): number => view.rotation ?? 0;

/** Screen pixels of a map point. Screen y grows downwards; the map is turned by the view's rotation around the crosshair. */
export function toScreen(view: View, size: Size, xy: XY): XY {
  const t = rad(rotationOf(view));
  const [dx, dy] = [xy[0] - view.x, xy[1] - view.y];
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return [size.width / 2 + (dx * c - dy * s) * view.scale, size.height / 2 - (dx * s + dy * c) * view.scale];
}

/** The map point under a screen pixel (the inverse of toScreen). */
export function fromScreen(view: View, size: Size, px: XY): XY {
  const t = rad(rotationOf(view));
  const sx = (px[0] - size.width / 2) / view.scale;
  const sy = -(px[1] - size.height / 2) / view.scale;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return [view.x + sx * c + sy * s, view.y - sx * s + sy * c];
}

/**
 * The SVG transform (matrix a b c d e f) that draws map metres on the screen: x east, y north, turned by the rotation.
 * The same arithmetic as toScreen, so the drawing and the hit tests agree.
 */
export function mapMatrix(view: View, size: Size): [number, number, number, number, number, number] {
  const t = rad(rotationOf(view));
  const [c, s, k] = [Math.cos(t), Math.sin(t), view.scale];
  const [cx, cy] = toScreen(view, size, [0, 0]);
  return [k * c, -k * s, -k * s, -k * c, cx, cy];
}

/** The view after the finger dragged the map by (dx, dy) pixels: the map follows the finger, whatever its turn. */
export function panned(view: View, dx: number, dy: number): View {
  const t = rad(rotationOf(view));
  const [sx, sy] = [dx / view.scale, -dy / view.scale];
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return { ...view, x: view.x - (sx * c + sy * s), y: view.y - (-sx * s + sy * c) };
}

/** The view zoomed by `factor` around the crosshair, kept inside the scale limits. */
export function zoomed(view: View, factor: number): View {
  return { ...view, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor)) };
}

/**
 * The view turned around the crosshair by `deg` the way two fingers turned on the screen (clockwise positive): the map
 * turns with the fingers, so the direction at the top of the screen goes the other way.
 */
export function rotated(view: View, deg: number): View {
  const next = normalizeRotation(rotationOf(view) - deg);
  if (next === 0) {
    const { rotation: _r, ...rest } = view;
    return rest;
  }
  return { ...view, rotation: next };
}

/** The view with the map turned to `deg` (0: north up). */
export function withRotation(view: View, deg: number): View {
  return rotated({ ...view, rotation: 0 }, -deg);
}

/** The shortest turn from `from` to `to`, -180 up to 180. */
export function shortestTurn(from: number, to: number): number {
  const d = normalizeRotation(to - from);
  return d > 180 ? d - 360 : d;
}

/** A view that shows all of `points` with a margin, at the given turn; the campus centre at a walking scale when there are none. */
export function fitView(points: readonly XY[], size: Size, marginPx = 48, rotation = 0): View {
  const turn = rotation === 0 ? {} : { rotation: normalizeRotation(rotation) };
  if (points.length === 0) return { x: 0, y: 0, scale: 4, ...turn };
  // Measure the points in the turned screen frame (u right, v up), then bring the middle back to map metres.
  const t = rad(rotation);
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const us = points.map((p) => p[0] * c - p[1] * s);
  const vs = points.map((p) => p[0] * s + p[1] * c);
  const [minU, maxU, minV, maxV] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const fit = Math.min((size.width - 2 * marginPx) / Math.max(maxU - minU, 1), (size.height - 2 * marginPx) / Math.max(maxV - minV, 1));
  const [mu, mv] = [(minU + maxU) / 2, (minV + maxV) / 2];
  const centre = { x: mu * c + mv * s, y: -mu * s + mv * c };
  return zoomed({ ...centre, scale: 1, ...turn }, Number.isFinite(fit) && fit > 0 ? fit : 4);
}

/** The side of a square that covers the screen at any turn (the tiles under a turned map are laid out on it). */
export const coverSide = (size: Size): number => Math.ceil(Math.hypot(size.width, size.height));

// ---- 축척 막대 ----

const NICE = [1, 2, 5] as const;

/** A round length (1, 2 or 5 × 10ⁿ metres) whose bar is at most `maxPx` wide at `scale`, and that width. */
export function scaleBar(scale: number, maxPx = 90): { metres: number; px: number; label: string } {
  const most = maxPx / scale;
  let best = 1;
  for (let exp = -1; exp <= 4; exp++) {
    for (const n of NICE) {
      const m = n * 10 ** exp;
      if (m <= most) best = m;
    }
  }
  const metres = Number(best.toPrecision(1));
  return { metres, px: metres * scale, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}
