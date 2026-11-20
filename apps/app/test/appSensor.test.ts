import { describe, expect, it } from 'vitest';
import { sensorFix, type LocationSample } from '../src/features/map/sensorFix.ts';
const location: LocationSample = { timestamp: 1234, coords: { latitude: 37.5, longitude: 127, accuracy: 5, speed: 1.2, heading: 90 } };
describe('map sensor adapter', () => {
  it('converts falling pressure to positive height without storing absolute pressure', () => {
    const fix = sensorFix(location, 1000, 999);
    expect(fix.baroDeltaM).toBeCloseTo(8.3);
    expect(Object.keys(fix).sort()).toEqual(['accuracyM', 'baroDeltaM', 'headingDeg', 'lat', 'lng', 'speedMps', 'tMs']);
    expect(sensorFix(location, 1000, 1001).baroDeltaM).toBeCloseTo(-8.3);
  });
  it('supports GPS-only devices and omits unavailable speed and heading', () => {
    const fix = sensorFix({ ...location, coords: { ...location.coords, accuracy: null, speed: -1, heading: -1 } }, null, null);
    expect(fix).toEqual({ tMs: 1234, lat: 37.5, lng: 127, accuracyM: 999 });
  });
});
