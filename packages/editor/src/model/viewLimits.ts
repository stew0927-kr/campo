// How far the map may be moved: read from campus.json (map_limits), never written into the code,
// so a campus that declares its own area gets it and one that declares nothing is not limited.
import type { MapLimits } from '@campo/core';

/** Zoom the map opens at, kept inside the campus's limits. */
export const START_ZOOM = 17;

export interface ViewLimits {
  /** [[west, south], [east, north]] as MapLibre takes it; null removes the limit. */
  maxBounds: [[number, number], [number, number]] | null;
  /** null: MapLibre's own default. */
  minZoom: number | null;
  maxZoom: number | null;
}

export function viewLimits(limits: MapLimits | undefined): ViewLimits {
  if (!limits) return { maxBounds: null, minZoom: null, maxZoom: null };
  const [west, south, east, north] = limits.bounds;
  return { maxBounds: [[west, south], [east, north]], minZoom: limits.min_zoom, maxZoom: limits.max_zoom };
}

export function startZoom(limits: MapLimits | undefined): number {
  return limits ? Math.min(limits.max_zoom, Math.max(limits.min_zoom, START_ZOOM)) : START_ZOOM;
}
