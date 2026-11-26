// 사진 길안내의 순수 로직: 사진 공급자 어댑터, 단계별 사진 고르기, 지도 마커 값, 뷰어 페이지, 화면 문구.
// RN·MapLibre 컴포넌트(RoutePhotoMarkers.tsx, PhotoViewerModal.tsx)는 여기서 import하지 않는다(typecheck로 확인).
import { beforeAll, describe, expect, it } from 'vitest';
import type { CampusRuntime } from '../src/campus/types.ts';
import type { CampusRouteView, PhotoRow, RoutePhoto } from '../src/contracts.ts';
import { EMPTY_PHOTO_CATALOG, isEmptyCatalog, photoCatalogFromRows } from '../src/photos/catalog.ts';
import { turnGuide } from '../src/photos/turnGuide.ts';
import { APPROXIMATE_BADGE, ARRIVAL_TEXT, arrowSentence, otherPhotosButtonText, photoAccessibilityLabel, photoCounterText } from '../src/photos/photoText.ts';
import { arrowForPhoto, nodePositions, otherPhotosAt, routeStepPhotos } from '../src/photos/routePhotos.ts';
import { markerIndexOf, photoMarkerFeatures, photoViewerPages, thumbImages, thumbKeyOf, withPhoto } from '../src/photos/viewerModel.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { fixtureRuntime } from './helpers.ts';

const GATE = 'n_out_0001';
const ROOM_408 = 'n_A_4_408door';

const row = (id: string, node_id: string, heading_deg: number | null, extra: Partial<PhotoRow> = {}): PhotoRow => ({
  id, node_id, heading_deg, thumb_url: `https://cdn.example/t/${id}.webp`, full_url: `https://cdn.example/v/${id}.webp`, ...extra,
});

describe('photoCatalogFromRows', () => {
  it('비어 있으면(null·undefined·[]) 빈 카탈로그를 준다', () => {
    expect(photoCatalogFromRows(null)).toBe(EMPTY_PHOTO_CATALOG);
    expect(photoCatalogFromRows(undefined)).toBe(EMPTY_PHOTO_CATALOG);
    expect(photoCatalogFromRows([])).toBe(EMPTY_PHOTO_CATALOG);
    expect(EMPTY_PHOTO_CATALOG.byNodeId('n_any')).toEqual([]);
    expect(EMPTY_PHOTO_CATALOG.size).toBe(0);
    expect(isEmptyCatalog(null)).toBe(true);
    expect(isEmptyCatalog({ byNodeId: () => [] })).toBe(false); // size를 안 주는 공급자는 있다고 본다
  });

  it('행을 지점별로 묶고 행 순서를 지키며, thumb_url/full_url을 thumbUrl/fullUrl로 옮긴다', () => {
    const catalog = photoCatalogFromRows([
      row('p1', 'n_a', 87, { heading_source: 'dial', direction_hint: ' 사진 오른쪽 두 번째 문 ', hfov_deg: 65.3 }),
      row('p2', 'n_b', 10),
      row('p3', 'n_a', 267, { heading_source: null, direction_hint: null, hfov_deg: null }),
    ]);
    expect(catalog.size).toBe(3);
    expect(catalog.byNodeId('n_a')).toEqual([
      { photoId: 'p1', nodeId: 'n_a', heading_deg: 87, heading_source: 'dial', direction_hint: '사진 오른쪽 두 번째 문', hfov_deg: 65.3, thumbUrl: 'https://cdn.example/t/p1.webp', fullUrl: 'https://cdn.example/v/p1.webp' },
      { photoId: 'p3', nodeId: 'n_a', heading_deg: 267, thumbUrl: 'https://cdn.example/t/p3.webp', fullUrl: 'https://cdn.example/v/p3.webp' },
    ]);
    expect(catalog.byNodeId('n_none')).toEqual([]);
    // 돌려준 배열을 고쳐도 카탈로그는 그대로다.
    catalog.byNodeId('n_a').pop();
    expect(catalog.byNodeId('n_a')).toHaveLength(2);
  });

  it('필수 값이 빈 행·중복 id는 버리고, 이상한 선택 값은 빼며, 방향은 0~360으로 접는다', () => {
    const catalog = photoCatalogFromRows([
      row('', 'n_a', 1),
      row('x1', '', 1),
      { ...row('x2', 'n_a', 1), thumb_url: '' },
      { ...row('x3', 'n_a', 1), full_url: null as unknown as string },
      null as unknown as PhotoRow,
      row('ok1', 'n_a', 360),
      row('ok1', 'n_a', 90),
      row('ok2', 'n_a', -10, { heading_source: 'guess' as never, hfov_deg: 200 }),
      row('ok3', 'n_a', Number.NaN),
    ]);
    expect(catalog.byNodeId('n_a').map((p) => [p.photoId, p.heading_deg, p.heading_source, p.hfov_deg])).toEqual([
      ['ok1', 0, undefined, undefined],
      ['ok2', 350, undefined, undefined],
      ['ok3', null, undefined, undefined],
    ]);
    expect(photoCatalogFromRows([row('', '', 1)])).toBe(EMPTY_PHOTO_CATALOG);
  });
});

