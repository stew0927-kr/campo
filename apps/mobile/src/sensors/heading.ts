// Smoothing a compass heading without the jump at north: the step is taken along the shorter way round, so 359° → 1°
// moves by 2°, not by 358°. Pure, so it is tested in Node.
import { normalizeDeg } from '@campo/core';

/** How far each new reading pulls the shown heading (0..1). About a third: steady, yet it follows a turn within a few readings. */
export const HEADING_ALPHA = 0.35;
/** A turn bigger than this is followed at once (the surveyor turned round), not eased. */
export const HEADING_JUMP_DEG = 90;

/** The shorter turn from `from` to `to`, -180 up to 180. */
export function turnDeg(from: number, to: number): number {
  const d = normalizeDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** The next shown heading after `reading`, starting from `previous` (undefined before the first reading). */
export function smoothHeading(previous: number | undefined, reading: number, alpha = HEADING_ALPHA): number {
  if (previous === undefined) return normalizeDeg(reading);
  const turn = turnDeg(previous, reading);
  if (Math.abs(turn) > HEADING_JUMP_DEG) return normalizeDeg(reading);
  return normalizeDeg(previous + alpha * turn);
}

/**
 * Which north the headings read here are against. Both sources give magnetic north: the system heading is read as
 * `magHeading` (device.ts), and the raw magnetometer knows nothing else. A photo's sensor value is stored with this.
 */
export const SENSOR_HEADING_REF = 'magnetic' as const;

/** The compass accuracy class the system reports (expo-location: 3 best, 0 unreliable), or undefined for anything else. */
export function headingAccuracyClass(raw: unknown): 0 | 1 | 2 | 3 | undefined {
  return raw === 0 || raw === 1 || raw === 2 || raw === 3 ? raw : undefined;
}
