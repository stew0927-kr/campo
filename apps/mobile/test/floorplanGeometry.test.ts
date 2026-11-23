// floorplan-to-geojson의 순수 모듈(회전·정합·조립)을 앱 테스트에서 그대로 불러 검사한다.
import { describe, expect, it } from 'vitest';
import { ATTACH_MAX, SOURCE, assembleFloorplan } from '../../../supabase/functions/floorplan-to-geojson/src/assemble.ts';
import { M_PER_DEG, metreFrame, placer, rotateNormalized } from '../../../supabase/functions/floorplan-to-geojson/src/geometry.ts';
import type { DraftMap, RotationDeg } from '../../../supabase/functions/floorplan-to-geojson/src/types.ts';

describe('rotateNormalized (이미지 좌표계, y 아래, 시계방향)', () => {
  const cases: [RotationDeg, [number, number], [number, number], [number, number], [number, number]][] = [
    // 각도, (0,0), (500,500), (1000,1000), (1000,0)
    [0, [0, 0], [500, 500], [1000, 1000], [1000, 0]],
    [90, [1000, 0], [500, 500], [0, 1000], [1000, 1000]],
    [180, [1000, 1000], [500, 500], [0, 0], [0, 1000]],
    [270, [0, 1000], [500, 500], [1000, 0], [0, 0]],
  ];
  for (const [deg, a, centre, c, topRight] of cases) {
    it(`${deg}°`, () => {
      expect(rotateNormalized(0, 0, deg)).toEqual(a);
      expect(rotateNormalized(500, 500, deg)).toEqual(centre);
      expect(rotateNormalized(1000, 1000, deg)).toEqual(c);
      // 오른쪽 위 모서리는 90°에서 오른쪽 아래로 간다(시계방향)
      expect(rotateNormalized(1000, 0, deg)).toEqual(topRight);
    });
  }
});

// 위도 37°에서 가로·세로 각각 약 80 m인 정사각형 건물
const LAT = 37;
const SIDE_M = 80;
const dLon = SIDE_M / (M_PER_DEG * Math.cos((LAT * Math.PI) / 180));
const dLat = SIDE_M / M_PER_DEG;
const W = 127;
const S = LAT - dLat / 2;
const SQUARE = [[W, S], [W + dLon, S], [W + dLon, S + dLat], [W, S + dLat], [W, S]];
const near = (a: number, b: number, eps = 2e-7) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe('placer: 정사각 bbox에 맞추기', () => {
  it('maps the centre to the centre and the four corners to the four corners', () => {
    const place = placer(SQUARE, { rotationDeg: 0 });
    const [cx, cy] = place(500, 500);
    near(cx, W + dLon / 2);
    near(cy, S + dLat / 2);
    const nw = place(0, 0);
    const se = place(1000, 1000);
    near(nw[0], W); near(nw[1], S + dLat); // 왼쪽 위 = 북서
    near(se[0], W + dLon); near(se[1], S); // 오른쪽 아래 = 남동
    const ne = place(1000, 0);
    near(ne[0], W + dLon); near(ne[1], S + dLat);
  });

  it('keeps every point inside the bbox, for every rotation and a wide photo', () => {
    for (const rotationDeg of [0, 90, 180, 270] as RotationDeg[]) {
      for (const aspect of [1, 4 / 3, 0.5]) {
        const place = placer(SQUARE, { rotationDeg, aspect });
        for (let x = 0; x <= 1000; x += 125) for (let y = 0; y <= 1000; y += 125) {
          const [lon, lat] = place(x, y);
          expect(lon).toBeGreaterThanOrEqual(W - 1e-7);
          expect(lon).toBeLessThanOrEqual(W + dLon + 1e-7);
          expect(lat).toBeGreaterThanOrEqual(S - 1e-7);
          expect(lat).toBeLessThanOrEqual(S + dLat + 1e-7);
          expect(Number.isInteger(Math.round(lon * 1e7))).toBe(true);
        }
      }
    }
  });

  it('turns the photo: at 90° its top-left corner lands in the north-east', () => {
    const [lon, lat] = placer(SQUARE, { rotationDeg: 90 })(0, 0);
    near(lon, W + dLon);
    near(lat, S + dLat);
  });

  it('fits a long building without stretching: the square plan is centred along the long side', () => {
    const wide = [[W, S], [W + 2 * dLon, S], [W + 2 * dLon, S + dLat], [W, S + dLat], [W, S]];
    const f = metreFrame(wide);
    expect(f.east - f.west).toBeCloseTo(2 * SIDE_M, 0);
    const place = placer(wide, { rotationDeg: 0 });
    near(place(0, 500)[0], W + dLon / 2);
    near(place(1000, 500)[0], W + 1.5 * dLon);
  });
});

/** 스키마 0.2가 요구하는 키(nodeProperties / edgeProperties의 required). */
const NODE_REQUIRED = ['kind', 'source', 'rev', 'node_type', 'building_id', 'level'];
const EDGE_REQUIRED = ['kind', 'source', 'rev', 'highway', 'from', 'to', 'bidirectional', 'step_free'];
const NODE_KEYS = new Set([...NODE_REQUIRED, 'needs_check', 'name', 'ref', 'space_name', 'elevator_id', 'room_ref', 'door_role', 'restroom_gender', 'wheelchair', 'changing_table', 'hours', 'closed_period', 'access_condition', 'sync_group']);
const EDGE_KEYS = new Set([...EDGE_REQUIRED, 'needs_check', 'edge_type', 'level_from', 'level_to', 'building_from', 'building_to']);

