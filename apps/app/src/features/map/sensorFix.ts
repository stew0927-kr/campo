import type { SensorFix } from '@campo/core';
export interface LocationSample {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy: number | null; speed: number | null; heading: number | null };
}
export function sensorFix(sample: LocationSample, baselineHpa: number | null, currentHpa: number | null): SensorFix {
  const { coords } = sample;
  const fix: SensorFix = { tMs: sample.timestamp, lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy ?? 999 };
  if (coords.speed !== null && coords.speed >= 0) fix.speedMps = coords.speed;
  if (coords.heading !== null && coords.heading >= 0) fix.headingDeg = coords.heading;
  if (baselineHpa !== null && currentHpa !== null) fix.baroDeltaM = -(currentHpa - baselineHpa) * 8.3;
  return fix;
}
