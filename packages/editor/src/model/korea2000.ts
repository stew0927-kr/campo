// EPSG:5186 (Korea 2000 / Central Belt 2010) to and from WGS84 [longitude, latitude]: the CRS of the grid files of
// tools/elevation. No imports, so both the editor (model/terrain3d.ts) and its dev server (server/terrain.ts) use it.

type Position = [number, number];

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const LAT0 = (38 * Math.PI) / 180;
const LON0 = (127 * Math.PI) / 180;
const K0 = 1;
const FE = 200000;
const FN = 600000;

function meridian(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
}
const M0 = meridian(LAT0);

/** [longitude, latitude] → [x, y] metres in EPSG:5186. */
export function toKorea2000(p: Position): [number, number] {
  const phi = (p[1] * Math.PI) / 180;
  const lam = (p[0] * Math.PI) / 180;
  const [s, c, t] = [Math.sin(phi), Math.cos(phi), Math.tan(phi)];
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const a = (lam - LON0) * c;
  const x = FE + K0 * N * (a + ((1 - T + C) * a ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a ** 5) / 120);
  const y = FN + K0 * (meridian(phi) - M0 + N * t * (a * a / 2 + ((5 - T + 9 * C + 4 * C * C) * a ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

/** [x, y] metres in EPSG:5186 → [longitude, latitude]. */
export function fromKorea2000(x: number, y: number): Position {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const mu = (M0 + (y - FN) / K0) / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const [s, c, t] = [Math.sin(phi1), Math.cos(phi1), Math.tan(phi1)];
  const C1 = EP2 * c * c;
  const T1 = t * t;
  const N1 = A / Math.sqrt(1 - E2 * s * s);
  const R1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const D = (x - FE) / (N1 * K0);
  const phi = phi1 - ((N1 * t) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lam = LON0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [(lam * 180) / Math.PI, (phi * 180) / Math.PI];
}

