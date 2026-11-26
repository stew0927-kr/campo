// 실기기 피드백(PR #57 이후) 반영: 건물 이름 SymbolLayer, 선택 건물만 외곽선, 위치 안내 진행방향 회전, 3D 층 분리, 길게 눌러 핀.
// RN·MapLibre 컴포넌트는 import하지 않는다(소스 문자열과 순수 모듈로 확인, 실제 화면은 typecheck와 실기기 체크리스트).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildingStack } from '@campo/core';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { buildingLabels } from '../src/features/map/buildings.ts';
import { buildingNameFeatures, nameBuckets, nameZoomBucket, NAME_COLOR, NAME_LAYOUT, NAME_PAINT, NAME_PICKED_COLOR, spanMinZoom } from '../src/features/map/buildingNames.ts';
import { metersPerPixel } from '../src/features/map/mapLabels.ts';
import { navCamera, navCards, pointAlong, stepHeading } from '../src/features/map/navModel.ts';
import { asEditBuilding, isStackable, squareAround, stack3d, STAIR_PAIR_M } from '../src/features/map/stack3d.ts';
import { PRESS_FAR_TEXT, pressPinInfo } from '../src/features/map/centerPick.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { bundleOf, fixtureRuntime } from './helpers.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MAP = source('../src/features/map/CampusMap.tsx');
const SCREEN = source('../src/features/map/MapScreen.tsx');
const REAL_DIR = fileURLToPath(new URL('../../../data/campuses/hanyang-seoul', import.meta.url));
const real = async () => loadBundledCampus(await bundleOf(REAL_DIR, 'hanyang-seoul'));

