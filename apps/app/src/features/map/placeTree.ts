// 검색 화면의 계층 목록: 건물 → 층 → 시설(화장실·강의실·출입구 …). 검색어가 없을 때 보여 준다.
// React를 import하지 않는 순수 모듈.
import type { CampusBuilding, CampusPlace } from '../../contracts.ts';

/** 야외 장소 묶음의 id(건물 id와 겹치지 않는다). */
export const OUTDOOR_GROUP = '__outdoor__';
/** 건물 안이지만 층 기록이 없는 장소의 '층 미확인' 묶음(실제 층 번호와 겹치지 않는 값). */
export const UNKNOWN_LEVEL = -9999;

export interface BuildingGroup {
  id: string;
  name: string;
  /** 장소 수. */
  count: number;
  /** 층 수(야외는 0). */
  levelCount: number;
}
export interface LevelGroup { level: number; label: string; count: number }
export interface FacilityGroup { kind: FacilityKind; label: string; places: CampusPlace[] }
export type FacilityKind = 'restroom' | 'classroom' | 'entrance' | 'other';

const FACILITY_ORDER: FacilityKind[] = ['restroom', 'classroom', 'entrance', 'other'];
export const FACILITY_LABEL: Record<FacilityKind, string> = { restroom: '화장실', classroom: '강의실', entrance: '출입구', other: '기타 장소' };

export const floorText = (level: number) => (level < 0 ? `지하 ${-level}층` : `${level}층`);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko');

export function facilityKind(place: CampusPlace): FacilityKind {
  if (place.nodeType === 'restroom') return 'restroom';
  if (place.nodeType === 'door' && place.roomRef) return 'classroom';
  if (place.nodeType === 'entrance') return 'entrance';
  return 'other';
}

/** 큰 건물 목록(장소가 많은 건물 먼저, 같으면 이름순). 야외 장소가 있으면 맨 뒤에 "야외 장소". 장소가 없는 건물은 뺀다. */
export function buildingGroups(places: readonly CampusPlace[], buildings: readonly CampusBuilding[]): BuildingGroup[] {
  const groups = buildings
    .map((b) => ({ id: b.id, name: b.name, count: places.filter((p) => p.buildingId === b.id).length, levelCount: levelGroups(places, b.id).length }))
    .filter((g) => g.count > 0)
    .sort((a, b) => b.count - a.count || byName(a, b));
  const outdoor = places.filter((p) => p.buildingId === null).length;
  return outdoor > 0 ? [...groups, { id: OUTDOOR_GROUP, name: '야외 장소', count: outdoor, levelCount: 0 }] : groups;
}

/** 건물의 층 목록(낮은 층부터). 층 정보 없는 장소는 맨 뒤 '층 미확인'(level = UNKNOWN_LEVEL) 한 줄로 묶는다. */
export function levelGroups(places: readonly CampusPlace[], buildingId: string): LevelGroup[] {
  const counts = new Map<number, number>();
  let unknown = 0;
  for (const p of places) {
    if (p.buildingId !== buildingId) continue;
    if (p.level === null) unknown++;
    else counts.set(p.level, (counts.get(p.level) ?? 0) + 1);
  }
  const floors = [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([level, count]) => ({ level, label: floorText(level), count }));
  return unknown > 0 ? [...floors, { level: UNKNOWN_LEVEL, label: '층 미확인', count: unknown }] : floors;
}

/** 건물 한 층(또는 야외: buildingId = OUTDOOR_GROUP, level 무시; UNKNOWN_LEVEL은 층 미확인)의 시설을 종류별로. 빈 종류는 뺀다. */
export function facilityGroups(places: readonly CampusPlace[], buildingId: string, level: number | null): FacilityGroup[] {
  const want = level === UNKNOWN_LEVEL ? null : level;
  const scope = places.filter((p) => (buildingId === OUTDOOR_GROUP ? p.buildingId === null : p.buildingId === buildingId && p.level === want));
  return FACILITY_ORDER
    .map((kind) => ({ kind, label: FACILITY_LABEL[kind], places: scope.filter((p) => facilityKind(p) === kind).sort(byName) }))
    .filter((g) => g.places.length > 0);
}

/** 계층 탐색 위치. building이 null이면 건물 목록, level이 null이면 층 목록(야외는 바로 시설). */
export interface TreePath { building: string | null; level: number | null }
export const TREE_ROOT: TreePath = { building: null, level: null };

/** 한 단계 위로. */
export function treeUp(path: TreePath): TreePath {
  if (path.level !== null && path.building !== OUTDOOR_GROUP) return { building: path.building, level: null };
  return TREE_ROOT;
}
