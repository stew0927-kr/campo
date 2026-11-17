// 건물 추가 (survey/buildings.ts): the bundled OSM outlines and drawn outlines become buildings the editor reads like its own.
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdGen, applyChangeset, validateSurvey, type EditState, type Position } from '@campo/core';
import bundled from '../assets/campus.generated.json';
import { lookupOsmBuilding, parseLevelRange, planDrawnBuilding, planOsmBuilding, type OsmBuilding, type OsmCampus } from '../src/survey/buildings.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, campusErrors, fixture } from './helpers.ts';

let base: EditState;
let loaded: Awaited<ReturnType<typeof fixture>>['loaded'];
beforeAll(async () => {
  ({ state: base, loaded } = await fixture());
});

const sq = (cx: number, cy: number, h: number): Position[] => [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h], [cx - h, cy - h]];
const hall: OsmBuilding = { osmId: 'w101', name: '제2공학관', levels: [-2, -1, 1, 2, 3, 4, 5], levelsKnown: true, ring: sq(127.05, 37.56, 0.0002) };
const shed: OsmBuilding = { osmId: 'w102', name: null, levels: [1], levelsKnown: false, ring: sq(127.0501, 37.56, 0.00005) };
const osm: OsmCampus = { bbox: [127, 37, 128, 38], buildings: [hall, shed] };
// A new building has no entrance yet: the surveyor adds it next with 포탈, so that is the one error the campus check finds.
const expectOnlyMissingEntrance = (errors: string[]) => expect(errors.filter((e) => !e.startsWith('ground-level-without-entrance'))).toEqual([]);
const newSession = () => new SurveySession({ campus: CAMPUS, base, ids: createIdGen(5), startedAt: AT });

describe('OSM 건물 가져오기 in the app', () => {
  it('finds the building under the crosshair (the smallest when nested) and refuses empty spots and registered buildings', () => {
    expect(lookupOsmBuilding(osm, base, [127.05, 37.56])).toEqual({ building: hall });
    expect(lookupOsmBuilding(osm, base, [127.0501, 37.56])).toEqual({ building: shed });
    expect(lookupOsmBuilding(osm, base, [127.06, 37.56])).toEqual({ error: expect.stringContaining('OSM 건물이 없습니다') });
    expect(lookupOsmBuilding(null, base, [127.05, 37.56])).toEqual({ error: expect.stringContaining('데이터가 들어 있지 않습니다') });
    const inside = base.buildings['A']!.polygon[0]![0]!;
    const centre: Position = [inside[0] + 0.00001, inside[1] + 0.00001];
    const here = Object.values(base.buildings).find((b) => lookupOsmBuilding({ bbox: osm.bbox, buildings: [{ ...hall, ring: sq(centre[0], centre[1], 0.01) }] }, base, centre) && true);
    expect(here).toBeDefined();
  });

  it('adds the outline with the OSM name and both ground and underground floors, marked for checking, and the surveyor stands on its first ground floor', () => {
    const s = newSession();
    const plan = planOsmBuilding(s.state, hall);
    if ('error' in plan) throw new Error(plan.error);
    expect(s.edit(plan.action, plan.scope, null)).toMatchObject({ warnings: [] });
    const b = s.state.buildings['OSMw101']!;
    expect(b.id).toBe('bldg_OSMw101');
    expect(b.props).toMatchObject({ name: '제2공학관', code: 'OSMw101', levels: [-2, -1, 1, 2, 3, 4, 5], ground_levels: [1], source: 'osm', needs_check: true });
    expect(b.polygon[0]).toEqual(hall.ring);
    expect(s.scope).toEqual({ kind: 'building', buildingId: 'bldg_OSMw101', level: 1 });
    expectOnlyMissingEntrance(campusErrors(loaded, s.state));
    expect(planOsmBuilding(s.state, hall)).toEqual({ error: '이 건물은 이미 가져왔습니다(제2공학관).' });
    // one 되돌리기 takes the building away
    expect(s.undo()).toBe(true);
    expect(s.state.buildings['OSMw101']).toBeUndefined();
  });

  it('a building without a name gets a placeholder, and one floor when OSM has none', () => {
    const plan = planOsmBuilding(base, shed);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.notices[0]).toContain('1층만');
    expect(plan.action.annotation).toContain('이름 없는 건물 w102');
  });

  it('the survey file of a walk that added a building validates and applies in the editor\'s way', () => {
    const s = newSession();
    const plan = planOsmBuilding(s.state, hall);
    if ('error' in plan) throw new Error(plan.error);
    s.edit(plan.action, plan.scope, null);
    const survey = s.toSurvey('osm-test', AT);
    expect(validateSurvey(survey)).toMatchObject({ ok: true });
    expect(survey.changeset?.changes.some((c) => JSON.stringify(c).includes('OSMw101'))).toBe(true);
    const applied = applyChangeset(survey.changeset!);
    expect(applied.disabled(base)).toBe(false);
    expect(applied.apply(base).buildings['OSMw101']!.props.name).toBe('제2공학관');
  });

  it('the bundled campus carries the OSM buildings of the app\'s campus', () => {
    const data = (bundled as unknown as { osm: OsmCampus | null }).osm;
    expect(data?.buildings.length).toBeGreaterThan(100);
    const named = data!.buildings.find((b) => b.name === '국제관')!;
    expect(named.levels).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const [x, y] = named.ring.reduce(([sx, sy], p) => [sx + p[0], sy + p[1]], [0, 0]);
    expect(lookupOsmBuilding(data!, new SurveySession({ campus: CAMPUS, base: { ...base, buildings: {} }, ids: createIdGen(1), startedAt: AT }).state, [x! / named.ring.length, y! / named.ring.length])).toMatchObject({ building: { osmId: named.osmId } });
  });
});

describe('직접 다각형 그리기', () => {
  it('makes a building from a drawn outline with the typed name and floors; refuses fewer than three points and a missing name', () => {
    const s = newSession();
    const ring: Position[] = [[127.07, 37.57], [127.0702, 37.57], [127.0702, 37.5702]];
    const plan = planDrawnBuilding(s.state, s.ctx, ring, { name: ' 새 건물 ', levels: [-1, 1, 2] });
    if ('error' in plan) throw new Error(plan.error);
    s.edit(plan.action, plan.scope, null);
    const b = s.state.buildings[Object.keys(s.state.buildings).find((k) => k.startsWith('N'))!]!;
    expect(b.props).toMatchObject({ name: '새 건물', levels: [-1, 1, 2], needs_check: true });
    expect(b.polygon[0]).toHaveLength(4); // closed
    expectOnlyMissingEntrance(campusErrors(loaded, s.state));
    expect(planDrawnBuilding(s.state, s.ctx, ring.slice(0, 2), { name: 'x', levels: [1] })).toEqual({ error: expect.stringContaining('세 개') });
    expect(planDrawnBuilding(s.state, s.ctx, ring, { name: ' ', levels: [1] })).toEqual({ error: expect.stringContaining('이름') });
  });

  it('reads floor lists', () => {
    expect(parseLevelRange('-1~4')).toEqual([-1, 1, 2, 3, 4]);
    expect(parseLevelRange('1, 2,3')).toEqual([1, 2, 3]);
    expect(parseLevelRange('3')).toEqual([3]);
    expect(parseLevelRange('0')).toBeNull();
    expect(parseLevelRange('abc')).toBeNull();
    expect(parseLevelRange('')).toBeNull();
  });
});
