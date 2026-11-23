// 화장실 성별(남자/여자) 필터: 'male'은 여자 목록에서만, 'female'은 남자 목록에서만 빠지고, 성별 제한이 없는 값은 양쪽에 든다.
// 가장 가까운 화장실 찾기와 계층 목록(건물 → 층 → 시설)이 그 판정을 그대로 따르는지 본다.
import { describe, expect, it } from 'vitest';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import type { CampusPlace } from '../src/contracts.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { RESTROOM_NONE_GENDER, RESTROOM_NONE_WHEELCHAIR, nearestRestroom } from '../src/features/map/restroom.ts';
import {
  filterRestrooms, genderAllows, genderLabel, nearestRestroomTitle, restroomCandidates, restroomMatchesGender,
} from '../src/features/map/restroomGender.ts';
import { UNKNOWN_LEVEL, buildingGroups, facilityGroups, levelGroups } from '../src/features/map/placeTree.ts';
import indoorFixture from '../src/features/map/indoorFixture.json';
import type { BundledCampus, CampusRuntime } from '../src/campus/types.ts';
import { fixtureRuntime } from './helpers.ts';

const NO_LIMIT: unknown[] = ['unisex', 'family', 'all', 'unknown', '', null, undefined, '정체불명', 7];
const place = (restroomGender: unknown, nodeType = 'restroom'): CampusPlace =>
  ({ id: 'x', name: '화장실', nodeType, buildingId: 'b', level: 1, lat: 0, lng: 0, ...(restroomGender === undefined ? {} : { restroomGender }) }) as CampusPlace;

/** campus-basic: A동 4층 복도(n_A_4_hall)에서 남자 화장실(n_A_4_wc_m, 휠체어 no)이 여자 화장실(n_A_4_wc_f, 휠체어 yes)보다 가깝다. */
const HALL = { kind: 'node', nodeId: 'n_A_4_hall' } as const;
const WC_M = 'n_A_4_wc_m';
const WC_F = 'n_A_4_wc_f';

/** 그래프 지점의 성별만 바꾼 런타임(같은 캠퍼스, 다른 데이터를 흉내 낸다). */
async function withGender(id: string, gender: unknown): Promise<CampusRuntime> {
  const runtime = await fixtureRuntime();
  const props = runtime.graph.nodes.get(id)!.properties as unknown as Record<string, unknown>;
  if (gender === undefined) delete props.restroom_gender;
  else props.restroom_gender = gender;
  return runtime;
}
const targetOf = (r: ReturnType<typeof nearestRestroom>) => (r.found ? r.nodeId : null);

describe('restroomMatchesGender', () => {
  it('남자: female만 빠지고 male과 제한 없는 값은 모두 든다', () => {
    expect(restroomMatchesGender(place('male'), 'male')).toBe(true);
    expect(restroomMatchesGender(place('female'), 'male')).toBe(false);
    for (const g of NO_LIMIT) expect(restroomMatchesGender(place(g), 'male')).toBe(true);
  });
  it('여자: male만 빠지고 female과 제한 없는 값은 모두 든다', () => {
    expect(restroomMatchesGender(place('female'), 'female')).toBe(true);
    expect(restroomMatchesGender(place('male'), 'female')).toBe(false);
    for (const g of NO_LIMIT) expect(restroomMatchesGender(place(g), 'female')).toBe(true);
  });
  it('전체는 모든 화장실', () => {
    for (const g of ['male', 'female', ...NO_LIMIT]) expect(restroomMatchesGender(place(g), 'any')).toBe(true);
  });
  it('화장실이 아니면 어떤 성별 값이든 false', () => {
    for (const nodeType of ['door', 'poi', 'entrance', 'corridor']) {
      for (const wanted of ['any', 'male', 'female'] as const) expect(restroomMatchesGender(place('unisex', nodeType), wanted)).toBe(false);
    }
  });
  it('genderAllows가 같은 규칙이다', () => {
    expect(genderAllows('female', 'male')).toBe(false);
    expect(genderAllows('male', 'female')).toBe(false);
    expect(genderAllows('family', 'male') && genderAllows('family', 'female')).toBe(true);
  });
});

