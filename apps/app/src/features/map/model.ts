import type { Feature, LineString } from 'geojson';
import type { CampusBuilding, CampusPlace, CampusRouteRequest, RoutePoint, TravelMode } from '../../contracts.ts';

export const TRAVEL_MODES: { value: TravelMode; label: string }[] = [
  { value: 'shortest', label: '가장 빠른 길' },
  { value: 'step_free', label: '계단 없는 길' },
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
  return { from: { kind: 'node', nodeId: from.id }, to: { kind: 'node', nodeId: to.id }, mode };
}
