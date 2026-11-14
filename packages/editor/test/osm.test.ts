// OSM 건물 가져오기 (osm.ts): the Overpass query, reading its answer, and the building it becomes.
import { describe, expect, it } from 'vitest';
import type { Position } from '@campo/core';
import { OSM_SOURCE, OVERPASS_URL, fetchOsmBuilding, osmLevels, overpassQuery, parseOverpass, pickBuilding, planOsmBuilding } from '../src/model/osm.ts';
import { isError, runPlan } from '../src/model/plan.ts';
import { fixtureSession } from './fixture.ts';

/** A spot of the fixture campus with no building: 200m south-west of everything. */
const HERE: Position = [126.998, 36.998];
const square = (cx: number, cy: number, half: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => ({ lon: cx + x! * half, lat: cy + y! * half }));
const hall = { type: 'way', id: 101, tags: { building: 'university', name: '제2공학관', 'building:levels': '5', 'building:levels:underground': '2' }, geometry: square(HERE[0], HERE[1], 0.0002) };
const shed = { type: 'way', id: 102, tags: { building: 'yes' }, geometry: square(HERE[0] + 0.001, HERE[1], 0.0001) };
const block = {
  type: 'relation', id: 7, tags: { building: 'yes', 'name:ko': '본관' },
  members: [
    { type: 'way', role: 'outer', geometry: square(HERE[0], HERE[1], 0.0005) },
    { type: 'way', role: 'inner', geometry: square(HERE[0], HERE[1], 0.0004) },
    { type: 'node', role: 'entrance' },
  ],
};
const answer = (elements: unknown[], status = 200) => (async () => new Response(JSON.stringify({ elements }), { status })) as unknown as typeof fetch;

describe('Overpass', () => {
  it('asks for building ways and relations around the click, with geometry', () => {
    const q = overpassQuery([127.0451, 37.5559], 120);
    expect(q).toBe('[out:json][timeout:15];(way["building"](around:120,37.5559,127.0451);relation["building"](around:120,37.5559,127.0451););out tags geom;');
    expect(OVERPASS_URL).toBe('https://overpass-api.de/api/interpreter');
    expect(OVERPASS_URL).not.toMatch(/google|naver|kakao|daum/);
  });

  it('reads floors: above ground from 1, underground as negative levels, never 0', () => {
    expect(osmLevels({ 'building:levels': '3' })).toEqual({ levels: [1, 2, 3], known: true });
    expect(osmLevels({ 'building:levels': '2', 'building:levels:underground': '2' })).toEqual({ levels: [-2, -1, 1, 2], known: true });
    for (const bad of [{}, { 'building:levels': '2.5' }, { 'building:levels': '0' }, { 'building:levels': 'many' }]) expect(osmLevels(bad)).toEqual({ levels: [1], known: false });
  });

  it('reads ways and relations (largest outer ring), closes open rings, and skips what is not an outline', () => {
    const open = { type: 'way', id: 5, tags: { building: 'yes' }, geometry: square(0, 0, 1).slice(0, 4) };
    const list = parseOverpass({ elements: [hall, block, open, { type: 'way', id: 6, geometry: square(0, 0, 1).slice(0, 2) }, { type: 'node', id: 9 }, null] });
    expect(list.map((b) => b.osmId)).toEqual(['w101', 'r7', 'w5']);
    expect(list[0]).toMatchObject({ name: '제2공학관', levels: [-2, -1, 1, 2, 3, 4, 5], levelsKnown: true });
    expect(list[1]).toMatchObject({ name: '본관', levels: [1], levelsKnown: false });
    expect(list[1]!.ring).toHaveLength(5);
    expect(list[1]!.ring[0]![0]).toBeCloseTo(HERE[0] - 0.0005, 9); // the outer ring, not the courtyard
    expect(list[2]!.ring).toHaveLength(5);
    expect(list[2]!.ring[4]).toEqual(list[2]!.ring[0]);
    expect(parseOverpass('nope')).toEqual([]);
    expect(parseOverpass({ remark: 'runtime error' })).toEqual([]);
  });

  it('takes the building that holds the click, the smallest when outlines are nested', () => {
    const list = parseOverpass({ elements: [block, hall, shed] });
    expect(pickBuilding(list, HERE)!.osmId).toBe('w101');
    expect(pickBuilding(list, [HERE[0] + 0.00045, HERE[1]])!.osmId).toBe('r7');
    expect(pickBuilding(list, [HERE[0] + 0.002, HERE[1]])).toBeUndefined();
  });
});

