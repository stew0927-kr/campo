// Turf wrappers. Every call passes { units: 'meters' } (Turf's default is kilometres, SPEC-v0.2 §6).
import length from '@turf/length';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import distance from '@turf/distance';
import type { Position } from '../types.ts';

/** Geodesic length of a polyline in metres. */
export function lineLength(coords: readonly Position[]): number {
  if (coords.length < 2) return 0;
  return length({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map((p) => [p[0], p[1]]) } }, { units: 'meters' });
}

export function metres(a: Position, b: Position): number {
  return distance(a, b, { units: 'meters' });
}

export interface Foot {
  coord: Position;
  /** Index of the segment the foot lies on (coords[i] → coords[i + 1]). */
  segmentIndex: number;
  /** Distance from the point to the line, metres. */
  pointDistance: number;
}

/** Foot of the perpendicular from `point` onto the polyline (Turf 7.4 property names). */
export function footOnLine(coords: readonly Position[], point: Position): Foot {
  const snapped = nearestPointOnLine({ type: 'LineString', coordinates: coords.map((p) => [p[0], p[1]]) }, point, { units: 'meters' });
  const [lng, lat] = snapped.geometry.coordinates;
  return {
    coord: [lng!, lat!],
    segmentIndex: Math.min(snapped.properties.segmentIndex, coords.length - 2),
    pointDistance: snapped.properties.pointDistance,
  };
}