describe('routeStepPhotos (useRoutePhotos)', () => {
  let runtime: CampusRuntime;
  let route: CampusRouteView;
  beforeAll(async () => {
    runtime = await fixtureRuntime();
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'node', nodeId: ROOM_408 }, mode: 'shortest' });
    route = state.route!;
  });
  const coords = (id: string) => runtime.graph.nodes.get(id)!.geometry.coordinates as [number, number];

  it('경로가 없거나 카탈로그가 비면 []', () => {
    expect(routeStepPhotos(null, photoCatalogFromRows([row('p', GATE, 0)]))).toEqual([]);
    expect(routeStepPhotos(route, null)).toEqual([]);
    expect(routeStepPhotos(route, EMPTY_PHOTO_CATALOG)).toEqual([]);
    expect(routeStepPhotos(route, photoCatalogFromRows([]))).toEqual([]);
  });

  it('코어가 단계마다 방향을 채워 준다(계약의 선택 필드)', () => {
    expect(route.steps[0]!.bearing_deg).toBeTypeOf('number');
    expect(route.steps.at(-1)!.bearing_arrive_deg).toBeTypeOf('number');
  });

  it('단계마다 하나 + 도착 하나. 나가는 방향 사진은 ahead, 사진 없는 지점은 none', () => {
    const first = route.steps[0]!;
    const last = route.steps.at(-1)!;
    const catalog = photoCatalogFromRows([
      row('wrong-way', GATE, first.bearing_deg! + 180),
      row('ahead', GATE, first.bearing_deg! + 20),
      row('arrive', ROOM_408, last.bearing_arrive_deg!),
    ]);
    const photos = routeStepPhotos(route, catalog);
    expect(photos).toHaveLength(route.steps.length + 1);
    expect(photos.map((p) => p.stepIndex)).toEqual([...route.steps.keys(), route.steps.length]);

    const start = photos[0]!;
    expect(start).toMatchObject({ nodeId: GATE, pick: 'ahead', photo: { photoId: 'ahead' }, badge: null });
    expect(start.deltaDeg).toBeCloseTo(-20, 6);
    expect(start.arrow).toMatchObject({ mode: 'inFrame', label: '약간 왼쪽' });
    expect(start.lngLat).toEqual(coords(GATE));
    expect(start.targetDeg).toBe(first.bearing_deg);

    const arrival = photos.at(-1)!;
    expect(arrival).toMatchObject({ nodeId: ROOM_408, pick: 'ahead', photo: { photoId: 'arrive' } });
    expect(arrival.deltaDeg).toBeCloseTo(0, 6);
    expect(arrival.lngLat).toEqual(coords(ROOM_408));

    for (const p of photos.slice(1, -1)) expect(p).toMatchObject({ pick: 'none', photo: null, deltaDeg: null, arrow: null, badge: null });
  });

  it('±45° 밖이면 들어오는 방향 사진(approach, 화살표는 나가는 방향 기준), 그다음 ±90°(approximate + 배지)', () => {
    // 꺾이는 단계(들어오는 방향과 나가는 방향이 45° 넘게 다른 곳)를 하나 고른다.
    const i = route.steps.findIndex((s, k) => k > 0 && Math.abs(s.bearing_turn_deg ?? 0) > 60);
    expect(i).toBeGreaterThan(0);
    const step = route.steps[i]!;
    const approach = routeStepPhotos(route, photoCatalogFromRows([row('in', step.fromNodeId, step.bearing_in_deg!)]))[i]!;
    expect(approach.pick).toBe('approach');
    expect(approach.deltaDeg).toBeCloseTo(step.bearing_turn_deg!, 6);
    expect(approach.badge).toBeNull();

    const near = routeStepPhotos(route, photoCatalogFromRows([row('side', GATE, route.steps[0]!.bearing_deg! + 70)]))[0]!;
    expect(near).toMatchObject({ pick: 'approximate', badge: APPROXIMATE_BADGE, arrow: { mode: 'edge', label: '왼쪽' } });

    const none = routeStepPhotos(route, photoCatalogFromRows([row('back', GATE, route.steps[0]!.bearing_deg! + 180), row('nohead', GATE, null)]))[0]!;
    expect(none.pick).toBe('none');
  });

  it('사진의 화각(hfov_deg)으로 화살표가 사진 안/밖을 가른다', () => {
    const b = route.steps[0]!.bearing_deg!;
    const wide = routeStepPhotos(route, photoCatalogFromRows([row('w', GATE, b - 30, { hfov_deg: 65 })]))[0]!;
    const narrow = routeStepPhotos(route, photoCatalogFromRows([row('n', GATE, b - 30, { hfov_deg: 51 })]))[0]!;
    expect(wide.arrow?.mode).toBe('inFrame');
    expect(narrow.arrow?.mode).toBe('edge');
  });

  it('지도 위 점에서 출발한 경로도 지점 좌표를 맞게 찾는다(polyline 앞의 발끝을 건너뜀)', () => {
    const view = {
      polyline: [{ lat: 1, lng: 2 }, { lat: 37.1, lng: 127.1 }, { lat: 37.2, lng: 127.2 }, { lat: 9, lng: 9 }],
      nodeIds: ['a', 'b'],
      snappedStartM: 3,
    };
    expect(nodePositions(view).get('a')).toEqual([127.1, 37.1]);
    expect(nodePositions({ polyline: view.polyline, nodeIds: view.nodeIds }).get('a')).toEqual([2, 1]);
  });
});

