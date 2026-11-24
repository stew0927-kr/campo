// 경로 테스트 → 찾아보기: the route places (model/places.ts) grouped 건물 → 층 → 장소, so a long list never has to be scrolled.
// Pure: no React, so it is tested in Node.
import type { Place } from './places.ts';
import { floorLabel } from './scope.ts';

/** The group of places with no building (pois, points not inside a building). */
export const OUTDOOR_GROUP = '__outdoor__';
export const OUTDOOR_GROUP_NAME = '야외·기타 장소';

export interface BuildingGroup {
  /** The building id, or OUTDOOR_GROUP. */
  id: string;
  name: string;
  /** Places in it. */
  count: number;
  /** Distinct floors among them (a floor not recorded counts as one). */
  levelCount: number;
}

export interface LevelGroup {
  /** null: the floor was not recorded. */
  level: number | null;
  label: string;
  count: number;
}

export type PlaceSectionId = 'room' | 'restroom' | 'entrance' | 'other';
export const PLACE_SECTION_TITLE: Record<PlaceSectionId, string> = {
  room: '강의실',
  restroom: '화장실',
  entrance: '출입구',
  other: '기타',
};
const SECTION_ORDER: PlaceSectionId[] = ['room', 'restroom', 'entrance', 'other'];

export const groupOf = (p: Place): string => p.buildingId ?? OUTDOOR_GROUP;

/** Buildings with the most places first (same count: by name), then the 야외·기타 group last. */
export function buildingGroups(places: readonly Place[]): BuildingGroup[] {
  const by = new Map<string, { name: string; count: number; levels: Set<number | null> }>();
  for (const p of places) {
    const id = groupOf(p);
    let g = by.get(id);
    if (!g) by.set(id, (g = { name: id === OUTDOOR_GROUP ? OUTDOOR_GROUP_NAME : p.buildingName || id, count: 0, levels: new Set() }));
    g.count += 1;
    g.levels.add(p.level);
  }
  const groups = [...by].map(([id, g]) => ({ id, name: g.name, count: g.count, levelCount: g.levels.size }));
  return groups.sort(
    (a, b) =>
      Number(a.id === OUTDOOR_GROUP) - Number(b.id === OUTDOOR_GROUP) ||
      b.count - a.count ||
      a.name.localeCompare(b.name, 'ko'),
  );
}

/** The floors of one group: lowest first, a floor not recorded ('층 미확인') last. */
export function levelGroups(places: readonly Place[], buildingId: string): LevelGroup[] {
  const by = new Map<number | null, number>();
  for (const p of places) if (groupOf(p) === buildingId) by.set(p.level, (by.get(p.level) ?? 0) + 1);
  return [...by]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([level, count]) => ({ level, label: level === null ? '층 미확인' : floorLabel(level), count }));
}

/** The places on one floor of one group, in routePlaces order (room numbers numerically). */
export function placesOnFloor(places: readonly Place[], buildingId: string, level: number | null): Place[] {
  return places.filter((p) => groupOf(p) === buildingId && p.level === level);
}

export function placeSection(p: Place): PlaceSectionId {
  if (p.kind === 'door') return 'room';
  if (p.nodeType === 'restroom') return 'restroom';
  if (p.nodeType === 'entrance') return 'entrance';
  return 'other';
}

/** A floor's places under 강의실 / 화장실 / 출입구 / 기타 headings, empty headings left out. */
export function placeSections(places: readonly Place[]): { id: PlaceSectionId; title: string; places: Place[] }[] {
  return SECTION_ORDER
    .map((id) => ({ id, title: PLACE_SECTION_TITLE[id], places: places.filter((p) => placeSection(p) === id) }))
    .filter((s) => s.places.length > 0);
}