describe('filterRestrooms / 계약', () => {
  it('loadBundledCampus가 restroom_gender를 restroomGender로 넘긴다(화장실만)', async () => {
    const runtime = await fixtureRuntime();
    expect(runtime.places.find((p) => p.id === WC_M)?.restroomGender).toBe('male');
    expect(runtime.places.find((p) => p.id === WC_F)?.restroomGender).toBe('female');
    for (const p of runtime.places) if (p.nodeType !== 'restroom') expect(p).not.toHaveProperty('restroomGender');
  });

  it('fixture에서 남자 목록은 남자 화장실만, 여자 목록은 여자 화장실만, 전체는 둘 다', async () => {
    const { places } = await fixtureRuntime();
    expect(filterRestrooms(places, 'male').map((p) => p.id)).toEqual([WC_M]);
    expect(filterRestrooms(places, 'female').map((p) => p.id)).toEqual([WC_F]);
    expect(filterRestrooms(places, 'any').map((p) => p.id).sort()).toEqual([WC_F, WC_M]);
  });

  it('데모 데이터(indoorFixture)에서도 남/여가 각각 하나씩', () => {
    const { places } = loadBundledCampus(indoorFixture as BundledCampus);
    const male = filterRestrooms(places, 'male');
    const female = filterRestrooms(places, 'female');
    expect(male).toHaveLength(1);
    expect(female).toHaveLength(1);
    expect(male[0]!.restroomGender).toBe('male');
    expect(female[0]!.restroomGender).toBe('female');
  });

  it('restroomCandidates는 화장실만 거르고 다른 장소(출발 후보)는 그대로 둔다', async () => {
    const { places } = await fixtureRuntime();
    const male = restroomCandidates(places, 'male');
    expect(male).toHaveLength(places.length - 1);
    expect(male.some((p) => p.id === WC_F)).toBe(false);
    expect(restroomCandidates(places, 'any')).toEqual(places);
  });

  it('성별 라벨과 제목', () => {
    expect(genderLabel(place('male'))).toBe('남자 화장실');
    expect(genderLabel(place('female'))).toBe('여자 화장실');
    expect(genderLabel(place('unisex'))).toBe('남녀공용 화장실');
    expect(genderLabel(place('family'))).toBe('가족 화장실');
    expect(genderLabel(place(undefined))).toBe('화장실');
    expect(genderLabel(place('unknown'))).toBe('화장실');
    expect(nearestRestroomTitle('female')).toBe('가장 가까운 여자 화장실');
    expect(nearestRestroomTitle('male')).toBe('가장 가까운 남자 화장실');
    expect(nearestRestroomTitle('any')).toBe('가장 가까운 화장실');
  });
});

