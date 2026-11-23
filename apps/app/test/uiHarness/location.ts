// Test-only GPS. Denied by default; a scenario may set window.__campoGps to simulate a granted fix.
type Gps = { lat: number; lng: number } | undefined;
const fix = (): Gps => (window as unknown as { __campoGps?: Gps }).__campoGps;
export const Accuracy = { High: 1, BestForNavigation: 2 };
export async function requestForegroundPermissionsAsync() { return fix() ? { status: 'granted', granted: true, canAskAgain: true } : { status: 'denied', granted: false, canAskAgain: true }; }
export const getForegroundPermissionsAsync = requestForegroundPermissionsAsync;
export async function getCurrentPositionAsync() {
  const value = fix();
  if (!value) throw Error('Test harness has no device GPS');
  return { timestamp: Date.now(), coords: { latitude: value.lat, longitude: value.lng, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null } };
}
export async function watchPositionAsync() { throw Error('Test harness has no device GPS'); }
