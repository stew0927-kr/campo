// 가상 실내·실외 로드뷰 데이터와 로드뷰·화장실 찾기·계층 검색·하단 시트의 순수 로직.
// RN 화면(RoadviewScreen, CampusMap)은 import하지 않는다(typecheck로 확인).
import { describe, expect, it } from 'vitest';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import type { CampusRouteRequest } from '../src/contracts.ts';
import { routeStepPhotos } from '../src/photos/routePhotos.ts';
import { compassName, demoPhotoSvg, headingLabel } from '../src/photos/demoPhotoArt.ts';
import { combineRoundTrip, framePhoto, photoSpots, placeLine, placeLookup, roadviewFrames, spotFrame, stepMarkerGroups, viewCone, viewingText } from '../src/photos/roadviewModel.ts';
import { ROADVIEW_DEMO_CAMPUS, ROADVIEW_DEMO_CATALOG, ROADVIEW_DEMO_PHOTO_ROWS, RV } from '../src/features/map/roadviewDemo.ts';
import { DEMO_CAMPUS } from '../src/features/map/demoCampus.ts';
import { RESTROOM_NONE, nearestRestroom } from '../src/features/map/restroom.ts';
import { OUTDOOR_GROUP, TREE_ROOT, buildingGroups, facilityGroups, levelGroups, treeUp } from '../src/features/map/placeTree.ts';
import { SHEET_COLLAPSED_HEIGHT, dragHeight, releaseSnap, tapSnap, toggleLabel } from '../src/features/map/sheetModel.ts';

const runtime = loadBundledCampus(ROADVIEW_DEMO_CAMPUS);
const lookup = placeLookup(runtime.graph, runtime.places);
const req = (from: string, to: string, mode: CampusRouteRequest['mode'] = 'shortest'): CampusRouteRequest => ({ from: { kind: 'node', nodeId: from }, to: { kind: 'node', nodeId: to }, mode });
const routeOf = (from: string, to: string, mode: CampusRouteRequest['mode'] = 'shortest') => {
  const result = computeRoute(runtime, req(from, to, mode));
  expect(result.status).toBe('ok');
  return result.route!;
};
/** 경로에서 그 지점을 시작하는 단계에 고른 사진 id. */
const photoAt = (route: ReturnType<typeof routeOf>, nodeId: string) => routeStepPhotos(route, ROADVIEW_DEMO_CATALOG).find((s) => s.nodeId === nodeId && s.stepIndex < route.steps.length)?.photo?.photoId;

describe('가상 실내·실외 로드뷰 캠퍼스', () => {
  it('실외·포털·실내 1·2층을 모두 가진 그래프를 문제없이 만든다', () => {
    expect(runtime.issues).toEqual([]);
    expect(runtime.info.name).toContain('가상');
    expect(runtime.buildings).toEqual([{ id: 'bldg_rv_eng', name: '가상 공학관', levels: [1, 2] }]);
    expect(runtime.places.some((p) => p.buildingId === null)).toBe(true);
    expect(runtime.places.some((p) => p.level === 2 && p.roomRef === '201')).toBe(true);
    expect(runtime.places.every((p) => p.name.includes('가상'))).toBe(true);
    const route = routeOf(RV.gate, RV.room201);
    expect(route.steps.map((s) => s.kind)).toEqual(expect.arrayContaining(['portal', 'stairs']));
  });

  it('주요 지점마다 2~4방향 사진을 photoCatalogFromRows로 연결하고, 그림에 실내/실외·지점·방위를 적는다', () => {
    const nodes = new Set(ROADVIEW_DEMO_PHOTO_ROWS.map((r) => r.node_id));
    expect(nodes.size).toBeGreaterThanOrEqual(14);
    for (const id of nodes) {
      const photos = ROADVIEW_DEMO_CATALOG.byNodeId(id);
      expect(photos.length).toBeGreaterThanOrEqual(2);
      expect(photos.length).toBeLessThanOrEqual(4);
      expect(new Set(photos.map((p) => p.heading_deg)).size).toBe(photos.length);
      for (const p of photos) { expect(p.fullUrl.startsWith('data:image/svg+xml')).toBe(true); expect(p.thumbUrl.startsWith('data:image/svg+xml')).toBe(true); }
    }
    expect(ROADVIEW_DEMO_CATALOG.size).toBe(ROADVIEW_DEMO_PHOTO_ROWS.length);
    expect(decodeURIComponent(ROADVIEW_DEMO_CATALOG.byNodeId(RV.fork).find((p) => p.heading_deg === 0)!.fullUrl)).toContain('실외 · 가상 본관 앞 갈림길');
    expect(decodeURIComponent(ROADVIEW_DEMO_CATALOG.byNodeId(RV.lobby).find((p) => p.heading_deg === 90)!.fullUrl)).toContain('동쪽 90° 방향');
    expect(demoPhotoSvg({ place: '가상 로비', indoor: true, levelText: '1층', headingDeg: 90, scene: 'lobby' })).toContain('실내 · 1층 · 가상 로비');
    expect([0, 45, 90, 180, 270, 359].map(compassName)).toEqual(['북쪽', '북동쪽', '동쪽', '남쪽', '서쪽', '북쪽']);
    expect(headingLabel(-90)).toBe('서쪽 270°');
    expect(headingLabel(null)).toBe('방향 정보 없음');
  });
});