describe('nearestRestroom + 성별', () => {
  it('전체는 지금까지처럼 가장 가까운 화장실(남자 화장실)', async () => {
    const runtime = await fixtureRuntime();
    expect(targetOf(nearestRestroom(runtime, HALL, false))).toBe(WC_M);
    expect(nearestRestroom(runtime, HALL, false, 'shortest', 'any')).toEqual(nearestRestroom(runtime, HALL, false));
  });

  it('여자 검색은 더 가까운 남자 화장실을 고르지 않고, 남자 검색은 여자 화장실을 고르지 않는다 (경로까지)', async () => {
    const runtime = await fixtureRuntime();
    const female = nearestRestroom(runtime, HALL, false, 'shortest', 'female');
    expect(female).toMatchObject({ found: true, nodeId: WC_F, request: { to: { kind: 'node', nodeId: WC_F }, mode: 'shortest' } });
    const route = computeRoute(runtime, (female as { request: Parameters<typeof computeRoute>[1] }).request);
    expect(route.status).toBe('ok');
    expect(targetOf(nearestRestroom(runtime, HALL, false, 'shortest', 'male'))).toBe(WC_M);
  });

  it('성별 제한이 없는 화장실은 남자·여자 양쪽의 후보다', async () => {
    for (const gender of ['unisex', 'family', 'all', 'unknown', '', null, undefined]) {
      const runtime = await withGender(WC_M, gender);
      const female = nearestRestroom(runtime, HALL, false, 'shortest', 'female');
      const male = nearestRestroom(runtime, HALL, false, 'shortest', 'male');
      expect(targetOf(female)).toBe(WC_M);
      expect(targetOf(male)).toBe(WC_M);
      expect(computeRoute(runtime, (female as { request: Parameters<typeof computeRoute>[1] }).request).status).toBe('ok');
    }
  });

  it('지도 위 점에서도 성별을 지킨다', async () => {
    const runtime = await fixtureRuntime();
    const [lng, lat] = runtime.graph.nodes.get('n_A_4_hall')!.geometry.coordinates as [number, number];
    const point = { kind: 'point', lat: lat + 0.000005, lng } as const;
    expect(targetOf(nearestRestroom(runtime, point, false, 'shortest', 'female'))).toBe(WC_F);
    expect(targetOf(nearestRestroom(runtime, point, false, 'shortest', 'male'))).toBe(WC_M);
  });

  it('휠체어와 함께: 여자 + 휠체어는 여자 화장실, 남자 + 휠체어는 맞는 곳이 없다', async () => {
    const runtime = await fixtureRuntime();
    expect(nearestRestroom(runtime, HALL, true, 'shortest', 'female')).toMatchObject({ found: true, nodeId: WC_F, request: { mode: 'wheelchair' } });
    expect(nearestRestroom(runtime, HALL, true, 'shortest', 'male')).toEqual({ found: false, message: RESTROOM_NONE_WHEELCHAIR });
  });

  it('성별에 맞는 화장실이 하나도 없으면 안내한다', async () => {
    const runtime = await withGender(WC_M, 'female');
    expect(nearestRestroom(runtime, HALL, false, 'shortest', 'male')).toEqual({ found: false, message: RESTROOM_NONE_GENDER });
  });
});

describe('계층 목록 + 성별', () => {
  it('성별로 거른 목록에서도 건물·층·시설 개수가 맞다', async () => {
    const { places, buildings } = await fixtureRuntime();
    const all = levelGroups(places, 'bldg_A').find((l) => l.level === 4)!.count;
    const male = restroomCandidates(places, 'male');
    expect(levelGroups(male, 'bldg_A').find((l) => l.level === 4)!.count).toBe(all - 1);
    const total = buildingGroups(places, buildings).find((b) => b.id === 'bldg_A')!.count;
    expect(buildingGroups(male, buildings).find((b) => b.id === 'bldg_A')!.count).toBe(total - 1);
    const wc = (list: CampusPlace[]) => facilityGroups(list, 'bldg_A', 4).find((g) => g.kind === 'restroom')!.places.map((p) => p.id);
    expect(wc(male)).toEqual([WC_M]);
    expect(wc(restroomCandidates(places, 'female'))).toEqual([WC_F]);
    expect(wc(places).sort()).toEqual([WC_F, WC_M]);
  });

  it('층 기록이 없는 건물 안 장소는 맨 뒤 "층 미확인"으로 묶여 내려갈 수 있다', () => {
    const base = { nodeType: 'restroom', buildingId: 'b1', lat: 0, lng: 0 };
    const list: CampusPlace[] = [
      { ...base, id: 'a', name: '가', level: 2 },
      { ...base, id: 'b', name: '나', level: null },
      { ...base, id: 'c', name: '다', level: -1 },
    ];
    expect(levelGroups(list, 'b1')).toEqual([
      { level: -1, label: '지하 1층', count: 1 },
      { level: 2, label: '2층', count: 1 },
      { level: UNKNOWN_LEVEL, label: '층 미확인', count: 1 },
    ]);
    expect(facilityGroups(list, 'b1', UNKNOWN_LEVEL)[0]!.places.map((p) => p.id)).toEqual(['b']);
    expect(buildingGroups(list, [{ id: 'b1', name: '건물', levels: [-1, 2] }])[0]).toMatchObject({ count: 3, levelCount: 3 });
  });
});