describe('planOsmBuilding', () => {
  it('makes a campo building with the name and floors, marked for checking; one undo; refuses the same building twice', () => {
    const s = fixtureSession(41);
    const before = s.history.current();
    const [b] = parseOverpass({ elements: [hall] });
    const plan = planOsmBuilding(before, b!);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.annotation).toBe('OSM 건물 "제2공학관" 가져오기');
    expect(runPlan(s.history, plan)).toMatchObject({ ok: true });
    const after = s.history.current();
    const made = after.buildings['OSMw101']!;
    expect(made.id).toBe('bldg_OSMw101');
    expect(made.props).toMatchObject({ kind: 'building', name: '제2공학관', code: 'OSMw101', levels: [-2, -1, 1, 2, 3, 4, 5], ground_levels: [1], source: OSM_SOURCE, needs_check: true });
    expect(made.polygon[0]).toEqual(b!.ring);
    expect(s.history.size()).toBe(1);
    expect(planOsmBuilding(after, b!)).toEqual({ error: '이 건물은 이미 가져왔습니다(제2공학관).' });
    expect(s.history.undo()).toEqual(before);
  });

  it('names a building OpenStreetMap has no name for', () => {
    const plan = planOsmBuilding(fixtureSession().history.current(), parseOverpass({ elements: [shed] })[0]!);
    if (isError(plan)) throw new Error(plan.error);
    expect(plan.annotation).toBe('OSM 건물 "이름 없는 건물 w102" 가져오기');
    expect(plan.notices![0]).toBe('OSM에 층수가 없어 1층만 넣었습니다.');
  });
});

describe('fetchOsmBuilding', () => {
  const state = fixtureSession().history.current();

  it('posts the query to Overpass and returns the building under the click', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ elements: [hall, shed] }), { status: 200 });
    }) as unknown as typeof fetch;
    const found = await fetchOsmBuilding(state, HERE, fetchFn);
    expect(found).toMatchObject({ building: { osmId: 'w101' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(OVERPASS_URL);
    expect(decodeURIComponent(calls[0]!.body)).toBe(`data=${overpassQuery(HERE)}`);
  });

  it('explains every failure in Korean and never throws', async () => {
    const down = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const notJson = (async () => new Response('<html>busy</html>', { status: 200 })) as unknown as typeof fetch;
    expect(await fetchOsmBuilding(state, HERE, down)).toEqual({ error: expect.stringContaining('닿지 못했습니다') });
    expect(await fetchOsmBuilding(state, HERE, notJson)).toEqual({ error: expect.stringContaining('닿지 못했습니다') });
    expect(await fetchOsmBuilding(state, HERE, answer([], 429))).toEqual({ error: expect.stringContaining('바쁩니다') });
    expect(await fetchOsmBuilding(state, HERE, answer([], 500))).toEqual({ error: expect.stringContaining('HTTP 500') });
    expect(await fetchOsmBuilding(state, HERE, answer([shed]))).toEqual({ error: expect.stringContaining('누른 자리에 OSM 건물이 없습니다') });
  });

  it('does not ask at all where a campo building already stands', async () => {
    let asked = false;
    const fetchFn = (async () => { asked = true; return new Response('{}'); }) as unknown as typeof fetch;
    const inside = state.nodes['n_A_3_hall']!.coord;
    expect(await fetchOsmBuilding(state, inside, fetchFn)).toEqual({ error: expect.stringContaining('이미 건물(') });
    expect(asked).toBe(false);
  });
});