describe('다방향 사진 고르기', () => {
  it('왕복: 정문→본관 앞과 본관 앞→정문은 같은 갈림길에서 정반대 방향 사진을 고른다', () => {
    const there = routeOf(RV.gate, RV.hall);
    const back = routeOf(RV.hall, RV.gate);
    expect(photoAt(there, RV.fork)).toBe('rv_fork_0');
    expect(photoAt(back, RV.fork)).toBe('rv_fork_180');
  });

  it('갈림길: 왼쪽(광장)과 오른쪽(공학관)으로 갈 때 각각 진출 방향 사진을 고른다', () => {
    expect(photoAt(routeOf(RV.gate, RV.plaza), RV.fork)).toBe('rv_fork_270');
    expect(photoAt(routeOf(RV.gate, RV.engFront), RV.fork)).toBe('rv_fork_90');
  });

  it('실내 로비: 계단으로 갈 때와 엘리베이터(휠체어)로 갈 때 다른 사진을 고르고, 도착 사진도 붙는다', () => {
    const stairs = routeOf(RV.gate, RV.room201, 'shortest');
    const lift = routeOf(RV.gate, RV.room201, 'wheelchair');
    expect(photoAt(stairs, RV.lobby)).toBe('rv_e1_lobby_0');
    expect(photoAt(lift, RV.lobby)).toBe('rv_e1_lobby_90');
    expect(lift.stairsCount).toBe(0);
    const arrival = routeStepPhotos(stairs, ROADVIEW_DEMO_CATALOG).at(-1)!;
    expect(arrival.stepIndex).toBe(stairs.steps.length);
    expect(arrival.photo?.photoId).toBe('rv_e2_201_90');
  });
});

