// 안내도 자동 매핑의 계단·엘리베이터 자동 수직 연결: 같은 건물 다른 층의 같은 계단참·승강로와 층간 구간을 잇는다.
// 픽스처 A동(1~4층): 계단 n_A_{1..4}_stair(127.0007, 37.0004~37.00043, 층마다 약 1 m씩 북쪽), 승강로 A_elevA(127.0008, 37.0005).
import { beforeAll, describe, expect, it } from 'vitest';
import { checkInvariants, createHistory, createIdGen, type EditState, type LoadedCampus } from '@campo/core';
import { FLOORPLAN_SOURCE, VERTICAL_MATCH_M, applyFloorplanDraft } from '../src/floorplan/draft.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, campusErrors, ctx, fixture } from './helpers.ts';

let start: EditState;
let loaded: LoadedCampus;
beforeAll(async () => {
  ({ state: start, loaded } = await fixture());
});

const floor = (level: number) => ({ kind: 'building', buildingId: 'bldg_A', level } as const);

/** The fixture without some edges. */
function without(state: EditState, ids: string[]): EditState {
  for (const id of ids) expect(state.edges[id], id).toBeDefined();
  return { ...state, edges: Object.fromEntries(Object.entries(state.edges).filter(([id]) => !ids.includes(id))) };
}
const STAIR_EDGES = ['e_A_1_stair__A_2_stair', 'e_A_2_stair__A_3_stair', 'e_A_3_stair__A_4_stair'];

const point = (id: string, coord: [number, number], props: Record<string, unknown>) => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: coord },
  properties: { kind: 'node', source: FLOORPLAN_SOURCE, rev: 1, needs_check: true, building_id: 'bldg_A', level: 3, ...props },
});
const draftOf = (...features: unknown[]) => ({ type: 'FeatureCollection', features });

function applied(state: EditState, geojson: unknown, level = 3) {
  const r = applyFloorplanDraft({ state, ctx: ctx(11), scope: floor(level), geojson, source: FLOORPLAN_SOURCE });
  if ('error' in r) throw new Error(r.error);
  return r;
}
function run(state: EditState, r: ReturnType<typeof applied>): EditState {
  expect(r.action).not.toBeNull();
  expect(r.action!.disabled(state)).toBe(false);
  const after = createHistory(state).perform(r.action!);
  expect(checkInvariants(after)).toEqual([]);
  expect(campusErrors(loaded, after)).toEqual([]);
  return after;
}
const newEdges = (before: EditState, after: EditState) => Object.keys(after.edges).filter((id) => !(id in before.edges)).map((id) => after.edges[id]!);

// 3층 초안: 3층 계단 자리(→ n_A_3_stair 재사용)
const STAIR_DRAFT = draftOf(point('s', [127.0007, 37.00042], { node_type: 'stair_landing' }));

describe('계단 자동 연결', () => {
  it('joins the landing to the floors right below and above, from the lower floor up', () => {
    const base = without(start, STAIR_EDGES);
    const r = applied(base, STAIR_DRAFT);
    expect(r.counts.vertical).toEqual({ stairs: 2, elevators: 0 });
    expect(r.counts).toMatchObject({ nodes: 0, reused: 1 });
    expect(r.notices).toContain('다른 층 계단 2곳을 자동으로 연결했습니다.');
    const after = run(base, r);
    const edges = newEdges(base, after).map((e) => e.props);
    expect(edges).toHaveLength(2);
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'n_A_2_stair', to: 'n_A_3_stair', level_from: 2, level_to: 3 }),
      expect.objectContaining({ from: 'n_A_3_stair', to: 'n_A_4_stair', level_from: 3, level_to: 4 }),
    ]));
    for (const e of edges) {
      expect(e).toMatchObject({ highway: 'steps', edge_type: 'indoor', bidirectional: true, step_free: false, incline: 'up', source: FLOORPLAN_SOURCE, needs_check: true, rev: 1 });
      expect(e).not.toHaveProperty('building_from');
    }
  });

  it('draws nothing again for the same draft: action is null', () => {
    const base = without(start, STAIR_EDGES);
    const once = run(base, applied(base, STAIR_DRAFT));
    const again = applyFloorplanDraft({ state: once, ctx: ctx(12), scope: floor(3), geojson: STAIR_DRAFT, source: FLOORPLAN_SOURCE });
    if ('error' in again) throw new Error(again.error);
    expect(again.counts.vertical).toEqual({ stairs: 0, elevators: 0 });
    expect(again.action).toBeNull();
    expect(again.notices.join(' ')).not.toContain('자동으로 연결');
  });

  it('never skips a floor: the 1F landing about 2 m away is left alone', () => {
    const base = without(start, STAIR_EDGES);
    const after = run(base, applied(base, STAIR_DRAFT));
    for (const e of newEdges(base, after)) {
      expect([e.props.from, e.props.to]).not.toContain('n_A_1_stair');
    }
  });

  it(`does not join a landing farther than ${VERTICAL_MATCH_M} m`, () => {
    // 3층의 새 계단참: 다른 층 계단(127.0007)에서 약 9 m 서쪽
    const base = without(start, STAIR_EDGES);
    const r = applied(base, draftOf(point('s', [127.0006, 37.00042], { node_type: 'stair_landing' })));
    expect(r.counts).toMatchObject({ nodes: 1, vertical: { stairs: 0, elevators: 0 } });
    expect(r.notices.join(' ')).not.toContain('자동으로 연결');
    const after = run(base, r);
    expect(newEdges(base, after)).toEqual([]);
  });

  it('leaves a landing that already has its stairs as it is', () => {
    // 픽스처 그대로: 3층 계단은 2층·4층과 이미 이어져 있다
    const r = applyFloorplanDraft({ state: start, ctx: ctx(13), scope: floor(3), geojson: STAIR_DRAFT, source: FLOORPLAN_SOURCE });
    if ('error' in r) throw new Error(r.error);
    expect(r.counts.vertical.stairs).toBe(0);
    expect(r.action).toBeNull();
  });
});

