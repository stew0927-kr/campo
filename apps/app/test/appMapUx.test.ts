// 지도 UX 개편의 순수 로직: 배율 단계, 미터/픽셀 근사, 겹침 제거, 시설 아이콘 추출, 매핑 건물·층 선택, 반화면 검색 시트 높이.
// RN 화면(CampusMap, MapGlyphs)은 import하지 않는다(typecheck로 확인).
import { describe, expect, it } from 'vitest';
import { bundleOf, fixtureRuntime } from './helpers.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { fileURLToPath } from 'node:url';
import type { CampusPlace } from '../src/contracts.ts';
import {
  BUILDING_LABEL_MIN_SPAN_PX, BUILDING_LABEL_MIN_ZOOM, MAX_BUILDING_LABELS, buildingLabelSize,
  ICON_DETAIL_MIN_ZOOM, INDOOR_LABEL_MIN_ZOOM, LABEL_MAX_WIDTH_PX, MAX_LABELS, OUTDOOR_LABEL_MIN_ZOOM, PRIORITY,
  buildMarkers, declutter, estimateLabelWidth, floorFacilityNodes, markerKind, metersPerPixel, toScreen, zoomStage, type MapMarker, type MapView,
} from '../src/features/map/mapLabels.ts';
import { buildingCenter, buildingLabels, buildingShapes, floorChoice, levelChip, mappedBuildings } from '../src/features/map/buildings.ts';
import { releaseSnap, searchSheetHeights, SEARCH_SHEET_DEFAULT_SHARE, SEARCH_SHEET_EXPANDED_SHARE } from '../src/features/map/sheetModel.ts';

const place = (id: string, lng: number, lat: number, nodeType = 'door', name = id): CampusPlace => ({ id, name, nodeType, buildingId: 'b', level: 1, lng, lat });
const view = (zoom: number, extra: Partial<MapView> = {}): MapView => ({ lng: 127.045, lat: 37.557, zoom, bearing: 0, width: 400, height: 700, ...extra });

describe('zoom stages', () => {
  it('hides names when zoomed out, keeps icons in the middle and shows names only when close', () => {
    expect(ICON_DETAIL_MIN_ZOOM).toBeLessThan(INDOOR_LABEL_MIN_ZOOM);
    expect(zoomStage(16.5, true)).toBe('overview');
    expect(zoomStage(ICON_DETAIL_MIN_ZOOM, true)).toBe('icons');
    expect(zoomStage(19.4, true)).toBe('icons');
    expect(zoomStage(INDOOR_LABEL_MIN_ZOOM, true)).toBe('labels');
    // Outdoor places are sparse, so their names come a little earlier.
    expect(zoomStage(OUTDOOR_LABEL_MIN_ZOOM, false)).toBe('labels');
    expect(zoomStage(OUTDOOR_LABEL_MIN_ZOOM - 0.1, false)).not.toBe('labels');
  });
  it('approximates metres per pixel by latitude and halves it per zoom level', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metersPerPixel(37.557, 19) / metersPerPixel(37.557, 20)).toBeCloseTo(2, 6);
    expect(metersPerPixel(60, 10)).toBeCloseTo(metersPerPixel(0, 10) / 2, 6);
  });
  it('projects coordinates to screen pixels from the view centre (x east, y down) and follows the bearing', () => {
    const v = view(20);
    const mpp = metersPerPixel(v.lat, v.zoom);
    const tenMetersNorth = 10 / 110_540;
    const north = toScreen(v.lng, v.lat + tenMetersNorth, v);
    expect(north.x).toBeCloseTo(0, 6); expect(north.y).toBeCloseTo(-10 / mpp, 3);
    // Rotated 90°: north now points left on screen.
    const rotated = toScreen(v.lng, v.lat + tenMetersNorth, { ...v, bearing: 90 });
    expect(rotated.x).toBeCloseTo(-10 / mpp, 3); expect(rotated.y).toBeCloseTo(0, 3);
  });
});

