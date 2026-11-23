// 안내도 자동 매핑: 서버가 준 GeoJSON 초안을 코어 동작 하나로 바꿔 실측 상태에 넣는다(되돌리기 한 번).
import { beforeAll, describe, expect, it } from 'vitest';
import { checkInvariants, createHistory, createIdGen, type EditState, type LoadedCampus } from '@campo/core';
import { FLOORPLAN_SOURCE, NO_POINTS, applyFloorplanDraft, type FloorplanApplyInput } from '../src/floorplan/draft.ts';
import { SurveySession } from '../src/survey/session.ts';
import { assembleFloorplan } from '../../../supabase/functions/floorplan-to-geojson/src/assemble.ts';
import { AT, CAMPUS, campusErrors, ctx, fixture } from './helpers.ts';

let start: EditState;
let loaded: LoadedCampus;
beforeAll(async () => {
  ({ state: start, loaded } = await fixture());
});

// A동 3층: 복도 n_A_3_hall(127.0006, 37.0005) 등이 이미 있다. 초안은 그보다 남쪽(37.00035 줄)에 놓는다.
const SCOPE = { kind: 'building', buildingId: 'bldg_A', level: 3 } as const;

type Props = Record<string, unknown>;
const point = (id: string, coord: [number, number], props: Props) => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: coord },
  // 서버 값(building_id/level)은 일부러 틀리게 둔다: 앱이 지금 층 값으로 덮어써야 한다.
  properties: { kind: 'node', source: 'school-floorplan-ai', rev: 1, needs_check: true, building_id: 'bldg_wrong', level: 9, ...props },
});
const line = (id: string, from: string, to: string, coords: [number, number][]) => ({
  type: 'Feature', id, geometry: { type: 'LineString', coordinates: coords },
  properties: { kind: 'edge', source: 'school-floorplan-ai', rev: 1, needs_check: true, highway: 'corridor', edge_type: 'indoor', from, to, bidirectional: true, step_free: null },
});

const C1: [number, number] = [127.00045, 37.00035];
const C2: [number, number] = [127.00055, 37.00035];
const C3: [number, number] = [127.00065, 37.00035];
const DOOR: [number, number] = [127.00055, 37.00038];
const STAIR: [number, number] = [127.00045, 37.00032];

/** 복도 3점 + 문 1 + 계단 1, 선 3개(복도 2 + 문 연결 1). 계단은 선이 없다. */
function smallDraft(extraLines: unknown[] = []) {
  return {
    type: 'FeatureCollection',
    features: [
      point('fp-n-1', C1, { node_type: 'corridor' }),
      point('fp-n-2', C2, { node_type: 'corridor' }),
      point('fp-n-3', C3, { node_type: 'corridor' }),
      point('fp-n-4', DOOR, { node_type: 'door', room_ref: '301', space_name: '3학년 1반', name: '3학년 1반', door_role: 'front', bogus: 'x' }),
      point('fp-n-5', STAIR, { node_type: 'stair_landing' }),
      line('fp-e-1', 'fp-n-1', 'fp-n-2', [C1, C2]),
      line('fp-e-2', 'fp-n-2', 'fp-n-3', [C2, C3]),
      line('fp-e-3', 'fp-n-4', 'fp-n-2', [DOOR, C2]),
      ...extraLines,
    ],
  };
}

const input = (geojson: unknown, state = start, seed = 7): FloorplanApplyInput => ({ state, ctx: ctx(seed), scope: SCOPE, geojson, source: FLOORPLAN_SOURCE });

function applied(geojson: unknown, state = start) {
  const r = applyFloorplanDraft(input(geojson, state));
  if ('error' in r) throw new Error(r.error);
  return r;
}
function run(state: EditState, r: ReturnType<typeof applied>): EditState {
  if (!r.action) return state;
  expect(r.action.disabled(state)).toBe(false);
  const after = createHistory(state).perform(r.action);
  expect(checkInvariants(after)).toEqual([]);
  expect(campusErrors(loaded, after)).toEqual([]);
  return after;
}
const added = (before: EditState, after: EditState, kind: 'nodes' | 'edges') => Object.keys(after[kind]).filter((id) => !(id in before[kind]));