describe('로드뷰 장면과 지도 마커', () => {
  it('왕복 경로를 이어도 같은 지점의 두 단계가 덮어써지지 않고 가는 길/오는 길로 남는다', () => {
    const trip = combineRoundTrip(routeOf(RV.gate, RV.hall), routeOf(RV.hall, RV.gate))!;
    expect(trip.backFrom).toBe(2);
    expect(trip.route.nodeIds).toEqual([RV.gate, RV.fork, RV.hall, RV.fork, RV.gate]);
    const stepPhotos = routeStepPhotos(trip.route, ROADVIEW_DEMO_CATALOG);
    const groups = stepMarkerGroups(stepPhotos, trip.route.steps.length, trip.backFrom);
    const fork = groups.find((g) => g.nodeId === RV.fork)!;
    expect(fork.entries.map((e) => e.label)).toEqual(['가는 길 · 2단계', '오는 길 · 4단계']);
    const frames = roadviewFrames(trip.route, stepPhotos, ROADVIEW_DEMO_CATALOG, lookup, trip.backFrom);
    expect(fork.entries.map((e) => frames[e.index]!.step.photo!.photoId)).toEqual(['rv_fork_0', 'rv_fork_180']);
    expect(frames[fork.entries[1]!.index]!.counter).toMatch(/^오는 길 · \d+ \/ \d+ · 가상 본관 앞 갈림길$/);
    expect(new Set(frames.map((f) => f.key)).size).toBe(frames.length);
    // 정문은 출발(가는 길 1단계)과 도착(오는 길 끝) 두 번 나온다.
    expect(groups.find((g) => g.nodeId === RV.gate)!.entries.map((e) => e.label)).toEqual(['가는 길 · 1단계', '오는 길 · 도착']);
    expect(combineRoundTrip(null, trip.route)).toBeNull();
  });

  it('장면은 지점의 모든 방향 사진·실내외·층을 주고, 다른 방향을 고르면 화살표를 다시 잡는다', () => {
    const route = routeOf(RV.gate, RV.room201);
    const frames = roadviewFrames(route, routeStepPhotos(route, ROADVIEW_DEMO_CATALOG), ROADVIEW_DEMO_CATALOG, lookup);
    const lobby = frames.find((f) => f.nodeId === RV.lobby)!;
    expect(lobby.photos.map((p) => p.photoId)[0]).toBe('rv_e1_lobby_0');
    expect(lobby.photos).toHaveLength(4);
    expect(placeLine(lobby.place)).toBe('가상 공학관 · 1층 · 실내');
    expect(viewingText(lobby.step.photo)).toBe('북쪽 0° 방향을 보고 있습니다.');
    const side = framePhoto(lobby, lobby.photos.find((p) => p.heading_deg === 90)!);
    expect(side.photo!.photoId).toBe('rv_e1_lobby_90');
    expect(side.arrow?.label).toBe('왼쪽');
    const stair = frames.find((f) => f.nodeId === RV.stair1)!;
    expect(stair.place.name).toBe('가상 공학관 1층 계단');
    expect(placeLine(frames[0]!.place)).toBe('실외');
  });

  it('경로 없이 사진 지점만 볼 때는 화살표·배지 없이 북쪽에 가까운 사진부터 보인다', () => {
    const frame = spotFrame(RV.plaza, [127, 37], ROADVIEW_DEMO_CATALOG, lookup)!;
    expect(frame.index).toBeNull();
    expect(frame.step.photo!.photoId).toBe('rv_plaza_0');
    expect(framePhoto(frame, frame.photos[2]!)).toMatchObject({ arrow: null, badge: null });
    expect(spotFrame('rv_none', null, ROADVIEW_DEMO_CATALOG, lookup)).toBeNull();
  });

  it('사진 지점은 실외 보기와 건물·층 보기를 나눠서 준다', () => {
    const outdoor = photoSpots(runtime.graph, ROADVIEW_DEMO_CATALOG, null, null).map((s) => s.nodeId);
    expect(outdoor).toEqual(expect.arrayContaining([RV.gate, RV.fork, RV.plaza, RV.engFront]));
    expect(outdoor).not.toContain(RV.lobby);
    const second = photoSpots(runtime.graph, ROADVIEW_DEMO_CATALOG, 'bldg_rv_eng', 2).map((s) => s.nodeId);
    expect(second.sort()).toEqual([RV.elev2, RV.room201, RV.hall2, RV.stair2, RV.wc2].sort());
    expect(photoSpots(runtime.graph, null, null, null)).toEqual([]);
  });

  it('미니 지도 시야각 부채꼴은 사진 방향으로 돌고, 방향이 없으면 그리지 않는다', () => {
    const apex: [number, number] = [127.045, 37.556];
    const mid = (heading: number) => {
      const ring = viewCone(apex, heading, 60, 30, 2)!.geometry.coordinates[0]!;
      expect(ring[0]).toEqual(apex); expect(ring.at(-1)).toEqual(apex);
      return ring[2] as [number, number]; // 가운데 호 위의 점
    };
    const north = mid(0), east = mid(90), south = mid(180);
    expect(north[1]).toBeGreaterThan(apex[1]); expect(Math.abs(north[0] - apex[0])).toBeLessThan(1e-9);
    expect(east[0]).toBeGreaterThan(apex[0]); expect(Math.abs(east[1] - apex[1])).toBeLessThan(1e-9);
    expect(south[1]).toBeLessThan(apex[1]);
    expect(viewCone(apex, 0, 60)!.properties).toEqual({ heading: 0, hfov: 60 });
    expect(viewCone(apex, null)).toBeNull();
  });
});

