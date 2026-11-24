// 위치 안내(단계 카드)·지도 가운데 핀 고르기·검색 시트 높이·센서 시작 규칙. 순수 모듈과 소스만 본다(기기 GPS·지도는 미검증).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CampusRouteView } from '../src/contracts.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { navCards, stepPhotoEntry, stepSegments } from '../src/features/map/navModel.ts';
import { centerPickInfo, PICK_SNAP_PLACE_M } from '../src/features/map/centerPick.ts';
import { SEARCH_SHEET_COMPACT_BASE, searchSheetHeights } from '../src/features/map/sheetModel.ts';
import { fixtureRuntime } from './helpers.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('step cards (navModel)', () => {
  it('cuts the route line into one stretch per step, in order, covering the whole line', async () => {
    const runtime = await fixtureRuntime();
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: 'n_out_0001' }, to: { kind: 'node', nodeId: 'n_A_4_408door' } });
    const route = state.route!;
    const parts = stepSegments(route);
    expect(parts).toHaveLength(route.steps.length);
    const line = route.polyline.map((p) => [p.lng, p.lat]);
    expect(parts[0]![0]).toEqual(line[0]);
    expect(parts[parts.length - 1]!.at(-1)).toEqual(line.at(-1));
    // Each stretch starts where the one before it ended.
    for (let i = 1; i < parts.length; i++) expect(parts[i]![0]).toEqual(parts[i - 1]!.at(-1));
    for (const part of parts) expect(part.length).toBeGreaterThanOrEqual(2);
    const cards = navCards(route, runtime.graph);
    expect(cards.map((c) => c.text)).toEqual(route.steps.map((s) => s.text));
    // The last steps are inside building A (shown on its floor); the first is outdoors.
    expect(cards[0]!.buildingId).toBeNull();
    expect(cards.at(-1)!.buildingId).toBe('bldg_A');
  });

  it('a route with no steps (straight across one plaza) is one card over the whole line', () => {
    const route = { steps: [], nodeIds: [], nodeIndex: [], distanceM: 31.4, polyline: [{ lng: 127, lat: 37 }, { lng: 127.0003, lat: 37.0002 }] } as unknown as CampusRouteView;
    const cards = navCards(route, null);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.text).toBe('도착지까지 약 31m 걸어가세요.');
    expect(cards[0]!.coordinates).toHaveLength(2);
  });

  it('falls back to the whole line when node positions are unknown (old route views)', () => {
    const route = {
      steps: [{ fromNodeId: 'a', toNodeId: 'b' }], nodeIds: ['a', 'b'],
      polyline: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }, { lng: 3, lat: 3 }],
    } as unknown as CampusRouteView;
    expect(stepSegments(route)[0]).toHaveLength(3);
  });

  it('a step photo is the one at the step start; the last step may use the arrival photo', () => {
    const photo = { photoId: 'p' } as never;
    const photos = [
      { stepIndex: 0, photo: null, lngLat: [1, 1] },
      { stepIndex: 1, photo, lngLat: [2, 2] },
      { stepIndex: 3, photo, lngLat: [3, 3] },
    ] as never;
    expect(stepPhotoEntry(photos, 0, false)).toBeNull();
    expect(stepPhotoEntry(photos, 1, false)).toBe(1);
    expect(stepPhotoEntry(photos, 2, false)).toBeNull();
    expect(stepPhotoEntry(photos, 2, true)).toBe(2);
  });
});

describe('centre-pin picking (centerPick)', () => {
  it('snaps to a registered outdoor place right under the pin, otherwise describes the point', async () => {
    const runtime = await fixtureRuntime();
    const gate = runtime.places.find((p) => p.id === 'n_out_0001')!;
    const on = centerPickInfo(runtime.graph, runtime.places, { lng: gate.lng, lat: gate.lat });
    expect(on.place?.id).toBe(gate.id);
    expect(on.title).toBe(gate.name);
    const off = centerPickInfo(runtime.graph, runtime.places, { lng: gate.lng + 0.0002, lat: gate.lat + 0.0002 });
    expect(off.place).toBeNull();
    expect(off.title.length).toBeGreaterThan(0);
    const far = centerPickInfo(runtime.graph, runtime.places, { lng: 0, lat: 0 });
    expect(far).toEqual({ title: '지도에서 선택한 위치', detail: '가장 가까운 걷는 길에 이어 안내합니다.', place: null });
    expect(PICK_SNAP_PLACE_M).toBeLessThan(10);
  });

  it('the map screen picks with the centre pin and a confirm button, not with a map tap', () => {
    const screen = source('../src/features/map/MapScreen.tsx');
    expect(screen).toContain('title="이 위치로 설정"');
    expect(screen).toContain('지도를 움직여 위치를 지정하세요.');
    expect(screen).not.toContain("pickFor(mapPick, pointPlace(point, '지도에서 선택한 위치'))");
  });
});

describe('search sheet and floors', () => {
  it('no search field opens the keyboard by itself', () => {
    expect(source('../src/features/map/MapChrome.tsx')).not.toMatch(/autoFocus/);
  });

  it('a building without a chosen floor uses a short sheet; with a floor the normal half sheet', () => {
    const normal = searchSheetHeights(800);
    const compact = searchSheetHeights(800, 44);
    expect(compact.default).toBe(SEARCH_SHEET_COMPACT_BASE + 44);
    expect(compact.default).toBeLessThan(normal.default);
    expect(compact.expanded).toBe(normal.expanded);
    // Never taller than the normal default on a small screen.
    expect(searchSheetHeights(320, 400).default).toBe(searchSheetHeights(320).default);
  });

  it('floors are one sideways-scrolling line of chips', () => {
    const chrome = source('../src/features/map/MapChrome.tsx');
    expect(chrome).toMatch(/export function FloorChips[\s\S]*?<ScrollView horizontal/);
    expect(chrome).toMatch(/floorChips: \{ flexDirection: 'row', gap/);
    expect(chrome).not.toMatch(/floorChips: \{[^}]*flexWrap/);
  });
});

describe('location only while guiding', () => {
  it('the sensors never stop the guidance on their own and ignore the brief background of a system dialog', () => {
    const hook = source('../src/features/map/useSensorFixes.ts');
    expect(hook).not.toMatch(/onStop/);
    expect(hook).toMatch(/state === 'background' && !starting/);
  });

  it('GPS matching and sensors run only while guidance is on', () => {
    const screen = source('../src/features/map/MapScreen.tsx');
    expect(screen).toContain('useGpsMatcher(navOn ? data.network : null');
    expect(screen).toContain("useSensorFixes(navOn && active && demo === 'none'");
  });
});