describe('marker priority and decluttering', () => {
  it('ranks endpoints > selection > route > facilities > classrooms and keeps one marker per id', () => {
    const room = place('room', 127.045, 37.557);
    const wc = place('wc', 127.0451, 37.557, 'restroom');
    const start = place('start', 127.0452, 37.557, 'entrance');
    const sel = place('sel', 127.0453, 37.557);
    const onRoute = place('mid', 127.0454, 37.557);
    const markers = buildMarkers({ places: [room, wc, start, sel, onRoute], facilities: [{ id: 'stair', kind: 'stairs', lng: 127.0455, lat: 37.557, name: null }, { id: 'wc', kind: 'restroom', lng: 127.0451, lat: 37.557, name: null }], from: start, selected: sel, routeNodeIds: ['start', 'mid'] });
    const by = Object.fromEntries(markers.map((m) => [m.id, m]));
    expect(markers).toHaveLength(6);
    expect(by['start']).toMatchObject({ priority: PRIORITY.endpoint, tone: 'start' });
    expect(by['sel']).toMatchObject({ priority: PRIORITY.selected, tone: 'selected' });
    expect(by['mid']!.priority).toBe(PRIORITY.route);
    expect(by['wc']).toMatchObject({ priority: PRIORITY.facility, name: 'wc', kind: 'restroom' });
    expect(by['wc']!.place).not.toBeNull();
    expect(by['stair']).toMatchObject({ priority: PRIORITY.facility, name: null, place: null });
    expect(by['room']!.priority).toBe(PRIORITY.room);
    expect(markerKind('elevator_stop')).toBe('elevator'); expect(markerKind('corridor')).toBe('place');
  });
  it('drops lower-priority markers that would overlap on screen and never drops the pinned ones', () => {
    const v = view(17); // ~0.9 m/px: 1e-6° apart is far under one icon
    const markers: MapMarker[] = [
      { id: 'room', kind: 'door', lng: v.lng, lat: v.lat, name: '301호', priority: PRIORITY.room, tone: 'normal', place: null },
      { id: 'wc', kind: 'restroom', lng: v.lng + 1e-6, lat: v.lat, name: '화장실', priority: PRIORITY.facility, tone: 'normal', place: null },
      { id: 'end', kind: 'door', lng: v.lng + 2e-6, lat: v.lat, name: '도착', priority: PRIORITY.endpoint, tone: 'end', place: null },
    ];
    const placed = declutter(markers, v, { stage: 'overview' });
    expect(placed.map((p) => p.marker.id)).toEqual(['end']);
    expect(placed.every((p) => !p.label)).toBe(true);
    // Far apart and zoomed in: everything fits, names included.
    const far = markers.map((m, i) => ({ ...m, lng: v.lng + i * 0.00006, tone: 'normal' as const }));
    const close = declutter(far, view(20.5, { width: 800 }), { stage: 'labels' });
    expect(close).toHaveLength(3);
    expect(close.every((p) => p.label)).toBe(true);
  });
  it('shows names only at the labels stage, spaces them apart and caps how many appear', () => {
    const v = view(21);
    // A 10×10 grid ~3 m apart: icons fit, names (wide) collide with each other.
    const grid: MapMarker[] = [];
    for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) grid.push({ id: `${i}-${j}`, kind: 'door', lng: v.lng + i * 0.00003, lat: v.lat + j * 0.00003, name: `${i}${j}호 강의실`, priority: PRIORITY.room, tone: 'normal', place: null });
    expect(declutter(grid, v, { stage: 'icons' }).some((p) => p.label)).toBe(false);
    const labelled = declutter(grid, v, { stage: 'labels' }).filter((p) => p.label);
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.length).toBeLessThanOrEqual(MAX_LABELS);
    // No two names overlap (with the 10px gap).
    for (const a of labelled) for (const b of labelled) {
      if (a === b) continue;
      const w = (m: MapMarker) => estimateLabelWidth(m.name!);
      const apartX = Math.abs(a.x - b.x) >= (w(a.marker) + w(b.marker)) / 2 + 10;
      const apartY = Math.abs(a.y - b.y) >= 24 + 10;
      expect(apartX || apartY).toBe(true);
    }
  });
  it('leaves out markers outside the visible map', () => {
    const v = view(20);
    const off: MapMarker = { id: 'off', kind: 'door', lng: v.lng + 0.01, lat: v.lat, name: '멀리', priority: PRIORITY.room, tone: 'normal', place: null };
    expect(declutter([off], v, { stage: 'labels' })).toEqual([]);
  });
  it('estimates label width from the text and stops at the maximum width', () => {
    expect(estimateLabelWidth('계단')).toBeLessThan(estimateLabelWidth('312-2호 강의실'));
    expect(estimateLabelWidth('아주 긴 이름의 강의실 이름표가 여기에 있습니다')).toBe(LABEL_MAX_WIDTH_PX);
  });
});

describe('facility icons from the graph', () => {
  it('takes unnamed stairs and lifts from graph nodes of one building floor only', async () => {
    const rt = await fixtureRuntime();
    const nodes = floorFacilityNodes(rt.graph, 'bldg_A', 4);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      const props = rt.graph!.nodes.get(n.id)!.properties;
      expect(props.building_id).toBe('bldg_A'); expect(props.level).toBe(4);
    }
    const kinds = new Set(nodes.map((n) => n.kind));
    expect(kinds.has('stairs') || kinds.has('elevator')).toBe(true);
    // Stairs/lifts are not places (no name), yet they get icons.
    const placeIds = new Set(rt.places.map((p) => p.id));
    expect(nodes.some((n) => (n.kind === 'stairs' || n.kind === 'elevator') && !placeIds.has(n.id))).toBe(true);
    expect(floorFacilityNodes(rt.graph, null, null)).toEqual([]);
    expect(floorFacilityNodes(null, 'bldg_A', 4)).toEqual([]);
  });
});