describe('[1][3] 건물 이름: 네이티브 SymbolLayer', () => {
  it('이름은 React Marker가 아니라 GeoJSONSource + symbol 레이어로 그린다(지도와 같은 프레임)', () => {
    expect(MAP).toContain('id="app-building-names"');
    expect(MAP).toContain('type="symbol"');
    expect(MAP).not.toContain('BuildingNameMarker');
    expect(MAP).not.toMatch(/kind === 'building'/);
  });
  it('화면 기준 수평·정방향, 겹치면 숨김, 옅은 글자와 흰 halo, 선택 건물만 진하게', () => {
    expect(NAME_LAYOUT).toMatchObject({ 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-rotation-alignment': 'viewport', 'text-pitch-alignment': 'viewport', 'text-keep-upright': true, 'text-allow-overlap': false, 'text-size': 12, 'symbol-sort-key': ['get', 'sort'] });
    expect(NAME_PAINT).toMatchObject({ 'text-color': ['case', ['get', 'picked'], NAME_PICKED_COLOR, NAME_COLOR], 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.2 });
    expect(NAME_COLOR).toBe('#5C6672');
  });
  it('긴 변이 화면 48px이 되는 배율부터 보인다(15.5 이상, 0.5 단위 구간)', () => {
    const lat = 37.557;
    const z = spanMinZoom(60, lat);
    expect(60 / metersPerPixel(lat, z)).toBeCloseTo(48, 6);
    expect(nameZoomBucket(60, lat)).toBe(Math.max(15.5, Math.ceil(z * 2) / 2));
    expect(nameZoomBucket(400, lat)).toBe(15.5);
    expect(nameZoomBucket(0.5, lat)).toBeNull();
  });
  it('실제 캠퍼스: 건물마다 이름 점 하나, 큰 건물이 먼저, 선택 건물은 진하게 맨 앞', async () => {
    const rt = await real();
    const labels = buildingLabels(rt.graph);
    const data = buildingNameFeatures(labels, labels[0]!.id);
    expect(data.features.length).toBeGreaterThan(5);
    const picked = data.features.find((f) => f.properties.picked)!;
    expect(picked.properties).toMatchObject({ id: labels[0]!.id, sort: -1, bucket: 15.5 });
    const buckets = nameBuckets(data);
    expect(buckets).toEqual([...buckets].sort((a, b) => a - b));
    expect(buckets[0]).toBe(15.5);
  });
});

describe('[2] 외곽선은 층 선택이 열린 건물만', () => {
  it('기본은 그리지 않고(거의 투명한 면으로 탭만 받음) 선택 건물만 #0B3FC4 4px + 면 0.28', () => {
    expect(MAP).toContain("mappedFill: { 'fill-color': t.color.primary, 'fill-opacity': ['case', ['get', 'current'], 0, ['get', 'picked'], 0.28, 0.01] }");
    expect(MAP).toContain("mappedLine: { 'line-color': '#0B3FC4', 'line-width': 4 }");
    expect(MAP).toContain('id="app-mapped-building-line" type="line" filter={F.picked}');
    // 검색에서 고른 건물의 점선은 그대로.
    expect(MAP).toContain('id="app-marked-building-line"');
  });
});

describe('[4] 위치 안내: 진행 방향으로 화면 회전', () => {
  const E = 0.0001; // ~8.8 m east at the equator; tests use small offsets near the campus
  it('단계 앞쪽 25 m로 진입 방위를 정하고, 제자리 단계(엘리베이터·짧은 이동)는 null', () => {
    const north: [number, number][] = [[127, 37.55], [127, 37.551]];
    expect(stepHeading(north)).toBeCloseTo(0, 3);
    const east: [number, number][] = [[127, 37.55], [127 + 10 * E, 37.55]];
    expect(stepHeading(east)).toBeCloseTo(90, 1);
    expect(stepHeading([[127, 37.55], [127, 37.55]])).toBeNull();
    expect(stepHeading([[127, 37.55], [127, 37.550005]])).toBeNull();
    // 꺾이는 단계: 앞쪽 25 m 지점까지의 방위(첫 구간 방향 쪽).
    const bend: [number, number][] = [[127, 37.55], [127, 37.5502], [127 + 20 * E, 37.5502]];
    const h = stepHeading(bend)!;
    expect(h).toBeGreaterThan(0); expect(h).toBeLessThan(90);
    expect(pointAlong(north, 1e9)!.walkedM).toBeCloseTo(110.5, 0);
  });
  it('카메라: 방위가 있으면 앞쪽 구간 가운데·배율 16.5~19.5, 없으면 null(정북 맞춤)', () => {
    const line: [number, number][] = [[127.045, 37.557], [127.045, 37.5575]];
    const cam = navCamera(line, 0, 700)!;
    expect(cam.bearing).toBe(0);
    expect(cam.zoom).toBeGreaterThanOrEqual(16.5); expect(cam.zoom).toBeLessThanOrEqual(19.5);
    expect(cam.center[1]).toBeGreaterThan(37.557); expect(cam.center[1]).toBeLessThan(37.5575);
    expect(navCamera(line, null, 700)).toBeNull();
  });
  it('카드마다 bearingDeg: 실외 걷기는 방위, 실내 도면·엘리베이터 단계는 null', async () => {
    const rt = await fixtureRuntime();
    const route = computeRoute(rt, { from: { kind: 'node', nodeId: 'n_out_0001' }, to: { kind: 'node', nodeId: 'n_A_4_408door' }, mode: 'shortest' }).route!;
    const cards = navCards(route, rt.graph);
    expect(cards[0]!.buildingId).toBeNull();
    expect(cards[0]!.bearingDeg).toBeTypeOf('number');
    for (const c of cards) if (c.buildingId !== null) expect(c.bearingDeg).toBeNull();
    const lift = computeRoute(rt, { from: { kind: 'node', nodeId: 'n_out_0001' }, to: { kind: 'node', nodeId: 'n_A_4_408door' }, mode: 'elevator_first' }).route!;
    navCards(lift, rt.graph).forEach((c, i) => { if (lift.steps[i]?.kind === 'elevator') expect(c.bearingDeg).toBeNull(); });
  });
  it('지도는 easeTo(bearing, pitch 45, 700ms)로 돌리고, 사용자가 돌린 방위는 같은 단계 동안 지킨다', () => {
    expect(MAP).toContain('pitch: keep ? pitchRef.current : NAV_PITCH_DEG, padding: fitPadding, duration: 700');
    expect(MAP).toContain('userInteraction');
    expect(SCREEN).toContain('bearingDeg: card.bearingDeg');
  });
});

describe('[6] 3D 보기: 층별 수직 분리', () => {
  it('어댑터: 그래프 건물 → buildingStack 입력(측정 층고 없으면 3.9 m)', async () => {
    const rt = await real();
    const b = [...rt.graph.buildings.values()].find((x) => x.properties.name === '공업센터')!;
    const stack = buildingStack(asEditBuilding(b));
    expect(stack.map((f) => f.level)).toEqual(b.properties.levels);
    expect(stack[1]!.baseM).toBeCloseTo(3.9, 6);
    expect(isStackable(b)).toBe(true);
  });
  it('건물·층을 고르면: 고른 층은 지면(슬래브 없음), 위층만 쌓고, 다른 건물은 외곽선만', async () => {
    const rt = await real();
    const b = [...rt.graph.buildings.values()].find((x) => x.properties.name === '공업센터')!;
    const s = stack3d(rt.graph, b.id, 3);
    expect(s.slabs.features.every((f) => f.properties.buildingId === b.id)).toBe(true);
    expect(s.slabs.features.map((f) => f.properties.level)).toEqual([4, 5, 6, 7]);
    expect(s.slabs.features[0]!.properties.baseM).toBeCloseTo(3.9, 6);
    expect(s.outlines.features.length).toBe(rt.graph.buildings.size - 1);
  });
  it('엘리베이터(같은 elevator_id)와 계단(인접 층 같은 자리)을 고른 층부터 세로 기둥으로 잇고 색을 나눈다', async () => {
    const rt = await real();
    const b = [...rt.graph.buildings.values()].find((x) => x.properties.name === '제1공학관')!;
    const s = stack3d(rt.graph, b.id, 1);
    const lifts = s.pillars.features.filter((f) => f.properties.kind === 'elevator');
    const stairs = s.pillars.features.filter((f) => f.properties.kind === 'stairs');
    expect(lifts.length).toBe(2); // elevA, elevB
    expect(stairs.length).toBeGreaterThan(0);
    for (const f of [...lifts, ...stairs]) {
      expect(f.properties.baseM).toBeGreaterThanOrEqual(0);
      expect(f.properties.topM).toBeGreaterThan(f.properties.baseM + 3);
    }
    expect(lifts[0]!.properties.color).not.toBe(stairs[0]!.properties.color);
    expect(lifts[0]!.properties.baseM).toBe(0);
    expect(STAIR_PAIR_M).toBeGreaterThan(0);
  });
  it('아무 건물도 고르지 않으면 층이 둘 이상인 건물을 1층 기준으로 옅게 세운다(지하 생략, 기둥 없음)', async () => {
    const rt = await real();
    const s = stack3d(rt.graph, null, null);
    expect(s.pillars.features).toEqual([]);
    expect(s.outlines.features).toEqual([]);
    expect(s.slabs.features.every((f) => f.properties.baseM >= 0 && f.properties.level >= 1)).toBe(true);
    expect(new Set(s.slabs.features.map((f) => f.properties.buildingId)).size).toBeGreaterThan(3);
  });
  it('기둥은 작은 정사각형(닫힌 고리)', () => {
    const ring = squareAround([127, 37.5], 2)[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });
  it('지도: fill-extrusion 슬래브·기둥, 3D 토글은 FAB 옆, 기울기 50', () => {
    expect(MAP).toContain('type="fill-extrusion"');
    expect(MAP).toContain("'fill-extrusion-base': ['get', 'baseM'], 'fill-extrusion-height': ['get', 'topM']");
    expect(SCREEN).toContain('<Stack3DIcon on={threeD} />');
  });
});

describe('[7] 길게 눌러 핀 → 출발/도착', () => {
  it('Map onLongPress를 연결하고 핀을 그린다', () => {
    expect(MAP).toContain('onLongPress={onMapLongPress}');
    expect(MAP).toContain('id="press-pin"');
    expect(SCREEN).toContain("if (mapPick || screen === 'nav' || search !== null || roadview !== null || data.status !== 'ready') return;");
    expect(SCREEN).toContain("choosePressed('from')");
    expect(SCREEN).toContain("choosePressed('to')");
  });
  it('핀 설명: 등록 지점 위면 그 지점, 걷는 길에서 멀면 안내 문구', async () => {
    const rt = await fixtureRuntime();
    const gate = rt.places.find((p) => p.id === 'n_out_0001')!;
    const on = pressPinInfo(rt.graph, rt.places, { lng: gate.lng, lat: gate.lat });
    expect(on.place?.id).toBe('n_out_0001');
    expect(on.far).toBe(false);
    const far = pressPinInfo(rt.graph, rt.places, { lng: gate.lng + 0.02, lat: gate.lat });
    expect(far).toMatchObject({ far: true, detail: PRESS_FAR_TEXT, place: null });
  });
});

describe('[8] 사진 핀: 짧은 탭이면 열린다', () => {
  it('핀마다 누를 수 있는 Marker(Pressable 48pt)를 얹고, 네이티브 onPress hitbox는 26px로 넓힌다', () => {
    expect(MAP).toContain('const PIN_HITBOX = { top: 26, right: 26, bottom: 26, left: 26 };');
    expect(MAP).toContain('id="app-photo-spots" data={spotData} hitbox={PIN_HITBOX} onPress={onSpotDot}');
    expect(MAP).toContain('id="app-step-photos" data={groupData} hitbox={PIN_HITBOX} onPress={onGroupDot}');
    expect(MAP).toMatch(/photoSpots\.map\(\(spot, i\) => <PhotoPinMarker/);
    expect(MAP).toMatch(/stepGroups\.map\(\(group, i\) => <PhotoPinMarker/);
  });
  it('같은 터치에서 나온 지도 탭은 무시해 핀이 연 말풍선을 닫지 않는다', () => {
    expect(MAP).toContain('if (Date.now() - pinPressedAt.current < PIN_TAP_GUARD_MS) return;');
  });
});