describe('지도 마커와 뷰어 페이지', () => {
  let route: CampusRouteView;
  beforeAll(async () => {
    const runtime = await fixtureRuntime();
    route = computeRoute(runtime, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'node', nodeId: ROOM_408 }, mode: 'shortest' }).route!;
  });

  it('사진과 좌표가 있는 단계만 점으로, 썸네일 URL은 Images 등록표로, 탭은 단계 위치로 돌아온다', () => {
    const b0 = route.steps[0]!.bearing_deg!;
    const catalog = photoCatalogFromRows([row('g/1', GATE, b0), row('side', ROOM_408, route.steps.at(-1)!.bearing_arrive_deg! + 70)]);
    const stepPhotos = routeStepPhotos(route, catalog);
    const fc = photoMarkerFeatures(stepPhotos);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { icon: 'route-photo-g_1', index: 0, warn: false },
      { icon: thumbKeyOf('side'), index: stepPhotos.length - 1, warn: true },
    ]);
    expect(thumbImages(stepPhotos)).toEqual({
      'route-photo-g_1': { source: { uri: 'https://cdn.example/t/g/1.webp' } },
      'route-photo-side': { source: { uri: 'https://cdn.example/t/side.webp' } },
    });
    expect(markerIndexOf(fc.features[1])).toBe(stepPhotos.length - 1);
    expect(markerIndexOf({ id: 'x', properties: {} })).toBeNull();
    expect(markerIndexOf(undefined)).toBeNull();
    expect(photoMarkerFeatures([]).features).toEqual([]);
  });

  it('뷰어는 단계마다 한 페이지: "3 / 7 · 장소", 단계 문구, 같은 지점 다른 사진(가까운 방향 먼저, 방향 없는 사진 뒤)', () => {
    const b0 = route.steps[0]!.bearing_deg!;
    const catalog = photoCatalogFromRows([
      row('none-head', GATE, null),
      row('far', GATE, b0 + 80),
      row('best', GATE, b0 + 5),
      row('near', GATE, b0 - 30),
    ]);
    const stepPhotos = routeStepPhotos(route, catalog);
    const pages = photoViewerPages(route, stepPhotos, catalog, (id) => (id === GATE ? '정문' : null));
    const total = route.steps.length + 1;
    expect(pages).toHaveLength(total);
    expect(pages[0]!.counter).toBe(`1 / ${total} · 정문`);
    expect(pages[0]!.stepText).toBe(route.steps[0]!.text);
    expect(pages[0]!.step.photo?.photoId).toBe('best');
    expect(pages[0]!.others.map((p) => p.photoId)).toEqual(['near', 'far', 'none-head']);
    expect(pages[0]!.accessibilityLabel).toMatch(new RegExp(`^사진 1/${total}, 정문\\. 앞으로 직진하세요\\.`));
    expect(pages.at(-1)!.stepText).toBe(ARRIVAL_TEXT);
    expect(pages.at(-1)!.counter).toBe(`${total} / ${total} · 4층`); // 이름을 모르면 층 표시
    expect(photoViewerPages(null, stepPhotos, catalog)).toEqual([]);
    expect(photoViewerPages(route, [], catalog)).toEqual([]);
  });

  it('다른 사진으로 바꾸면 같은 가야 할 방향으로 화살표를 다시 잡고, 45° 넘거나 방향이 없으면 배지를 단다', () => {
    const step = { stepIndex: 0, nodeId: 'n', lngLat: null, pick: 'ahead' as const, photo: null, deltaDeg: 0, arrow: null, targetDeg: 90, badge: null };
    const photo = (heading_deg: number | null): RoutePhoto => ({ photoId: 'p', nodeId: 'n', heading_deg, thumbUrl: 't', fullUrl: 'f' });
    expect(withPhoto(step, photo(80))).toMatchObject({ deltaDeg: 10, arrow: { mode: 'inFrame' }, badge: null });
    expect(withPhoto(step, photo(0))).toMatchObject({ deltaDeg: 90, arrow: { mode: 'edge', label: '오른쪽' }, badge: APPROXIMATE_BADGE });
    expect(withPhoto(step, photo(null))).toMatchObject({ deltaDeg: null, arrow: null, badge: APPROXIMATE_BADGE });
    expect(arrowForPhoto(photo(10), null)).toBeNull();
    expect(otherPhotosAt([photo(10)], 0, 'p')).toEqual([]);
  });
});