describe('mapped buildings and the floor picker', () => {
  it('highlights only buildings with indoor places, with their outlines and centres', async () => {
    const rt = await fixtureRuntime();
    const mapped = mappedBuildings(rt.places, rt.buildings);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped.every((b) => rt.places.some((p) => p.buildingId === b.id))).toBe(true);
    expect(mappedBuildings(rt.places.filter((p) => p.buildingId === null), rt.buildings)).toEqual([]);
    const shapes = buildingShapes(rt.graph, mapped.map((b) => b.id), 'bldg_A');
    expect(shapes.features.map((f) => f.properties?.['id'])).toEqual(mapped.map((b) => b.id).filter((id) => rt.graph!.buildings.has(id)));
    expect(shapes.features.find((f) => f.properties?.['id'] === 'bldg_A')?.properties?.['current']).toBe(true);
    expect(buildingShapes(rt.graph, ['nope']).features).toEqual([]);
    const center = buildingCenter(rt.graph, 'bldg_A', rt.places)!;
    const ring = rt.graph!.buildings.get('bldg_A')!.geometry.coordinates[0]!;
    const lngs = ring.map((p) => p[0]!), lats = ring.map((p) => p[1]!);
    expect(center.lng).toBeGreaterThanOrEqual(Math.min(...lngs)); expect(center.lng).toBeLessThanOrEqual(Math.max(...lngs));
    expect(center.lat).toBeGreaterThanOrEqual(Math.min(...lats)); expect(center.lat).toBeLessThanOrEqual(Math.max(...lats));
    // No outline: the average of the building's places; nothing at all: null.
    expect(buildingCenter(null, 'b', [place('x', 1, 2), place('y', 3, 4)])).toEqual({ lng: 2, lat: 3 });
    expect(buildingCenter(null, 'b', [])).toBeNull();
  });
  it('enters a one-floor building at once and asks for a floor otherwise', () => {
    expect(floorChoice({ levels: [2] })).toEqual({ kind: 'enter', level: 2 });
    expect(floorChoice({ levels: [3, -1, 1, 1] })).toEqual({ kind: 'pick', levels: [-1, 1, 3] });
    expect(floorChoice({ levels: [] })).toEqual({ kind: 'none' });
    expect(levelChip(-1)).toBe('B1'); expect(levelChip(7)).toBe('7F');
  });
});

describe('half-screen search sheet', () => {
  it('opens at about half the map screen, expands to ~88% and closes when dragged all the way down', () => {
    const h = searchSheetHeights(800);
    expect(h.default).toBe(Math.round(800 * SEARCH_SHEET_DEFAULT_SHARE));
    expect(h.expanded).toBe(Math.round(800 * SEARCH_SHEET_EXPANDED_SHARE));
    expect(h.default / 800).toBeGreaterThanOrEqual(0.48); expect(h.default / 800).toBeLessThanOrEqual(0.55);
    expect(h.collapsed).toBe(0);
    expect(releaseSnap('default', 380, 0, h)).toBe('collapsed');
    expect(releaseSnap('default', -300, 0, h)).toBe('expanded');
    expect(releaseSnap('expanded', 20, 0, h)).toBe('expanded');
    expect(releaseSnap('default', 10, 1.2, h)).toBe('collapsed');
  });
});

