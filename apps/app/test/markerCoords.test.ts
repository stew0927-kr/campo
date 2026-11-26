// 지도 Marker NaN 크래시 방어(핫픽스): 좌표 가드, 폴리라인 오염, 부적합 GPS fix, 소스 검사.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SensorFix } from '@campo/core';
import type { CampusRouteView, PhotoRow } from '../src/contracts.ts';
import { isValidLngLat, validLngLat, validLngLatTuple } from '../src/features/map/markerCoords.ts';
import { routeBounds, coordinateBounds } from '../src/features/map/model.ts';
import { createGpsMatcherSession } from '../src/matching/matcherSession.ts';
import { photoCatalogFromRows } from '../src/photos/catalog.ts';
import { stepMarkerGroups } from '../src/photos/roadviewModel.ts';
import { routeAlongPhotos } from '../src/photos/routeAlongPhotos.ts';
import { computeRoute } from '../src/route/routeEngine.ts';
import { fixtureRuntime } from './helpers.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('markerCoords', () => {
  const bad: unknown[] = [Number.NaN, Infinity, -Infinity, undefined, null, '127', {}];
  it('정상값만 통과한다', () => {
    expect(isValidLngLat(127.04, 37.55)).toBe(true);
    expect(isValidLngLat(180, 90)).toBe(true);
    expect(validLngLat(127.04, 37.55)).toEqual([127.04, 37.55]);
    expect(validLngLatTuple([127.04, 37.55])).toEqual([127.04, 37.55]);
  });
  it('NaN·Infinity·undefined·null·문자열·범위 밖은 모두 거부한다', () => {
    for (const v of bad) {
      expect(isValidLngLat(v, 37.5)).toBe(false);
      expect(isValidLngLat(127, v)).toBe(false);
      expect(validLngLat(v, 37.5)).toBeNull();
      expect(validLngLatTuple([127, v])).toBeNull();
    }
    expect(isValidLngLat(127, 91)).toBe(false);
    expect(isValidLngLat(181, 37)).toBe(false);
    expect(isValidLngLat(127, -90.1)).toBe(false);
    for (const v of [undefined, null, '127,37', [127], [], [Number.NaN, 37], [127, 91]]) expect(validLngLatTuple(v)).toBeNull();
  });
});

describe('bounds는 비유한 점을 버린다', () => {
  it('남는 점이 없으면 null, 있으면 유한한 범위', () => {
    expect(routeBounds([{ lng: Number.NaN, lat: 37 }])).toBeNull();
    const b = routeBounds([{ lng: Number.NaN, lat: 37 }, { lng: 127, lat: 37.5 }])!;
    expect(b.every(Number.isFinite)).toBe(true);
    expect(coordinateBounds([[127, Number.NaN]])).toBeNull();
  });
});

describe('routeAlongPhotos · stepMarkerGroups: 오염된 폴리라인', () => {
  it('비정상 좌표 지점은 lngLat이 null이거나 유한수이고, 그 지점만 그룹에서 빠진다', async () => {
    const rt = await fixtureRuntime();
    const route = computeRoute(rt, { from: { kind: 'node', nodeId: 'n_out_0001' }, to: { kind: 'node', nodeId: 'n_A_4_408door' }, mode: 'shortest' }).route!;
    const rows: PhotoRow[] = [];
    for (const id of new Set(route.nodeIds)) for (const h of [0, 90, 180, 270]) rows.push({ id: `${id}-${h}`, node_id: id, heading_deg: h, thumb_url: `https://x/t/${id}${h}`, full_url: `https://x/v/${id}${h}` });
    const catalog = photoCatalogFromRows(rows);
    const clean = routeAlongPhotos(route, catalog);
    const cleanGroups = stepMarkerGroups(clean, route.steps.length);
    expect(cleanGroups.length).toBeGreaterThan(1);

    const poisoned: CampusRouteView = { ...route, polyline: route.polyline.map((p, i) => (i === 2 ? { ...p, lat: Number.NaN } : i === 4 ? { lng: undefined as unknown as number, lat: p.lat } : i === 6 ? { ...p, lng: 999 } : p)) };
    const dirty = routeAlongPhotos(poisoned, catalog);
    for (const s of dirty) if (s.lngLat !== null) expect(isValidLngLat(s.lngLat[0], s.lngLat[1])).toBe(true);
    expect(dirty.some((s) => s.lngLat === null)).toBe(true);
    const groups = stepMarkerGroups(dirty, poisoned.steps.length);
    for (const g of groups) expect(isValidLngLat(g.lngLat[0], g.lngLat[1])).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(cleanGroups.length);
  });
});

describe('matcherSession: 부적합 fix', () => {
  const fix = (t: number, over: Partial<SensorFix> = {}): SensorFix => ({ tMs: 1_000_000 + t * 1000, lat: 37, lng: 127, accuracyM: 6, ...over });
  it('첫 fix가 정확도 초과·NaN 좌표이면 position은 null', async () => {
    const rt = await fixtureRuntime();
    expect(createGpsMatcherSession(rt.network).pushFix(fix(0, { accuracyM: 200 })).position).toBeNull();
    expect(createGpsMatcherSession(rt.network).pushFix(fix(0, { lat: Number.NaN })).position).toBeNull();
  });
  it('유효 fix 뒤 부적합 fix면 직전 유효 위치를 유지한다', async () => {
    const rt = await fixtureRuntime();
    const session = createGpsMatcherSession(rt.network);
    let snap = session.pushFix(fix(0));
    snap = session.pushFix(fix(1));
    const before = snap.position;
    expect(before).not.toBeNull();
    snap = session.pushFix(fix(2, { accuracyM: 200 }));
    expect(snap.position).not.toBeNull();
    expect(Number.isFinite(snap.position!.lat) && Number.isFinite(snap.position!.lng)).toBe(true);
    snap = session.pushFix(fix(3, { lat: Number.NaN, lng: Number.NaN }));
    expect([snap.position!.lat, snap.position!.lng]).toEqual([before!.lat, before!.lng]);
  });
});

describe('소스 검사: 가드 없는 Marker가 없다', () => {
  const MAP = source('../src/features/map/CampusMap.tsx');
  it('CampusMap은 SafeMarker만 쓴다', () => {
    expect(MAP).toMatch(/function SafeMarker/);
    expect(MAP.match(/<Marker[\s>]/g)).toBeNull();
    expect(MAP.match(/<RnMarker[\s>]/g)).toHaveLength(1);
    expect(MAP).not.toMatch(/lngLat=\{\[/);
    expect(MAP.match(/<SafeMarker /g)!.length).toBeGreaterThanOrEqual(9);
  });
  it('RoadviewMiniMapNative·MapScreen도 가드가 있다', () => {
    const mini = source('../src/features/map/RoadviewMiniMapNative.tsx');
    expect(mini).toMatch(/validLngLatTuple\(lngLat\) && <Marker/);
    expect(mini).not.toMatch(/lngLat=\{\[/);
    const screen = source('../src/features/map/MapScreen.tsx');
    expect(screen).toMatch(/isValidLngLat\(gps\.position\.lng, gps\.position\.lat\)/);
    expect(screen).toMatch(/safePosition\(/);
  });
});
