// Measured times from calibration.json, as routing reads them (SPEC-v0.2 3.9).
// Only the keys and estimate_sec matter here; computing the estimates is the
// calibration module's job (npm run calibrate).

/** Calibration key of a walk link over edge `edgeId`: as drawn, or against the drawing ("#backward"). */
export function edgeTargetKey(edgeId: string, traversal: 'along' | 'against'): string {
  return traversal === 'along' ? `edge:${edgeId}` : `edge:${edgeId}#backward`;
}

/** Calibration key of the wait for elevator `elevatorId` (its board links). */
export function elevatorTargetKey(elevatorId: string): string {
  return `elevator:${elevatorId}`;
}

/**
 * key → estimate_sec for every entry that has the shape routing needs: an object
 * value whose estimate_sec is a finite number above 0. Anything else (not an
 * object, an array, a missing or non-positive estimate) is ignored, so a broken
 * calibration.json falls back to the predicted times instead of breaking routes.
 */
export function measuredTimes(calibration: unknown): ReadonlyMap<string, number> {
  const times = new Map<string, number>();
  if (!isRecord(calibration)) return times;
  for (const [key, entry] of Object.entries(calibration)) {
    if (!isRecord(entry)) continue;
    const sec = entry['estimate_sec'];
    if (typeof sec === 'number' && Number.isFinite(sec) && sec > 0) times.set(key, sec);
  }
  return times;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
