// 경로 테스트 → 가장 가까운 남자 / 여자 화장실 (model/nearestRestroom.ts): 'male' leaves only the women's list, 'female'
// only the men's list, and every other gender value (no limit) is in both.
import { describe, expect, it } from 'vitest';
import { addEdge, addNode, buildGraph, findNearestRestroomFrom, type NodeFeature } from '@campo/core';
import {
  NO_MATCH_MESSAGE, findNearestRestroomFor, genderAllows, isRestroomMatch, nearestLabel, nearestTitle,
} from '../src/model/nearestRestroom.ts';
import { createSession, stateToCampus } from '../src/model/session.ts';
import { fixtureSession } from './fixture.ts';

/** campus-basic: from A동 4층 복도 the men's room (n_A_4_wc_m, wheelchair no) is nearer than the women's (n_A_4_wc_f, wheelchair yes). */
function graph() {
  const s = fixtureSession();
  return buildGraph(stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras), { overrides: [], calibration: {} });
}
const HALL = { nodeId: 'n_A_4_hall' };
const setGender = (g: ReturnType<typeof graph>, id: string, gender: unknown) => {
  const n = g.nodes.get(id)!;
  (n.properties as unknown as Record<string, unknown>).restroom_gender = gender;
  if (gender === undefined) delete (n.properties as unknown as Record<string, unknown>).restroom_gender;
};
const target = (r: ReturnType<typeof findNearestRestroomFor>) => (r.found ? r.targetId : null);

const restroom = (props: Record<string, unknown>): NodeFeature =>
  ({ type: 'Feature', id: 'x', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'node', node_type: 'restroom', building_id: 'b', level: 1, ...props } }) as NodeFeature;

describe('genderAllows', () => {
  const NO_LIMIT = ['unisex', 'family', 'all', 'unknown', '', null, undefined, '정체불명', 42];
  it('men: everything but female', () => {
    expect(genderAllows('male', 'male')).toBe(true);
    expect(genderAllows('female', 'male')).toBe(false);
    for (const g of NO_LIMIT) expect(genderAllows(g, 'male')).toBe(true);
  });
  it('women: everything but male', () => {
    expect(genderAllows('female', 'female')).toBe(true);
    expect(genderAllows('male', 'female')).toBe(false);
    for (const g of NO_LIMIT) expect(genderAllows(g, 'female')).toBe(true);
  });
  it('전체: every value', () => {
    for (const g of ['male', 'female', ...NO_LIMIT]) expect(genderAllows(g, 'any')).toBe(true);
  });
});

describe('isRestroomMatch', () => {
  it('takes only node_type restroom', () => {
    const door = { ...restroom({}), properties: { ...restroom({}).properties, node_type: 'door' } } as NodeFeature;
    expect(isRestroomMatch(door, { gender: 'any', wheelchair: false })).toBe(false);
    expect(isRestroomMatch(door, { gender: 'male', wheelchair: false })).toBe(false);
  });
  it('combines the gender with wheelchair: yes', () => {
    expect(isRestroomMatch(restroom({ restroom_gender: 'female', wheelchair: 'yes' }), { gender: 'female', wheelchair: true })).toBe(true);
    expect(isRestroomMatch(restroom({ restroom_gender: 'family', wheelchair: 'yes' }), { gender: 'female', wheelchair: true })).toBe(true);
    expect(isRestroomMatch(restroom({ restroom_gender: 'male', wheelchair: 'yes' }), { gender: 'female', wheelchair: true })).toBe(false);
    expect(isRestroomMatch(restroom({ restroom_gender: 'female', wheelchair: 'limited' }), { gender: 'female', wheelchair: true })).toBe(false);
  });
});

