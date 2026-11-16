// Local ENU (east-north-up) metres around one reference point, for the map matcher (docs/MAP_MATCHING.md).
//
// A campus spans a few kilometres, so a tangent plane at the campus centre is accurate to well under 0.1 % (the error
// grows with the square of the distance from the origin: about 1 cm at 2 km). Every function is pure and allocation
// free unless it returns a tuple, so the matcher can call them in its per-fix loop.

/** WGS84 semi-major axis (m) and first eccentricity squared. */
const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;
const DEG = Math.PI / 180;

/** A local plane: x metres east and y metres north of (lng0, lat0). */
export interface LocalFrame {
  readonly lng0: number;
  readonly lat0: number;
  /** Metres per degree of longitude / latitude at lat0 (WGS84 radii of curvature). */
  readonly mPerDegLng: number;
  readonly mPerDegLat: number;
}

/** The local frame whose origin is (lng0, lat0). */
export function createFrame(lng0: number, lat0: number): LocalFrame {
  const s = Math.sin(lat0 * DEG);
  const w = 1 - WGS84_E2 * s * s;
  const meridian = (WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w));
  const prime = WGS84_A / Math.sqrt(w);
  return { lng0, lat0, mPerDegLng: prime * Math.cos(lat0 * DEG) * DEG, mPerDegLat: meridian * DEG };
}

/** Metres east of the frame origin. */
export function toX(frame: LocalFrame, lng: number): number {
  return (lng - frame.lng0) * frame.mPerDegLng;
}

/** Metres north of the frame origin. */
export function toY(frame: LocalFrame, lat: number): number {
  return (lat - frame.lat0) * frame.mPerDegLat;
}

/** [x, y] metres of a longitude / latitude. */
export function toLocal(frame: LocalFrame, lng: number, lat: number): [number, number] {
  return [toX(frame, lng), toY(frame, lat)];
}

/** Longitude of a local x. */
export function toLng(frame: LocalFrame, x: number): number {
  return frame.lng0 + x / frame.mPerDegLng;
}

/** Latitude of a local y. */
export function toLat(frame: LocalFrame, y: number): number {
  return frame.lat0 + y / frame.mPerDegLat;
}

/** [lng, lat] of a local point (the inverse of toLocal). */
export function toLngLat(frame: LocalFrame, x: number, y: number): [number, number] {
  return [toLng(frame, x), toLat(frame, y)];
}

/** Compass bearing of the vector (dx east, dy north): degrees clockwise from north, 0 up to 360. NaN for a zero vector. */
export function bearingDeg(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return Number.NaN;
  const b = Math.atan2(dx, dy) / DEG;
  return b < 0 ? b + 360 : b;
}

/** Signed smallest difference a − b of two bearings, degrees in (−180, 180]. */
export function signedAngleDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** cos of the angle between bearing `deg` and the vector (dx, dy). NaN for a zero vector. */
export function cosToBearing(deg: number, dx: number, dy: number): number {
  const n = Math.hypot(dx, dy);
  if (n === 0) return Number.NaN;
  // Bearing deg points to (sin, cos) in east / north.
  return (Math.sin(deg * DEG) * dx + Math.cos(deg * DEG) * dy) / n;
}

/** Squared distance from (px, py) to the segment (ax, ay)–(bx, by), and the share 0–1 of the foot along it. */
export function projectOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, out: Float64Array): void {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let s = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  if (s < 0) s = 0;
  else if (s > 1) s = 1;
  const fx = ax + s * vx - px;
  const fy = ay + s * vy - py;
  out[0] = fx * fx + fy * fy;
  out[1] = s;
}

/** Whether (x, y) lies inside a ring of local points (even-odd rule; xs / ys of the ring, closing point optional). */
export function pointInRing(x: number, y: number, xs: ArrayLike<number>, ys: ArrayLike<number>): boolean {
  let inside = false;
  const n = xs.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xs[i]!;
    const yi = ys[i]!;
    const xj = xs[j]!;
    const yj = ys[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