describe('building name labels on the outdoor map', () => {
  const REAL_DIR = fileURLToPath(new URL('../../../data/campuses/hanyang-seoul', import.meta.url));
  const placedNames = (markers: MapMarker[], v: MapView) => declutter(markers, v, { stage: zoomStage(v.zoom, false) }).filter((p) => p.marker.kind === 'building');

  it('makes one label per named building at its centre, with its size, and marks only mapped buildings as tappable', async () => {
    const rt = await fixtureRuntime();
    const labels = buildingLabels(rt.graph, ['bldg_A']);
    expect(labels.length).toBe([...rt.graph!.buildings.values()].filter((b) => b.properties.name?.trim()).length);
    for (const label of labels) {
      expect(label.name).toBe(rt.graph!.buildings.get(label.id)!.properties.name.trim());
      expect(label).toMatchObject(buildingCenter(rt.graph, label.id, [])!);
      expect(label.spanM).toBeGreaterThan(0);
      expect(label.tappable).toBe(label.id === 'bldg_A');
    }
    expect(buildingLabels(null)).toEqual([]);
    expect(buildingLabels(rt.graph).every((l) => !l.tappable)).toBe(true);
  });
  it('flags the building whose floor picker is open for a thicker border', async () => {
    const rt = await fixtureRuntime();
    const ids = [...rt.graph!.buildings.keys()];
    const shapes = buildingShapes(rt.graph, ids, null, ids[0]!);
    expect(shapes.features.map((f) => f.properties?.['picked'])).toEqual(ids.map((id) => id === ids[0]));
    expect(buildingShapes(rt.graph, ids).features.every((f) => f.properties?.['picked'] === false)).toBe(true);
  });
  it('sizes a label for one or two lines and never wider than the cap', () => {
    const short = buildingLabelSize('본관'), long = buildingLabelSize('정몽구 미래자동차연구센터'), huge = buildingLabelSize('아주아주아주아주 긴 건물 이름이 계속 이어집니다 정말로');
    expect(short.height).toBeLessThan(long.height); expect(huge.height).toBe(long.height);
    expect(long.width).toBeLessThanOrEqual(huge.width); expect(short.width).toBeLessThan(long.width);
  });
  it('is label-only: no icon box, hidden below the minimum zoom, and below higher-priority markers', () => {
    const b = (id: string, lng: number, lat: number, name: string, spanM = 80): MapMarker => ({ id, kind: 'building', lng, lat, name, priority: PRIORITY.building, tone: 'normal', place: null, spanM, tappable: true });
    const near = view(17), mk = [b('b1', near.lng, near.lat, '본관')];
    expect(PRIORITY.building).toBeGreaterThan(PRIORITY.place);
    expect(placedNames(mk, near).map((p) => p.marker.id)).toEqual(['b1']);
    expect(placedNames(mk, view(BUILDING_LABEL_MIN_ZOOM - 0.1))).toEqual([]);
    // Too small on screen: the 20 m shed has no name at zoom 16 but gets one when zoomed in.
    const shed = [b('s', near.lng, near.lat, '창고', 20)];
    expect(20 / metersPerPixel(near.lat, 16)).toBeLessThan(BUILDING_LABEL_MIN_SPAN_PX);
    expect(placedNames(shed, view(16))).toEqual([]); expect(placedNames(shed, view(18)).length).toBe(1);
    // A selected place keeps its spot; the building name that would sit on it is dropped.
    const sel: CampusPlace = { ...place('sel', near.lng, near.lat, 'door', '선택'), buildingId: null };
    const markers = buildMarkers({ places: [sel], selected: sel, buildings: [{ id: 'b1', name: '본관', lng: near.lng, lat: near.lat, spanM: 80, tappable: false }] });
    expect(declutter(markers, near, { stage: 'labels' }).map((p) => p.marker.id)).toEqual(['sel']);
    // Icons filling the cap do not stop building names.
    const many = Array.from({ length: 80 }, (_, i) => place(`p${i}`, near.lng + (i % 10) * 0.0004, near.lat + Math.floor(i / 10) * 0.0004 + 0.002, 'door'));
    const withNames = buildMarkers({ places: many, buildings: [{ id: 'b1', name: '본관', lng: near.lng, lat: near.lat, spanM: 80, tappable: false }] });
    expect(declutter(withNames, near, { stage: 'icons' }).some((p) => p.marker.id === 'b1')).toBe(true);
  });
  it('never overlaps names (any rotation, any zoom) and thins them out when zoomed out (real campus data)', async () => {
    const rt = loadBundledCampus(await bundleOf(REAL_DIR, 'hanyang-seoul'));
    const labels = buildingLabels(rt.graph, rt.buildings.map((x) => x.id));
    expect(labels.length).toBeGreaterThan(5);
    const markers = buildMarkers({ places: [], buildings: labels });
    const center = rt.info.center;
    const counts: number[] = [];
    for (const zoom of [15.4, 15.5, 16, 16.5, 17, 18, 19]) {
      for (const bearing of [0, 37, 90, 200]) {
        const v: MapView = { lng: center.lng, lat: center.lat, zoom, bearing, width: 390, height: 700 };
        const placed = placedNames(markers, v);
        expect(placed.length).toBeLessThanOrEqual(MAX_BUILDING_LABELS);
        const boxes = placed.map((p) => { const { width, height } = buildingLabelSize(p.marker.name!); return { l: p.x - width / 2, r: p.x + width / 2, t: p.y - height / 2, b: p.y + height / 2 }; });
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, c = boxes[j]!;
          expect(a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b, `${placed[i]!.marker.name} / ${placed[j]!.marker.name} @${zoom}°${bearing}`).toBe(false);
        }
        if (bearing === 0) counts.push(placed.length);
      }
    }
    // [15.4, 15.5, 16, 16.5, ...]: nothing below the minimum zoom; zoomed out shows fewer (large buildings first) than zoomed in.
    expect(counts[0]).toBe(0);
    expect(counts[1]).toBeGreaterThan(0); expect(counts[1]!).toBeLessThan(labels.length); expect(counts[1]!).toBeLessThan(counts[3]!);
  });
});