describe('가장 가까운 화장실', () => {
  it('정문에서 아무 화장실이면 계단 너머 야외 화장실, 휠체어 가능이면 공학관 1층 화장실로 간다', () => {
    const any = nearestRestroom(runtime, { kind: 'node', nodeId: RV.gate }, false);
    expect(any).toMatchObject({ found: true, nodeId: RV.plazaWc, request: { mode: 'shortest' } });
    const wheel = nearestRestroom(runtime, { kind: 'node', nodeId: RV.gate }, true);
    expect(wheel).toMatchObject({ found: true, nodeId: RV.wc1, request: { mode: 'wheelchair' } });
    const route = computeRoute(runtime, (wheel as { request: CampusRouteRequest }).request);
    expect(route.status).toBe('ok'); expect(route.route!.stairsCount).toBe(0);
  });

  it('지도에서 찍은 점에서도 찾고, 휠체어를 끄면 이전 이동 방식으로 돌아가며, 화장실이 없으면 안내한다', () => {
    const [lng, lat] = runtime.graph.nodes.get(RV.engFront)!.geometry.coordinates as [number, number];
    const fromPoint = nearestRestroom(runtime, { kind: 'point', lat: lat + 0.00002, lng }, false, 'wheelchair');
    expect(fromPoint).toMatchObject({ found: true, nodeId: RV.wc1, request: { mode: 'shortest' } });
    expect(computeRoute(runtime, (fromPoint as { request: CampusRouteRequest }).request).status).toBe('ok');
    expect(nearestRestroom(loadBundledCampus(DEMO_CAMPUS), { kind: 'node', nodeId: 'demo_0' }, false)).toEqual({ found: false, message: RESTROOM_NONE });
    expect(nearestRestroom(null, { kind: 'node', nodeId: 'x' }, true).found).toBe(false);
  });
});

describe('계층 검색(건물 → 층 → 시설)', () => {
  it('건물, 그 건물의 층, 층의 시설을 종류별로 묶는다', () => {
    const buildings = buildingGroups(runtime.places, runtime.buildings);
    expect(buildings.map((b) => b.name)).toEqual(['가상 공학관', '야외 장소']);
    expect(buildings[0]).toMatchObject({ levelCount: 2 });
    expect(levelGroups(runtime.places, 'bldg_rv_eng').map((l) => l.label)).toEqual(['1층', '2층']);
    const first = facilityGroups(runtime.places, 'bldg_rv_eng', 1);
    expect(first.map((g) => g.label)).toEqual(['화장실', '출입구', '기타 장소']);
    const second = facilityGroups(runtime.places, 'bldg_rv_eng', 2);
    expect(second.find((g) => g.kind === 'classroom')!.places.map((p) => p.name)).toEqual(['가상 201호 강의실']);
    expect(facilityGroups(runtime.places, OUTDOOR_GROUP, null).find((g) => g.kind === 'restroom')!.places[0]!.id).toBe(RV.plazaWc);
  });
  it('한 단계씩 위로 돌아간다', () => {
    expect(treeUp({ building: 'b', level: 2 })).toEqual({ building: 'b', level: null });
    expect(treeUp({ building: 'b', level: null })).toEqual(TREE_ROOT);
    expect(treeUp({ building: OUTDOOR_GROUP, level: null })).toEqual(TREE_ROOT);
    expect(buildingGroups([], [])).toEqual([]);
  });
});

describe('하단 시트 접기·펼치기', () => {
  const h = { expanded: 600, default: 320, collapsed: SHEET_COLLAPSED_HEIGHT };
  it('끄는 동안 접힘~펼침 사이로 자르고, 놓으면 가까운 상태로 간다', () => {
    expect(dragHeight('default', -1000, h)).toBe(600);
    expect(dragHeight('default', 1000, h)).toBe(SHEET_COLLAPSED_HEIGHT);
    expect(releaseSnap('default', 230, 0, h)).toBe('collapsed');
    expect(releaseSnap('default', -200, 0, h)).toBe('expanded');
    expect(releaseSnap('default', 40, 0, h)).toBe('default');
  });
  it('빠르게 튕기면 한 칸, 핸들을 누르면 접기/펴기', () => {
    expect(releaseSnap('expanded', 10, 1.2, h)).toBe('default');
    expect(releaseSnap('collapsed', -10, -1.2, h)).toBe('default');
    expect(releaseSnap('collapsed', 10, 2, h)).toBe('collapsed');
    expect(tapSnap('default')).toBe('collapsed');
    expect(tapSnap('expanded')).toBe('collapsed');
    expect(tapSnap('collapsed')).toBe('default');
    expect(toggleLabel('collapsed')).toBe('시트 펼치기');
    expect(toggleLabel('default')).toBe('시트 접기');
  });
});