describe('applyFloorplanDraft', () => {
  it('turns a small draft into one runnable action with the expected points and lines', () => {
    const r = applied(smallDraft());
    expect(r.counts).toEqual({ nodes: 5, edges: 3, reused: 0, skippedEdges: 0 });
    const after = run(start, r);
    const nodes = added(start, after, 'nodes').map((id) => after.nodes[id]!);
    const edges = added(start, after, 'edges').map((id) => after.edges[id]!);
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(3);
    for (const n of nodes) {
      expect(n.props).toMatchObject({ building_id: 'bldg_A', level: 3, needs_check: true, source: FLOORPLAN_SOURCE, rev: 1 });
      // 앱의 id 규칙(코어 nodeIdPrefix)
      expect(n.id).toMatch(new RegExp(`^n_A_3_${n.props.node_type}_[0-9a-z]{6}$`));
    }
    const door = nodes.find((n) => n.props.node_type === 'door')!;
    expect(door.props).toMatchObject({ room_ref: '301', space_name: '3학년 1반', name: '3학년 1반', door_role: 'front' });
    expect(door.props).not.toHaveProperty('bogus');
    for (const e of edges) {
      expect(e.props).toMatchObject({ highway: 'corridor', edge_type: 'indoor', bidirectional: true, step_free: null, needs_check: true, level_from: 3, level_to: 3 });
      expect(e.id).toMatch(/^e_A_3_[0-9a-z]{6}$/);
    }
    expect(r.notices[0]).toBe('지점 5개, 복도 3개를 지도에 놓았습니다.');
  });

  it('applying the same draft again makes no new points: they are reused', () => {
    const once = run(start, applied(smallDraft()));
    const again = applied(smallDraft(), once);
    expect(again.counts.nodes).toBe(0);
    expect(again.counts.reused).toBe(5);
    expect(again.counts.edges).toBe(0);
    // 이미 이어진 선 3개는 다시 긋지 않는다
    expect(again.counts.skippedEdges).toBe(3);
    expect(again.action).toBeNull();
    expect(again.notices).toContain('이미 있던 지점 5개는 그대로 썼습니다.');
  });

  it('skips a line to the point itself and a line to a missing point, and the action still runs', () => {
    const r = applied(smallDraft([
      line('fp-e-9', 'fp-n-1', 'fp-n-1', [C1, C1]),
      line('fp-e-10', 'fp-n-3', 'fp-n-404', [C3, C3]),
    ]));
    expect(r.counts.skippedEdges).toBe(2);
    expect(r.counts.edges).toBe(3);
    expect(r.notices).toContain('연결하지 못한 선 2개는 편집기에서 이어 주세요.');
    run(start, r);
  });

  it('refuses input that is not a FeatureCollection or has no points', () => {
    expect(applyFloorplanDraft(input(null))).toEqual({ error: NO_POINTS });
    expect(applyFloorplanDraft(input({ type: 'Feature' }))).toEqual({ error: NO_POINTS });
    expect(applyFloorplanDraft(input({ type: 'FeatureCollection', features: [line('fp-e-1', 'a', 'b', [C1, C2])] }))).toEqual({ error: NO_POINTS });
    expect(applyFloorplanDraft(input({ type: 'FeatureCollection', features: [point('x', [500, 500], { node_type: 'door' })] }))).toEqual({ error: NO_POINTS });
  });

  it('gives restrooms wheelchair "unknown" and drops one without a gender', () => {
    const r = applied({
      type: 'FeatureCollection',
      features: [
        point('c', C1, { node_type: 'corridor' }),
        point('wc', [127.00045, 37.00038], { node_type: 'restroom', restroom_gender: 'female' }),
        point('wc2', [127.00065, 37.00038], { node_type: 'restroom' }),
        line('l', 'wc', 'c', [C1, C1]),
      ],
    });
    const after = run(start, r);
    const wc = added(start, after, 'nodes').map((id) => after.nodes[id]!).find((n) => n.props.node_type === 'restroom')!;
    expect(wc.props).toMatchObject({ restroom_gender: 'female', wheelchair: 'unknown' });
    expect(r.counts.nodes).toBe(2);
    expect(r.notices).toContain('읽지 못한 항목 1개는 빼고 놓았습니다.');
  });

  it('puts an elevator on the shaft already in the building, and names a new one after the building', () => {
    // n_A_elevA_L3(127.0008, 37.0005)에서 약 2.7 m 떨어진 자리 → A_elevA 승강로 자리에 맞추고, 3층엔 이미 정차 지점이 있으니 재사용한다.
    const near = applied({ type: 'FeatureCollection', features: [point('ev', [127.00083, 37.0005], { node_type: 'elevator_stop', elevator_id: 'EV1' })] });
    expect(near.counts).toMatchObject({ nodes: 0, reused: 1 });
    // 멀리 떨어진 엘리베이터는 새 승강로 A_elevB
    const far = applied({ type: 'FeatureCollection', features: [point('ev', [127.00045, 37.00062], { node_type: 'elevator_stop', elevator_id: 'EV1' })] });
    const after = run(start, far);
    const stop = added(start, after, 'nodes').map((id) => after.nodes[id]!)[0]!;
    expect(stop.props.elevator_id).toBe('A_elevB');
  });

  it('refuses a floor the building does not have', () => {
    const r = applyFloorplanDraft({ ...input(smallDraft()), scope: { kind: 'building', buildingId: 'bldg_A', level: 7 } });
    expect(r).toHaveProperty('error');
  });

  it('takes what the server assembles from a draft map as it is', () => {
    const ring = start.buildings.A!.polygon[0]!;
    const { geojson } = assembleFloorplan({
      nodes: [
        { kind: 'corridor', x: 100, y: 900 }, { kind: 'corridor', x: 500, y: 900 }, { kind: 'corridor', x: 900, y: 900 },
        { kind: 'door', x: 480, y: 850, room_ref: '305', door_role: 'front' },
        { kind: 'restroom', x: 880, y: 950, restroom_gender: 'male' },
      ],
      corridors: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
      warnings: [],
    }, { buildingId: 'bldg_A', level: 3, rotationDeg: 0, buildingPolygon: ring });
    const r = applied(geojson);
    expect(r.counts).toMatchObject({ nodes: 5, edges: 4, skippedEdges: 0 });
    run(start, r);
  });
});

describe('반영 후 되돌리기', () => {
  it('one 되돌리기 takes the whole mapping back', () => {
    const session = new SurveySession({ campus: CAMPUS, base: start, ids: createIdGen(5), startedAt: AT });
    const r = applyFloorplanDraft({ state: session.state, ctx: session.ctx, scope: SCOPE, geojson: smallDraft(), source: FLOORPLAN_SOURCE });
    if ('error' in r) throw new Error(r.error);
    const result = session.edit(r.action!, SCOPE, null);
    expect(result).not.toHaveProperty('error');
    expect(session.scope).toEqual(SCOPE);
    expect(Object.keys(session.state.nodes).length).toBe(Object.keys(start.nodes).length + 5);
    expect(session.undo()).toBe(true);
    expect(session.state).toEqual(start);
    expect(session.canUndo).toBe(false);
  });
});
