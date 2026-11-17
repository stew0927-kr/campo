// Sensor arithmetic of the field survey, as pure functions (the app only feeds readings in).

const SEA_LEVEL_HPA = 1013.25;
const BARO_SCALE_M = 44330;
const BARO_EXPONENT = 1 / 5.255;

/** International barometric formula: altitude (m) of a pressure reading in the standard atmosphere. */
function pressureAltitudeM(hpa: number): number {
  return BARO_SCALE_M * (1 - (hpa / SEA_LEVEL_HPA) ** BARO_EXPONENT);
}

/**
 * Height gained (m) between two pressure readings taken a short time apart: positive going up (pressure falls).
 * Only the difference is used, so the weather's absolute pressure cancels out (about 0.12 hPa per metre near the ground).
 */
export function heightFromPressure(startHpa: number, endHpa: number): number {
  return pressureAltitudeM(endHpa) - pressureAltitudeM(startHpa);
}

/** Slope in percent: height over plan length. undefined when the two ends are at the same spot. */
export function gradePct(heightM: number, planLengthM: number): number | undefined {
  return planLengthM > 0 ? (heightM / planLengthM) * 100 : undefined;
}

/** Any angle in degrees as 0 up to 360. */
export function normalizeDeg(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return d === 0 ? 0 : d; // no -0
}

/**
 * Heading of the phone's top edge, degrees clockwise from magnetic north, from the magnetometer's x (to the right of the
 * screen) and y (to the top). Right only while the phone is held flat. undefined when there is no horizontal field.
 */
export function headingFromMagnetometer(x: number, y: number): number | undefined {
  if (x === 0 && y === 0) return undefined;
  return normalizeDeg((Math.atan2(-x, y) * 180) / Math.PI);
}

/** Mean of headings in degrees (350 and 10 give 0, not 180). undefined for no readings or readings that cancel out. */
export function circularMeanDeg(headings: readonly number[]): number | undefined {
  let sin = 0;
  let cos = 0;
  for (const h of headings) {
    sin += Math.sin((h * Math.PI) / 180);
    cos += Math.cos((h * Math.PI) / 180);
  }
  if (Math.hypot(sin, cos) < 1e-9) return undefined;
  return normalizeDeg((Math.atan2(sin, cos) * 180) / Math.PI);
}
