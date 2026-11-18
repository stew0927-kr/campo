// Edge width (width_m, SPEC §4.2): how wide a way is on the ground. The height solver flattens a corridor this wide
// across (docs/ELEVATION_INTEGRATION.md), and the 3D view draws the way as a ribbon this wide. Routing does not read it.

/** Width (m) of an edge without width_m. */
export const DEFAULT_EDGE_WIDTH_M = 2.0;
/** Narrowest width_m accepted (m). Same as the schema's minimum. */
export const EDGE_WIDTH_MIN_M = 0.5;
/** Widest width_m accepted (m). Same as the schema's maximum. */
export const EDGE_WIDTH_MAX_M = 20;

/** A finite number from 0.5 to 20 m, both ends included. */
export function isValidEdgeWidth(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= EDGE_WIDTH_MIN_M && v <= EDGE_WIDTH_MAX_M;
}

/** The effective width of an edge (m): width_m when it is there and valid, otherwise 2.0 (out of range / not a number too). */
export function edgeWidthM(p: { width_m?: unknown }): number {
  return isValidEdgeWidth(p.width_m) ? p.width_m : DEFAULT_EDGE_WIDTH_M;
}