describe('assembleFloorplan', () => {
  const draft: DraftMap = {
    nodes: [
      { kind: 'corridor', x: 100, y: 500 }, // 0
      { kind: 'corridor', x: 500, y: 500 }, // 1
      { kind: 'corridor', x: 900, y: 500 }, // 2
      { kind: 'door', x: 300, y: 450, room_ref: '301', space_name: '3학년 1반', door_role: 'front' }, // 3 → 0 또는 1에 200 떨어짐: 너무 멀다
      { kind: 'door', x: 480, y: 450, room_ref: '302', door_role: 'back' }, // 4 → 1
      { kind: 'stair_landing', x: 120, y: 560 }, // 5 → 0
      { kind: 'elevator_stop', x: 880, y: 540, elevator_id: 'EV1' }, // 6 → 2
      { kind: 'restroom', x: 520, y: 560, restroom_gender: 'female' }, // 7 → 1
    ],
    corridors: [{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 1 }, { from: 0, to: 0 }],
    warnings: ['302호 이름을 읽지 못했습니다.'],
  };
  const out = assembleFloorplan(draft, { buildingId: 'bldg_eng1', level: 3, rotationDeg: 90, buildingPolygon: SQUARE });
  const features = out.geojson.features;
  const points = features.filter((f) => f.geometry.type === 'Point');
  const lines = features.filter((f) => f.geometry.type === 'LineString');

  it('writes nodes with the required schema keys and nothing else', () => {
    expect(points).toHaveLength(8);
    for (const f of points) {
      for (const k of NODE_REQUIRED) expect(f.properties).toHaveProperty(k);
      for (const k of Object.keys(f.properties)) expect(NODE_KEYS.has(k)).toBe(true);
      expect(f.properties).toMatchObject({ kind: 'node', source: SOURCE, rev: 1, needs_check: true, building_id: 'bldg_eng1', level: 3 });
    }
    expect(points[3]!.properties).toMatchObject({ node_type: 'door', name: '3학년 1반', room_ref: '301', door_role: 'front' });
    expect(points[4]!.properties).toMatchObject({ name: '302호' });
    expect(points[6]!.properties).toMatchObject({ node_type: 'elevator_stop', elevator_id: 'EV1' });
    expect(points[7]!.properties).toMatchObject({ restroom_gender: 'female', wheelchair: 'unknown' });
    expect(points[0]!.properties).not.toHaveProperty('name');
  });

  it('writes edges with the required keys, corridors first, then attachments to the nearest corridor point', () => {
    for (const f of lines) {
      for (const k of EDGE_REQUIRED) expect(f.properties).toHaveProperty(k);
      for (const k of Object.keys(f.properties)) expect(EDGE_KEYS.has(k)).toBe(true);
      expect(f.properties).toMatchObject({ highway: 'corridor', edge_type: 'indoor', bidirectional: true, step_free: null, level_from: 3, level_to: 3, building_from: 'bldg_eng1', building_to: 'bldg_eng1' });
      expect(f.geometry.coordinates).toHaveLength(2);
    }
    const pairs = lines.map((f) => `${f.properties.from as string}>${f.properties.to as string}`);
    expect(pairs).toEqual(['fp-n-1>fp-n-2', 'fp-n-2>fp-n-3', 'fp-n-5>fp-n-2', 'fp-n-6>fp-n-1', 'fp-n-7>fp-n-3', 'fp-n-8>fp-n-2']);
  });

  it('counts what it wrote and what it left out', () => {
    expect(out.summary).toMatchObject({ nodeCount: 8, edgeCount: 6, doors: 2, restrooms: 1, stairs: 1, elevators: 1 });
    expect(out.summary.nodeCount).toBe(points.length);
    expect(out.summary.edgeCount).toBe(lines.length);
    // 중복 1 + 자기 자신 1 + 너무 먼 문 1
    expect(out.summary.skippedEdges).toBe(3);
    expect(out.summary.warnings[0]).toBe('302호 이름을 읽지 못했습니다.');
    expect(out.summary.warnings.some((w) => w.includes('너무 먼 지점 1개'))).toBe(true);
    expect(ATTACH_MAX).toBe(120);
  });

  it('chains corridor points to their nearest neighbour when no corridor list came', () => {
    const chained = assembleFloorplan({
      nodes: [{ kind: 'corridor', x: 500, y: 100 }, { kind: 'corridor', x: 100, y: 100 }, { kind: 'corridor', x: 300, y: 100 }, { kind: 'corridor', x: 900, y: 900 }],
      corridors: [], warnings: [],
    }, { buildingId: 'bldg_eng1', level: 3, rotationDeg: 0, buildingPolygon: SQUARE });
    const pairs = chained.geojson.features.filter((f) => f.geometry.type === 'LineString').map((f) => `${f.properties.from as string}>${f.properties.to as string}`);
    // 왼쪽 끝(100)부터 300 → 500. (900, 900)은 200보다 멀어 혼자 남는다.
    expect(pairs).toEqual(['fp-n-2>fp-n-3', 'fp-n-3>fp-n-1']);
  });
});
