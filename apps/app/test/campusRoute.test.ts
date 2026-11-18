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

    // campus-basic에는 정문에서 408호까지 계단 없는 길이 있다(휠체어는 계단으로 대체하지 않는다).
    expect(state.status).toBe('ok');
    expect(state.message).toBeNull();
    const route = state.route!;
    expect(route.profile).toBe('wheelchair');
    expect(route.usedProfile).toBe('wheelchair');
    expect(route.fallbackMessage).toBeNull();
    expect(route.stairsCount).toBe(0);
    expect(route.steps.some((step) => step.kind === 'stairs')).toBe(false);
    expect(route.nodeIds[route.nodeIds.length - 1]).toBe(ROOM_408);
  });

  describe('지도에서 고른 점은 그 이동 방식이 지날 수 있는 구간에만 붙는다', () => {
    // 계단(e_steps)이 고른 점에서 약 4.4 m, 보도(e_foot)가 약 6.7 m. 두 길은 n2–n4 보도로 이어져 n5로 간다.
    const PICK = { kind: 'point' as const, lat: 37.00004, lng: 127.00025 };
    const TO = { kind: 'node' as const, nodeId: 'n5' };
    const campusWithStairs = (withFootway: boolean) =>
      loadBundledCampus(
        bundleFrom(META, [
          nodeFeature('n1', 127.0, 37.0),
          nodeFeature('n2', 127.0005, 37.0),
          nodeFeature('n4', 127.0005, 37.0001),
          nodeFeature('n5', 127.001, 37.0001),
          edgeFeature('e_steps', 'n1', 'n2', [[127.0, 37.0], [127.0005, 37.0]], { highway: 'steps', step_free: false }),
          edgeFeature('e_link', 'n2', 'n4', [[127.0005, 37.0], [127.0005, 37.0001]]),
          edgeFeature('e_foot2', 'n4', 'n5', [[127.0005, 37.0001], [127.001, 37.0001]]),
          ...(withFootway
            ? [nodeFeature('n3', 127.0, 37.0001), edgeFeature('e_foot', 'n3', 'n4', [[127.0, 37.0001], [127.0005, 37.0001]])]
            : []),
        ]),
      );

    it('가장 가까운 것이 계단이어도 휠체어는 조금 더 먼 보도에 붙고, 가장 빠른 길은 계단에 붙는다', () => {
      const runtime = campusWithStairs(true);

      const wheelchair = computeRoute(runtime, { from: PICK, to: TO, mode: 'wheelchair' });
      expect(wheelchair.status).toBe('ok');
      expect(wheelchair.route!.snappedStartM).toBeGreaterThan(6);
      expect(wheelchair.route!.snappedStartM).toBeLessThan(7.5);
      expect(wheelchair.route!.stairsCount).toBe(0);

      const shortest = computeRoute(runtime, { from: PICK, to: TO, mode: 'shortest' });
      expect(shortest.status).toBe('ok');
      expect(shortest.route!.snappedStartM).toBeLessThan(5);
      expect(shortest.route!.snappedStartM).toBeLessThan(wheelchair.route!.snappedStartM!);
    });

    it('근처에 계단밖에 없으면 휠체어는 not-found와 한국어 설명', () => {
      // 걷는 구간이 계단 하나뿐인 캠퍼스: 휠체어가 붙을 수 있는 구간이 없다.
      const runtime = loadBundledCampus(
        bundleFrom(META, [
          nodeFeature('n1', 127.0, 37.0),
          nodeFeature('n2', 127.0005, 37.0),
          edgeFeature('e_steps', 'n1', 'n2', [[127.0, 37.0], [127.0005, 37.0]], { highway: 'steps', step_free: false }),
        ]),
      );
      const state = computeRoute(runtime, { from: PICK, to: { kind: 'node', nodeId: 'n2' }, mode: 'wheelchair' });
      expect(state.status).toBe('not-found');
      expect(state.route).toBeNull();
      expect(state.message).toBe('걷는 길이 없는 위치입니다. 캠퍼스 안에서 다시 골라 주세요.');

      // 같은 자리를 가장 빠른 길로 고르면 계단에 붙어 경로가 나온다.
      expect(computeRoute(runtime, { from: PICK, to: { kind: 'node', nodeId: 'n2' }, mode: 'shortest' }).status).toBe('ok');
    });

    it('계단보다 먼 보도도 그 보도를 지날 수 있으면 휠체어 경로의 출발로 쓴다(계단만 있는 쪽은 버린다)', () => {
      const runtime = campusWithStairs(false);
      // e_foot가 없으면 휠체어가 붙을 곳은 e_link(n2–n4, 고른 점에서 약 22 m)다.
      const state = computeRoute(runtime, { from: PICK, to: TO, mode: 'wheelchair' });
      expect(state.status).toBe('ok');
      expect(state.route!.snappedStartM).toBeGreaterThan(20);
      expect(state.route!.stairsCount).toBe(0);
    });
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

  it('평지를 사이에 둔 두 길: 평지를 건너 이어지고, 선은 구멍을 돌아가는 평지 위 꺾임을 지난다', async () => {
    const m = 1 / 111_320;
    const kx = m / Math.cos((37 * Math.PI) / 180);
    const at = (x: number, y: number): [number, number] => [127 + x * kx, 37 + y * m];
    const square = (x0: number, y0: number, x1: number, y1: number, ccw: boolean) => {
      const r = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)];
      const ring = ccw ? r : r.reverse();
      return [...ring, ring[0]!];
    };
    const plaza = {
      type: 'Feature', id: 'plaza_p',
      geometry: { type: 'Polygon', coordinates: [square(0, 0, 30, 20, true), square(10, 5, 20, 15, false)] },
      properties: { kind: 'plaza', source: 'estimate', rev: 1, name: '분수 광장' },
    };
    const runtime = await loadBundledCampus(bundleFrom(META, [
      plaza,
      nodeFeature('a1', ...at(-20, 10)), nodeFeature('a2', ...at(0, 10)), edgeFeature('e_a', 'a1', 'a2', [at(-20, 10), at(0, 10)]),
      nodeFeature('b1', ...at(30, 10)), nodeFeature('b2', ...at(50, 10)), edgeFeature('e_b', 'b1', 'b2', [at(30, 10), at(50, 10)]),
    ]));
    const state = computeRoute(runtime, { from: { kind: 'node', nodeId: 'a1' }, to: { kind: 'node', nodeId: 'b2' } });
    expect(state.status).toBe('ok');
    expect(state.route!.nodeIds).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(state.route!.distanceM).toBeCloseTo(40 + 2 * Math.hypot(10, 5) + 10, 0);
    // a1, a2, 구멍의 두 모서리(10, 5)·(20, 5), b1, b2
    expect(state.route!.polyline).toHaveLength(6);
    expect(state.route!.steps.some((s) => s.text.startsWith("평지 '분수 광장'을 가로질러"))).toBe(true);
  });
});
