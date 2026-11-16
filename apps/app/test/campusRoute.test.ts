import { describe, expect, it } from 'vitest';
import { MAX_SNAP_DISTANCE_M, computeRoute } from '../src/route/routeEngine.ts';
import type { CampusRuntime } from '../src/campus/types.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { META, bundleFrom, edgeFeature, fixtureRuntime, nodeFeature } from './helpers.ts';

const GATE = 'n_out_0001';
const ROOM_408 = 'n_A_4_408door';

function coordinatesOf(runtime: CampusRuntime, nodeId: string): [number, number] {
  const node = runtime.graph.nodes.get(nodeId);
  if (node === undefined) throw new Error(`no node ${nodeId}`);
  return node.geometry.coordinates as [number, number];
}

describe('computeRoute', () => {
  it('지점에서 지점까지 가장 빠른 길을 찾고 시간·단계·층 이동을 준다', async () => {
    const runtime = await fixtureRuntime();
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'node', nodeId: ROOM_408 }, mode: 'shortest' });

    expect(state.status).toBe('ok');
    expect(state.message).toBeNull();
    const route = state.route!;
    expect(route.profile).toBe('shortest');
    expect(route.usedProfile).toBe('shortest');
    expect(route.timeSec).toBeGreaterThan(0);
    expect(route.distanceM).toBeGreaterThan(0);
    expect(route.steps.length).toBeGreaterThan(0);
    expect(route.steps.every((step) => step.text.length > 0)).toBe(true);
    expect(route.polyline.length).toBeGreaterThanOrEqual(2);
    expect(route.nodeIds[0]).toBe(GATE);
    expect(route.nodeIds[route.nodeIds.length - 1]).toBe(ROOM_408);

    // 4층 강의실까지 가는 길: 언덕 위 출입구로 들어서면 4층이다(실외 계단 → 4층 출입구).
    const portal = route.steps.find((step) => step.kind === 'portal');
    expect(portal?.toLevel).toBe(4);
    expect(route.steps.map((step) => step.text).join(' ')).toContain('4층');
  });

  it('건물 안에서 층을 옮기는 구간은 층 이동 목록으로 준다', async () => {
    const runtime = await fixtureRuntime();
    // A동 1층 출입구 → 4층 408호 문. 엘리베이터 우선 모드라 1층에서 4층으로 한 번에 간다.
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: 'n_A_1_main' }, to: { kind: 'node', nodeId: 'n_A_4_408door' }, mode: 'elevator_first' });

    expect(state.status).toBe('ok');
    const changes = state.route!.floorChanges;
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((change) => change.fromLevel === 1 && change.toLevel === 4)).toBe(true);
    expect(changes.find((change) => change.toLevel === 4)?.kind).toBe('elevator');
    expect(changes.find((change) => change.toLevel === 4)?.label).toBe('1층 → 4층 (엘리베이터)');
  });

  it('모드를 바꾸면 같은 출발·도착이라도 결과가 달라질 수 있고, 휠체어 경로에는 계단이 없다', async () => {
    const runtime = await fixtureRuntime();
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'node', nodeId: ROOM_408 }, mode: 'wheelchair' });

    if (state.status === 'ok') {
      expect(state.route!.stairsCount).toBe(0);
      expect(state.route!.profile).toBe('wheelchair');
    } else {
      // 계단 없이 갈 수 없는 곳이면 코어가 한국어 설명과 함께 not-found를 준다.
      expect(state.status).toBe('not-found');
      expect(state.message).toBeTruthy();
    }
  });

  it('지도에서 고른 임의의 점도 가장 가까운 길에 붙여 경로를 준다', async () => {
    const runtime = await fixtureRuntime();
    const [lng, lat] = coordinatesOf(runtime, GATE);
    const state = computeRoute(runtime, {
      from: { kind: 'point', lat: lat + 0.00002, lng: lng + 0.00002 },
      to: { kind: 'node', nodeId: ROOM_408 },
    });

    expect(state.status).toBe('ok');
    expect(state.route!.snappedStartM).toBeGreaterThan(0);
    expect(state.route!.snappedStartM).toBeLessThan(30);
  });

  it('없는 지점은 not-found와 한국어 설명', async () => {
    const runtime = await fixtureRuntime();
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: 'n_nowhere' }, to: { kind: 'node', nodeId: ROOM_408 } });
    expect(state.status).toBe('not-found');
    expect(state.route).toBeNull();
    expect(state.message).toContain('찾지 못했습니다');
  });

  it('출발이나 도착이 없으면 idle', async () => {
    const runtime = await fixtureRuntime();
    expect(computeRoute(runtime, null).status).toBe('idle');
    expect(computeRoute(runtime, { from: null, to: { kind: 'node', nodeId: GATE } }).status).toBe('idle');
  });

  it('캠퍼스 데이터를 아직 읽지 못했으면 error', () => {
    const state = computeRoute(null, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'node', nodeId: ROOM_408 } });
    expect(state.status).toBe('error');
    expect(state.message).toBeTruthy();
  });

  it('경사가 급한 구간은 경고 문장으로 돌려준다', () => {
    const runtime = loadBundledCampus(
      bundleFrom(META, [
        nodeFeature('n_low', 127.0, 37.0, { name: '아래' }),
        nodeFeature('n_high', 127.0, 37.002, { name: '위' }),
        edgeFeature('e_slope', 'n_low', 'n_high', [
          [127.0, 37.0],
          [127.0, 37.002],
        ], { grade_pct: 12, elev_sigma_m: 0.2 }),
      ]),
    );
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: 'n_low' }, to: { kind: 'node', nodeId: 'n_high' } });

    expect(state.status).toBe('ok');
    const [warning] = state.route!.slopeWarnings;
    expect(warning?.gradeClass).toBe('steep');
    expect(warning?.gradePct).toBe(12);
    expect(warning?.message).toContain('급경사');
    expect(warning?.message).toContain('오르막');
  });

  it('캠퍼스 밖(걷는 길에서 150 m 이상)을 고르면 not-found', async () => {
    const runtime = await fixtureRuntime();
    const [lng, lat] = coordinatesOf(runtime, GATE);
    expect(MAX_SNAP_DISTANCE_M).toBe(150);

    const far = computeRoute(runtime, { from: { kind: 'point', lat: lat + 1, lng: lng + 1 }, to: { kind: 'node', nodeId: ROOM_408 } });
    expect(far.status).toBe('not-found');
    expect(far.route).toBeNull();
    expect(far.message).toContain('걷는 길이 없는');

    const farDestination = computeRoute(runtime, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'point', lat: lat + 1, lng: lng + 1 } });
    expect(farDestination.status).toBe('not-found');

    // 길 가까이(수십 m)는 그대로 된다.
    const near = computeRoute(runtime, { from: { kind: 'point', lat: lat + 0.0002, lng }, to: { kind: 'node', nodeId: ROOM_408 } });
    expect(near.status).toBe('ok');
    expect(near.route!.snappedStartM).toBeLessThan(MAX_SNAP_DISTANCE_M);
  });

  it('유한하지 않거나 범위를 벗어난 좌표는 not-found와 한국어 설명', async () => {
    const runtime = await fixtureRuntime();
    const to = { kind: 'node', nodeId: ROOM_408 } as const;
    for (const point of [
      { lat: Number.NaN, lng: 127 },
      { lat: 37, lng: Number.NaN },
      { lat: Number.POSITIVE_INFINITY, lng: 127 },
      { lat: 91, lng: 127 },
      { lat: 37, lng: -181 },
    ]) {
      const state = computeRoute(runtime, { from: { kind: 'point', ...point }, to });
      expect(state.status, JSON.stringify(point)).toBe('not-found');
      expect(state.route).toBeNull();
      expect(state.message).toContain('좌표가 올바르지 않습니다');
    }
  });

  it('출발과 도착이 같아도 선은 항상 두 점 이상이다(한 점짜리 LineString 방지)', async () => {
    const runtime = await fixtureRuntime();
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'node', nodeId: GATE } });
    expect(state.status).toBe('ok');
    expect(state.route!.timeSec).toBe(0);
    expect(state.route!.nodeIds).toEqual([GATE]);
    expect(state.route!.polyline).toHaveLength(2);
    expect(state.route!.polyline[0]).toEqual(state.route!.polyline[1]);
  });

  it('길이 있는 경로의 선은 지점 수만큼이다(복사하지 않는다)', async () => {
    const runtime = await fixtureRuntime();
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: GATE }, to: { kind: 'node', nodeId: ROOM_408 } });
    expect(state.route!.polyline).toHaveLength(state.route!.nodeIds.length);
  });
});
