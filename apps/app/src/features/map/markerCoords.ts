// Pure guards for map marker coordinates (no React). A native Marker throws IllegalArgumentException on NaN, which kills the screen.
export function isValidLngLat(lng: unknown, lat: unknown): boolean {
  return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
export function validLngLat(lng: unknown, lat: unknown): [number, number] | null {
  return isValidLngLat(lng, lat) ? [lng as number, lat as number] : null;
}
export function validLngLatTuple(pair: unknown): [number, number] | null {
  return Array.isArray(pair) && pair.length >= 2 ? validLngLat(pair[0], pair[1]) : null;
}
