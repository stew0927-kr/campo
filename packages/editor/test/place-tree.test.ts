// 경로 테스트 → 찾아보기: route places grouped 건물 → 층 → 장소 (model/placeTree.ts).
import { describe, expect, it } from 'vitest';
import type { Place } from '../src/model/places.ts';
import { OUTDOOR_GROUP, buildingGroups, levelGroups, placeSections, placesOnFloor } from '../src/model/placeTree.ts';

const place = (id: string, buildingId: string | null, buildingName: string, level: number | null, extra: Partial<Place> = {}): Place => ({
  id, label: id, buildingId, buildingName, level, kind: buildingId ? 'door' : 'poi', nodeType: buildingId ? 'door' : 'poi', ...extra,
});

const PLACES: Place[] = [
  place('정문', null, '', null),
  place('ctr101', 'b_ctr', '공업센터', 1),
  place('ctr301', 'b_ctr', '공업센터', 3),
  place('ctr302', 'b_ctr', '공업센터', 3),
  place('ctr_wc', 'b_ctr', '공업센터', 3, { kind: 'other', nodeType: 'restroom', gender: 'female' }),
  place('ctr_ent', 'b_ctr', '공업센터', 3, { kind: 'other', nodeType: 'entrance' }),
  place('ctr_b1', 'b_ctr', '공업센터', -1),
  place('ctr_x', 'b_ctr', '공업센터', null),
  place('lib1', 'b_lib', '백남학술정보관', 1),
  place('eng1', 'b_eng', '제2공학관', 1),
];

describe('buildingGroups', () => {
  it('puts the building with the most places first, ties by name, and 야외·기타 last', () => {
    expect(buildingGroups(PLACES)).toEqual([
      { id: 'b_ctr', name: '공업센터', count: 7, levelCount: 4 },
      { id: 'b_lib', name: '백남학술정보관', count: 1, levelCount: 1 },
      { id: 'b_eng', name: '제2공학관', count: 1, levelCount: 1 },
      { id: OUTDOOR_GROUP, name: '야외·기타 장소', count: 1, levelCount: 1 },
    ]);
  });

  it('is empty for no places', () => {
    expect(buildingGroups([])).toEqual([]);
  });
});

describe('levelGroups', () => {
  it('lists floors lowest first, with 지하 and 층 미확인 last', () => {
    expect(levelGroups(PLACES, 'b_ctr')).toEqual([
      { level: -1, label: '지하 1층', count: 1 },
      { level: 1, label: '1층', count: 1 },
      { level: 3, label: '3층', count: 4 },
      { level: null, label: '층 미확인', count: 1 },
    ]);
  });

  it('groups the places without a building as one floor-less group', () => {
    expect(levelGroups(PLACES, OUTDOOR_GROUP)).toEqual([{ level: null, label: '층 미확인', count: 1 }]);
  });
});

describe('placesOnFloor / placeSections', () => {
  it('keeps one floor of one building, in the given order', () => {
    expect(placesOnFloor(PLACES, 'b_ctr', 3).map((p) => p.id)).toEqual(['ctr301', 'ctr302', 'ctr_wc', 'ctr_ent']);
    expect(placesOnFloor(PLACES, 'b_ctr', null).map((p) => p.id)).toEqual(['ctr_x']);
    expect(placesOnFloor(PLACES, OUTDOOR_GROUP, null).map((p) => p.id)).toEqual(['정문']);
  });

  it('heads the floor with 강의실 / 화장실 / 출입구 / 기타, leaving empty ones out', () => {
    expect(placeSections(placesOnFloor(PLACES, 'b_ctr', 3)).map((s) => [s.title, s.places.map((p) => p.id)])).toEqual([
      ['강의실', ['ctr301', 'ctr302']],
      ['화장실', ['ctr_wc']],
      ['출입구', ['ctr_ent']],
    ]);
    expect(placeSections(placesOnFloor(PLACES, OUTDOOR_GROUP, null)).map((s) => s.title)).toEqual(['기타']);
  });
});
