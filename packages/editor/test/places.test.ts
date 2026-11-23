// 경로 테스트: departure / arrival candidates sorted by building first, then floor and room (model/places.ts).
import { describe, expect, it } from 'vitest';
import { addBuilding, addNode, createHistory, emptyState, type EditState, type Position } from '@campo/core';
import { routePlaces } from '../src/model/places.ts';

const square = (x: number, y: number): Position[][] => [
  [
    [x, y],
    [x + 0.0005, y],
    [x + 0.0005, y + 0.0005],
    [x, y + 0.0005],
    [x, y],
  ],
];

/** 공업센터(1·3층) and 제2공학관(1·2·3층), each with the rooms from the bug report, plus two pois and a duplicate. */
function state(): EditState {
  const h = createHistory(emptyState());
  h.perform(addBuilding({ code: 'ENGCTR', name: '공업센터', levels: [1, 3], polygon: square(127.0, 37.5) }));
  h.perform(addBuilding({ code: 'ENG2', name: '제2공학관', levels: [1, 2, 3], polygon: square(127.002, 37.5) }));

  const door = (id: string, building_id: string, level: number, room_ref: string, extra: Record<string, unknown> = {}) => {
    h.perform(
      addNode({
        id,
        coord: [127.0002, 37.5002],
        props: { kind: 'node', node_type: 'door', building_id, level, room_ref, source: 'test', ...extra },
      }),
    );
  };
  const poi = (id: string, name: string | undefined) => {
    h.perform(
      addNode({
        id,
        coord: [127.001, 37.501],
        props: { kind: 'node', node_type: 'poi', building_id: null, level: null, ...(name !== undefined ? { name } : {}), source: 'test' },
      }),
    );
  };

  // Deliberately added out of order: sorting must not depend on insertion order.
  door('d_ctr_302', 'bldg_ENGCTR', 3, '302');
  door('d_eng2_202', 'bldg_ENG2', 2, '202');
  door('d_ctr_301', 'bldg_ENGCTR', 3, '301');
  door('d_eng2_10', 'bldg_ENG2', 1, '10');
  door('d_ctr_305-2', 'bldg_ENGCTR', 3, '305-2');
  door('d_eng2_9', 'bldg_ENG2', 1, '9');
  door('d_ctr_305-1', 'bldg_ENGCTR', 3, '305-1');
  // Same room number on another floor of the same building: floor decides first.
  door('d_ctr_101', 'bldg_ENGCTR', 1, '101');
  door('d_eng2_301', 'bldg_ENG2', 3, '301');
  // Two doors with the very same label: both must stay findable, told apart by id.
  door('d_dup_a', 'bldg_ENGCTR', 1, '101');
  poi('p_main', '정문');
  poi('p_lib', '중앙도서관');
  poi('p_unnamed', undefined);
  return h.current();
}

const labels = (s: EditState) => routePlaces(s).map((p) => p.label);

describe('routePlaces', () => {
  it('keeps the rooms of one building together, building name then floor then room number', () => {
    const got = labels(state());
    expect(got).toEqual([
      // Pois carry no building: they sort first, by name.
      '정문',
      '중앙도서관',
      'p_unnamed',
      // 공업센터 (ㄱ) before 제2공학관 (ㅈ); 1층 before 3층; 9호-style numbers sort numerically.
      '101호 (공업센터 1층) · d_ctr_101',
      '101호 (공업센터 1층) · d_dup_a',
      '301호 (공업센터 3층)',
      '302호 (공업센터 3층)',
      '305-1호 (공업센터 3층)',
      '305-2호 (공업센터 3층)',
      '9호 (제2공학관 1층)',
      '10호 (제2공학관 1층)',
      '202호 (제2공학관 2층)',
      '301호 (제2공학관 3층)',
    ]);
  });

  it('sorts room numbers numerically, not as text', () => {
    const got = labels(state());
    expect(got.indexOf('9호 (제2공학관 1층)')).toBeLessThan(got.indexOf('10호 (제2공학관 1층)'));
  });

  it('does not mix a room number of one building into another building', () => {
    const got = labels(state());
    const ctr301 = got.indexOf('301호 (공업센터 3층)');
    const eng202 = got.indexOf('202호 (제2공학관 2층)');
    const eng301 = got.indexOf('301호 (제2공학관 3층)');
    expect(eng202).toBeLessThan(eng301);
    expect(ctr301).toBeLessThan(eng202);
  });

  it('gives every place a unique label, keeping the id only where two collide', () => {
    const places = routePlaces(state());
    expect(new Set(places.map((p) => p.label)).size).toBe(places.length);
    expect(places.find((p) => p.id === 'd_dup_a')?.label).toBe('101호 (공업센터 1층) · d_dup_a');
    expect(places.find((p) => p.id === 'd_ctr_302')?.label).toBe('302호 (공업센터 3층)');
  });

  it('carries where each place stands, for the 건물 → 층 → 장소 browser', () => {
    const places = routePlaces(state());
    expect(places.find((p) => p.id === 'd_ctr_302')).toEqual({
      id: 'd_ctr_302', label: '302호 (공업센터 3층)', buildingId: 'bldg_ENGCTR', buildingName: '공업센터', level: 3, kind: 'door', nodeType: 'door',
    });
    expect(places.find((p) => p.id === 'p_main')).toEqual({
      id: 'p_main', label: '정문', buildingId: null, buildingName: '', level: null, kind: 'poi', nodeType: 'poi',
    });
  });

  it('adds restrooms (named by gender when they have no name) and named entrances, with the gender kept', () => {
    const h = createHistory(emptyState());
    h.perform(addBuilding({ code: 'ENGCTR', name: '공업센터', levels: [1], polygon: square(127.0, 37.5) }));
    const node = (id: string, props: Record<string, unknown>) =>
      h.perform(addNode({ id, coord: [127.0002, 37.5002], props: { kind: 'node', building_id: 'bldg_ENGCTR', level: 1, source: 'test', ...props } as never }));
    node('wc_m', { node_type: 'restroom', restroom_gender: 'male' });
    node('wc_x', { node_type: 'restroom' });
    node('ent', { node_type: 'entrance', name: '공업센터 정문' });
    node('ent_unnamed', { node_type: 'entrance' });
    const places = routePlaces(h.current());
    expect(places.map((p) => p.label)).toEqual(['공업센터 정문 (공업센터 1층)', '남자 화장실 (공업센터 1층)', '화장실 (공업센터 1층)']);
    expect(places.find((p) => p.id === 'wc_m')).toMatchObject({ kind: 'other', nodeType: 'restroom', gender: 'male' });
    expect(places.find((p) => p.id === 'wc_x')).not.toHaveProperty('gender');
  });

  it('leaves out points that are not departure / arrival candidates', () => {
    const h = createHistory(emptyState());
    h.perform(addBuilding({ code: 'ENGCTR', name: '공업센터', levels: [1], polygon: square(127.0, 37.5) }));
    h.perform(
      addNode({
        id: 'd_back',
        coord: [127.0002, 37.5002],
        props: { kind: 'node', node_type: 'door', building_id: 'bldg_ENGCTR', level: 1, door_role: 'back', source: 'test' },
      }),
    );
    expect(routePlaces(h.current())).toEqual([]);
  });
});
