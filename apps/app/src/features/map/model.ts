import type { Feature, FeatureCollection, LineString, Polygon, Position } from 'geojson';
import { distanceM } from '../../route/slopeSections.ts';
import type { CampusBuilding, CampusPlace, CampusRouteRequest, RoutePoint, TravelMode } from '../../contracts.ts';

export const TRAVEL_MODES: { value: TravelMode; label: string }[] = [
  { value: 'shortest', label: '가장 빠른 길' },
  { value: 'step_free', label: '계단 없는 길' },
  { value: 'fewest_steps', label: '계단 최소' },
  { value: 'wheelchair', label: '휠체어' },
  { value: 'elevator_first', label: '엘리베이터 우선' },
];
export function placeDetail(place: CampusPlace, buildings: readonly CampusBuilding[]): string {
  const building = buildings.find((item) => item.id === place.buildingId)?.name;
  const floor = place.level === null ? null : place.level < 0 ? `지하 ${-place.level}층` : `${place.level}층`;
  return [building, floor, place.roomRef ? `${place.roomRef}호` : null].filter(Boolean).join(' · ') || '캠퍼스 야외';
}
export function searchPlaces(places: readonly CampusPlace[], buildings: readonly CampusBuilding[], query: string): CampusPlace[] {
  const words = query.trim().toLocaleLowerCase('ko').split(/\s+/).filter(Boolean);
  return places.filter((place) => {
    const text = `${place.name} ${placeDetail(place, buildings)}`.toLocaleLowerCase('ko');
    return words.every((word) => text.includes(word));
  }).sort((a, b) => `${placeDetail(a, buildings)} ${a.name}`.localeCompare(`${placeDetail(b, buildings)} ${b.name}`, 'ko'));
}
export function routeLine(points: readonly RoutePoint[]): Feature<LineString> | null {
  if (points.length < 2 || points.some((p) => !Number.isFinite(p.lng) || !Number.isFinite(p.lat))) return null;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) } };
}
export function routeBounds(points: readonly RoutePoint[]): [number, number, number, number] | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.lng), ys = points.map((p) => p.lat);
  // A small margin also makes a zero-distance route fit a usable viewport.
  return [Math.min(...xs) - 0.0003, Math.min(...ys) - 0.0003, Math.max(...xs) + 0.0003, Math.max(...ys) + 0.0003];
}
export function requestFor(from: CampusPlace | null, to: CampusPlace | null, mode: TravelMode): CampusRouteRequest | null {
  if (!from || !to) return null;
  return { from: endpointFor(from), to: endpointFor(to), mode };
}

export function endpointFor(place: CampusPlace): import('../../contracts.ts').RouteEndpoint {
  return place.nodeType === 'gps' || place.nodeType === 'point'
    ? { kind: 'point', lat: place.lat, lng: place.lng } : { kind: 'node', nodeId: place.id };
}
export function pointPlace(point: RoutePoint, name: string): CampusPlace {
  return { id: `point:${point.lng}:${point.lat}`, name, nodeType: 'point', buildingId: null, level: null, ...point };
}
export function placesInScope(places: readonly CampusPlace[], buildingId: string | null, level: number | null): CampusPlace[] {
  return places.filter((p) => buildingId === null ? p.buildingId === null : p.buildingId === buildingId && p.level === level);
}

type LngLat = [number, number];
export { distanceM } from '../../route/slopeSections.ts';
/** Pins this far (m) or more from the route line's ends get a dashed connector. */
export const CONNECTOR_MIN_M = 1.5;
/**
 * Dashed connectors from the start pin to the route line's first point and from its last point to the end pin.
 * A point picked on the map is snapped to the nearest walkable way (a step-free route may snap further away), so the
 * line would otherwise stop short of the pin. Only gaps of `minM` or more are drawn.
 */
export function routeConnectors(polyline: readonly RoutePoint[], from: RoutePoint | null, to: RoutePoint | null, minM = CONNECTOR_MIN_M): FeatureCollection<LineString, { end: 'from' | 'to' }> {
  const features: Feature<LineString, { end: 'from' | 'to' }>[] = [];
  const first = polyline[0], last = polyline[polyline.length - 1];
  const valid = (p: RoutePoint | null | undefined): p is RoutePoint => !!p && Number.isFinite(p.lng) && Number.isFinite(p.lat);
  const add = (end: 'from' | 'to', a: RoutePoint | null, b: RoutePoint | undefined) => {
    if (!valid(a) || !valid(b)) return;
    const pa: LngLat = [a.lng, a.lat], pb: LngLat = [b.lng, b.lat];
    if (distanceM(pa, pb) < minM) return;
    features.push({ type: 'Feature', properties: { end }, geometry: { type: 'LineString', coordinates: end === 'from' ? [pa, pb] : [pb, pa] } });
  };
  add('from', from, first);
  add('to', to, last);
  return { type: 'FeatureCollection', features };
}
/** [west, south, east, north] around coordinates, or null when there are none. */
export function coordinateBounds(coordinates: readonly (readonly [number, number])[]): [number, number, number, number] | null {
  return routeBounds(coordinates.map(([lng, lat]) => ({ lng, lat })));
}

/** Twice the signed area of a ring (positive = counter-clockwise in lng/lat). */
function signedArea(ring: readonly Position[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j]![0]! * ring[i]![1]!) - (ring[i]![0]! * ring[j]![1]!);
  return sum;
}
/**
 * Indoor mode: a polygon covering `bounds` with the building's outer outline cut out, drawn as a dark veil so only
 * this building reads as selectable. The outer ring is counter-clockwise and the hole clockwise (RFC 7946).
 */
export function outsideMask(bounds: readonly [number, number, number, number], outline: readonly (readonly Position[])[] | null | undefined): Feature<Polygon> | null {
  const ring = outline?.[0];
  if (!ring || ring.length < 4) return null;
  const [w, s, e, n] = bounds;
  const outer: Position[] = [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const hole = ring.map((p) => [p[0]!, p[1]!]);
  if (signedArea(hole) > 0) hole.reverse();
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [outer, hole] } };
}
/** Whether a point is inside the outline's outer ring and outside its holes (even-odd ray casting). */
export function insideOutline(point: RoutePoint, outline: readonly (readonly Position[])[] | null | undefined): boolean {
  if (!outline?.length) return false;
  const inRing = (ring: readonly Position[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number], [xj, yj] = ring[j] as [number, number];
      if ((yi > point.lat) !== (yj > point.lat) && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return inRing(outline[0]!) && !outline.slice(1).some(inRing);
}

/** Map bearing normalised to (-180, 180]. */
export function normalizeBearing(bearing: number): number {
  if (!Number.isFinite(bearing)) return 0;
  const b = ((bearing % 360) + 360) % 360;
  return b > 180 ? b - 360 : b;
}
/** Below this (degrees of rotation or pitch) the map counts as north-up and flat. */
export const NORTH_UP_TOLERANCE = 0.5;
/**
 * Compass needle: the map is rotated `bearing` degrees clockwise, so north on screen is `-bearing`.
 * `rotation` is the needle's clockwise rotation in degrees; `northUp` is true when the map is neither rotated nor tilted.
 */
export function compassState(bearing: number, pitch = 0): { rotation: number; northUp: boolean } {
  const b = normalizeBearing(bearing);
  const rotation = b === 0 ? 0 : -b;
  return { rotation, northUp: Math.abs(b) < NORTH_UP_TOLERANCE && !(Math.abs(pitch) >= NORTH_UP_TOLERANCE) };
}
