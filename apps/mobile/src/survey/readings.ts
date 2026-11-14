// Turning sensor readings into what the survey file stores (docs/mobile/SPEC-mobile.md 3).
import {
  edgeCoords, gradePct, heightFromPressure, lineLength, normalizeDeg,
  refAfter, type EditState, type VerticalMeasurement,
} from '@campo/core';

/** A grade is only written for edges at least this long: over a shorter run the barometer's noise (about a metre) is the whole answer. */
export const MIN_GRADE_LENGTH_M = 5;
/** A pressure read longer ago than this is not compared with a new one: the weather has moved by then. */
export const MAX_PRESSURE_AGE_MS = 10 * 60_000;

const round = (value: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** Pressure as stored: hPa with two decimals. */
export const storedPressure = (hpa: number): number => round(hpa, 2);

/** Heading as stored: one decimal, never 360 (359.96 rounds to 0). Rounding comes last so no float error is added after it. */
export function storedHeading(deg: number): number {
  const rounded = round(normalizeDeg(deg), 1);
  return rounded >= 360 ? 0 : rounded;
}

/** A photo's direction as stored: whole degrees, 0 up to 359 (the dial works in whole degrees). */
export const storedPhotoHeading = (deg: number): number => Math.round(normalizeDeg(deg)) % 360;

/** A pressure and when it was read (ISO 8601). */
export interface PressureReading {
  hpa: number;
  at: string;
}

/** The reading's pressure, when it was read recently enough to compare with one read at `nowIso`. */
export function recentPressure(reading: PressureReading | null, nowIso: string): number | null {
  if (!reading) return null;
  const age = Date.parse(nowIso) - Date.parse(reading.at);
  return age >= 0 && age <= MAX_PRESSURE_AGE_MS ? reading.hpa : null;
}

export interface WalkedEdge {
  state: EditState;
  edgeId: string;
  /** The edge is stored against the direction walked (an existing edge drawn the other way). */
  reversed: boolean;
  /** Pressure where the walk along the edge began and ended. */
  startHpa: number;
  endHpa: number;
  at: string;
}

/**
 * The measurement of one walked edge, turned into the edge's own direction: height_m is the rise from its `from` to
 * its `to`. The grade is left out for indoor stairs and elevators (their two ends are drawn at one spot) and short edges.
 */
export function verticalMeasurement({ state, edgeId, reversed, startHpa, endHpa, at }: WalkedEdge): VerticalMeasurement {
  const [fromHpa, toHpa] = reversed ? [endHpa, startHpa] : [startHpa, endHpa];
  const height = heightFromPressure(fromHpa, toHpa);
  const edge = state.edges[edgeId];
  const length = edge ? lineLength(edgeCoords(state, edge)) : 0;
  const sloped = edge !== undefined && edge.props.edge_type !== 'indoor' && length >= MIN_GRADE_LENGTH_M;
  const grade = sloped ? gradePct(height, length) : undefined;
  return {
    edge_id: edgeId,
    pressure_start_hpa: storedPressure(fromHpa),
    pressure_end_hpa: storedPressure(toHpa),
    height_m: round(height, 2),
    ...(grade !== undefined ? { grade_pct: round(grade, 1) } : {}),
    method: 'barometer',
    measured_at: at,
  };
}

/** The room number after `ref` along a corridor: "408" → "409", "B101" → "B102", "12-3" → "12-4". Unchanged when it has no number. */
export function nextRoomRef(ref: string): string {
  return refAfter(ref, 1) ?? ref; // core's rule, the one the editor's 호실 연속 입력 uses
}