describe('엘리베이터 자동 연결', () => {
  const EV_DRAFT = draftOf(point('ev', [127.0008, 37.0005], { node_type: 'elevator_stop', elevator_id: 'EV1' }));

  it('joins the shaft again where a ride edge is missing (no E11)', () => {
    const base = without(start, ['e_A_elevA_L2__A_elevA_L3']);
    expect(campusErrors(loaded, base).some((e) => e.includes('A_elevA'))).toBe(true);
    const r = applied(base, EV_DRAFT);
    expect(r.counts.vertical).toEqual({ stairs: 0, elevators: 1 });
    expect(r.notices).toContain('다른 층 엘리베이터 1곳을 자동으로 연결했습니다.');
    const after = run(base, r);
    const [edge] = newEdges(base, after);
    expect(edge!.props).toMatchObject({
      highway: 'elevator', edge_type: 'indoor', from: 'n_A_elevA_L2', to: 'n_A_elevA_L3', bidirectional: true, step_free: true,
      level_from: 2, level_to: 3, needs_check: true, source: FLOORPLAN_SOURCE,
    });
    expect(edge!.props).not.toHaveProperty('incline');
  });

  it('bridges a floor left out of the shaft: 3F joins 1F when 2F has no stop', () => {
    // 2층 정차 지점과 그 구간을 뺀다 → 1층과 3·4층이 갈라진다
    const cut = without(start, ['e_A_elevA_L1__A_elevA_L2', 'e_A_elevA_L2__A_elevA_L3', 'e_A_2_hall__A_elevA_L2']);
    const { n_A_elevA_L2: _gone, ...nodes } = cut.nodes;
    const base = { ...cut, nodes };
    const r = applied(base, EV_DRAFT);
    expect(r.counts.vertical.elevators).toBe(1);
    const after = run(base, r);
    expect(newEdges(base, after).map((e) => [e.props.from, e.props.to])).toEqual([['n_A_elevA_L1', 'n_A_elevA_L3']]);
  });

  it('draws nothing when the shaft is already joined', () => {
    const r = applyFloorplanDraft({ state: start, ctx: ctx(14), scope: floor(3), geojson: EV_DRAFT, source: FLOORPLAN_SOURCE });
    if ('error' in r) throw new Error(r.error);
    expect(r.counts.vertical.elevators).toBe(0);
    expect(r.action).toBeNull();
  });

  it('never joins another shaft: a new elevator far from A_elevA stays alone', () => {
    const r = applied(start, draftOf(point('ev', [127.0005, 37.00062], { node_type: 'elevator_stop', elevator_id: 'EV2' })));
    expect(r.counts).toMatchObject({ nodes: 1, vertical: { stairs: 0, elevators: 0 } });
  });
});

describe('되돌리기 한 번', () => {
  it('one undo takes the points, the corridors and the vertical edges back', () => {
    const base = without(start, [...STAIR_EDGES, 'e_A_elevA_L2__A_elevA_L3']);
    const session = new SurveySession({ campus: CAMPUS, base, ids: createIdGen(21), startedAt: AT });
    const r = applyFloorplanDraft({
      state: session.state, ctx: session.ctx, scope: floor(3), source: FLOORPLAN_SOURCE,
      geojson: draftOf(
        point('s', [127.0007, 37.00042], { node_type: 'stair_landing' }),
        point('ev', [127.0008, 37.0005], { node_type: 'elevator_stop', elevator_id: 'EV1' }),
        point('c', [127.00075, 37.00035], { node_type: 'corridor' }),
      ),
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.counts.vertical).toEqual({ stairs: 2, elevators: 1 });
    expect(r.notices).toContain('다른 층 계단 2곳 · 엘리베이터 1곳을 자동으로 연결했습니다.');
    expect(session.edit(r.action!, floor(3), null)).not.toHaveProperty('error');
    expect(Object.keys(session.state.edges).length).toBe(Object.keys(base.edges).length + 3);
    expect(session.undo()).toBe(true);
    expect(session.state).toEqual(base);
    expect(session.canUndo).toBe(false);
  });
});