describe('findNearestRestroomFor', () => {
  it('전체 is core findNearestRestroomFrom as before', () => {
    const g = graph();
    expect(findNearestRestroomFor(g, HALL, { gender: 'any', wheelchair: false })).toEqual(findNearestRestroomFrom(g, HALL, 'any'));
    expect(findNearestRestroomFor(g, HALL, { gender: 'any', wheelchair: true })).toEqual(findNearestRestroomFrom(g, HALL, 'wheelchair'));
  });

  it('a man never gets the women’s room and a woman never the men’s', () => {
    const g = graph();
    const m = findNearestRestroomFor(g, HALL, { gender: 'male', wheelchair: false });
    const f = findNearestRestroomFor(g, HALL, { gender: 'female', wheelchair: false });
    expect(target(m)).toBe('n_A_4_wc_m');
    expect(target(f)).toBe('n_A_4_wc_f');
    expect(f.found && f.profile).toBe('shortest');
    expect(f.found && f.nodes.at(-1)).toBe('n_A_4_wc_f');
  });

  it('a restroom with no gender limit is a candidate for both', () => {
    for (const gender of ['unisex', 'family', 'all', 'unknown', '', null, undefined, '정체불명']) {
      const g = graph();
      setGender(g, 'n_A_4_wc_m', gender); // the nearer one, now without a limit
      expect(target(findNearestRestroomFor(g, HALL, { gender: 'female', wheelchair: false }))).toBe('n_A_4_wc_m');
      expect(target(findNearestRestroomFor(g, HALL, { gender: 'male', wheelchair: false }))).toBe('n_A_4_wc_m');
    }
  });

  it('여자 + 휠체어 is the wheelchair women’s room by the wheelchair route; 남자 + 휠체어 has none here', () => {
    const g = graph();
    const f = findNearestRestroomFor(g, HALL, { gender: 'female', wheelchair: true });
    expect(target(f)).toBe('n_A_4_wc_f');
    expect(f.profile).toBe('wheelchair');
    const m = findNearestRestroomFor(g, HALL, { gender: 'male', wheelchair: true });
    expect(m).toEqual({ found: false, profile: 'wheelchair', reason: 'no-route', message: NO_MATCH_MESSAGE });
  });

  it('breaks a tie by the smaller node id, whatever order the nodes were added in', () => {
    // Outdoor start in the middle, two family restrooms exactly as far east and west.
    const s = createSession('tie', [], 1);
    const node = (id: string, x: number, props: Record<string, unknown>) => s.history.perform(addNode({
      id, coord: [127 + x, 37], props: { kind: 'node', building_id: null, level: null, source: 'test', ...props } as never,
    }));
    const edge = (id: string, from: string, to: string) => s.history.perform(addEdge({
      id, props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: true, source: 'test' },
    }));
    node('wc_z', 0.0001, { node_type: 'restroom', restroom_gender: 'family' });
    node('mid', 0, { node_type: 'outdoor' });
    node('wc_a', -0.0001, { node_type: 'restroom', restroom_gender: 'family' });
    edge('e1', 'mid', 'wc_z');
    edge('e2', 'mid', 'wc_a');
    const g = buildGraph(stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras), { overrides: [], calibration: {} });
    for (const gender of ['male', 'female'] as const) {
      const r = findNearestRestroomFor(g, { nodeId: 'mid' }, { gender, wheelchair: false });
      expect(target(r)).toBe('wc_a');
    }
  });
});

describe('labels', () => {
  it('names the buttons and the card by gender', () => {
    expect(nearestLabel('any', false)).toBe('가장 가까운 화장실');
    expect(nearestLabel('any', true)).toBe('휠체어로 갈 수 있는 가장 가까운 화장실');
    expect(nearestLabel('male', false)).toBe('가장 가까운 남자 화장실');
    expect(nearestLabel('female', true)).toBe('휠체어로 갈 수 있는 가장 가까운 여자 화장실');
    expect(nearestTitle('any', false)).toBe('가장 가까운 화장실');
    expect(nearestTitle('any', true)).toBe('가장 가까운 휠체어 화장실 (휠체어 경로)');
    expect(nearestTitle('female', false)).toBe('가장 가까운 여자 화장실');
  });
});