describe('사진 안내 문구', () => {
  it('번호·버튼·화살표 문장·스크린리더 레이블', () => {
    expect(photoCounterText(2, 7, '공학관 2층 엘리베이터 앞')).toBe('3 / 7 · 공학관 2층 엘리베이터 앞');
    expect(photoCounterText(0, 1)).toBe('1 / 1');
    expect(otherPhotosButtonText(2)).toBe('이 지점 다른 사진(2)');
    // 화살표 각도만으로(직진 거리를 모를 때): 45° 안은 직진, 넘으면 바로 꺾기. "정면"·"약간 왼쪽"은 쓰지 않는다.
    expect(arrowSentence({ mode: 'inFrame', rotateDeg: 3, xRatio: 0.52, label: '정면' })).toBe('앞으로 직진하세요.');
    expect(arrowSentence({ mode: 'inFrame', rotateDeg: 28, xRatio: 0.9, label: '약간 오른쪽' })).toBe('앞으로 직진하세요.');
    expect(arrowSentence({ mode: 'edge', rotateDeg: -92, label: '왼쪽' })).toBe('바로 왼쪽으로 가세요.');
    expect(arrowSentence({ mode: 'behind', rotateDeg: 178, label: '뒤로' })).toBe('뒤로 돌아서(약 180°) 가세요.');
    // 경로선에서 잰 직진 거리가 있으면 그 문장.
    expect(arrowSentence({ mode: 'inFrame', rotateDeg: 5, xRatio: 0.5, label: '정면' }, turnGuide({ distanceM: 24, turnDeg: -88 }, 5))).toBe('25m 직진 후 왼쪽으로 가세요.');
    expect(photoAccessibilityLabel({
      index: 2, total: 7, place: '공학관 2층 엘리베이터 앞', arrow: { mode: 'inFrame', rotateDeg: 10, xRatio: 0.6, label: '정면' },
      guide: turnGuide({ distanceM: 31, turnDeg: 90 }, 10), hint: '사진 오른쪽 두 번째 문', badge: null,
    })).toBe('사진 3/7, 공학관 2층 엘리베이터 앞. 30m 직진 후 오른쪽으로 가세요. 사진 오른쪽 두 번째 문.');
    expect(photoAccessibilityLabel({ index: 0, total: 2, arrow: null })).toBe('사진 1/2.');
  });
});
