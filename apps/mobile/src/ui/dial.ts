// The arithmetic of the compass dial that sets the direction of a photo. The dial is fixed on the point; a finger drags
// round it and the heading follows by the angle the finger has gone round, so the dial turns under the finger like a knob.
import { normalizeDeg } from '@campo/core';

/** Half of the fan's opening: how wide a view the picture is taken to cover. */
export const FOV_HALF_DEG = 30;

/** The direction of a touch from the dial's centre: 0 up (north), 90 to the right, clockwise, 0 up to 360. */
export function touchAngle(dx: number, dy: number): number {
  return normalizeDeg((Math.atan2(dx, -dy) * 180) / Math.PI);
}

/** The heading after a finger moved from `startAngle` to `angle` round the centre; the dial turned with it. */
export function dialHeading(startHeading: number, startAngle: number, angle: number): number {
  return normalizeDeg(startHeading + (angle - startAngle));
}

/** Whole degrees, 0 up to 359 (what the survey file stores). */
export const wholeDegrees = (deg: number): number => Math.round(normalizeDeg(deg)) % 360;

/** The point on a circle of `radius` at `deg` clockwise from up, centred at (cx, cy). */
export function polar(cx: number, cy: number, radius: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [cx + radius * Math.sin(r), cy - radius * Math.cos(r)];
}

/** SVG path of the fan: a wedge from the centre opening ±FOV_HALF_DEG around `heading`. */
export function fanPath(cx: number, cy: number, radius: number, heading: number, half = FOV_HALF_DEG): string {
  const [x1, y1] = polar(cx, cy, radius, heading - half);
  const [x2, y2] = polar(cx, cy, radius, heading + half);
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${half * 2 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

const POINTS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'] as const;
/** "북동" for 45. */
export const compassWord = (deg: number): string => POINTS[Math.round(normalizeDeg(deg) / 45) % 8]!;

/** The direction from one place to another, degrees clockwise from north (a short distance: the flat approximation is exact enough). */
export function bearingDeg(from: readonly [number, number], to: readonly [number, number]): number {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  return normalizeDeg((Math.atan2(dx, to[1] - from[1]) * 180) / Math.PI);
}
