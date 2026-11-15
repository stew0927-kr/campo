// 선택 mode (hit tests, box, delete, edge edits, building edits, escalator times), 호실 연속 입력 and 강의실 자동 연결.
import { beforeAll, describe, expect, it } from 'vitest';
import { checkInvariants, createHistory, validateSurvey, type EditState, type LoadedCampus, type Position } from '@campo/core';
import { projection, toScreen, type View } from '../src/map/project.ts';
import { OUTDOOR, type Scope } from '../src/model/scope.ts';
import { advanceRun, corridorAt, planStrip, stripPreview } from '../src/survey/rooms.ts';
import {
  EMPTY_SELECTION, hitAt, inBox, planBuildingEdit, planDeleteSelection, planEdgeEdits, rideDirections, selectionFloor, timingStats, toggled,
} from '../src/survey/selection.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, SOURCE, campusErrors, ctx, fixture } from './helpers.ts';
import { createIdGen } from '@campo/core';

let start: EditState;
let loaded: LoadedCampus;
beforeAll(async () => {
  ({ state: start, loaded } = await fixture());
});

const A1: Scope = { kind: 'building', buildingId: 'bldg_A', level: 1 };
const CENTER: Position = [127.0006, 37.0005];
const proj = projection(CENTER);
const size = { width: 400, height: 800 };
const view: View = { x: 0, y: 0, scale: 10, rotation: 40 };
const frame = (scope: Scope, state = start) => ({ state, scope, projection: proj, view, size });
const px = (p: Position) => toScreen(view, size, proj.toXY(p));
const valid = (after: EditState) => {
  expect(checkInvariants(after)).toEqual([]);
  expect(campusErrors(loaded, after)).toEqual([]);
};

describe('선택: what a finger picks on a turned map', () => {
  it('a point first, then an edge, then the building outline', () => {
    expect(hitAt(frame(A1), px([127.0006, 37.0005]))).toEqual({ kind: 'node', id: 'n_A_1_hall' });
    // Halfway along hall → elevator stop, away from both ends.
    expect(hitAt(frame(A1), px([127.0007, 37.0005]))).toEqual({ kind: 'edge', id: 'e_A_1_hall__A_elevA_L1' });
    expect(hitAt(frame(A1), px([127.00085, 37.00065]))).toEqual({ kind: 'building', id: 'bldg_A' });
    expect(hitAt(frame(A1), px([127.0002, 37.0009]))).toBeNull();
  });

  it('a box picks the points inside and the edges with both ends inside', () => {
    // A box of screen pixels around the hall, big enough to hold the escalator foot 6.7 m away but not the entrance (~21 m).
    const [hx, hy] = px([127.0006, 37.0005]);
    const picked = inBox(frame(A1), { x0: hx - 90, y0: hy - 90, x1: hx + 90, y1: hy + 90 });
    expect(picked.nodes).toContain('n_A_1_hall');
    expect(picked.nodes).toContain('n_A_1_esc');
    expect(picked.nodes).not.toContain('n_A_1_main');
    expect(picked.edges).toContain('e_A_1_hall__A_1_esc');
    for (const id of picked.edges) {
      const e = start.edges[id]!;
      expect(picked.nodes).toContain(e.props.from);
      expect(picked.nodes).toContain(e.props.to);
    }
  });

  it('taps toggle points and edges; a building is picked alone; empty ground clears', () => {
    let s = toggled(EMPTY_SELECTION, { kind: 'node', id: 'n1' });
    s = toggled(s, { kind: 'edge', id: 'e1' });
    expect(s).toEqual({ nodes: ['n1'], edges: ['e1'], building: null });
    expect(toggled(s, { kind: 'node', id: 'n1' }).nodes).toEqual([]);
    expect(toggled(s, { kind: 'building', id: 'b' })).toEqual({ nodes: [], edges: [], building: 'b' });
    expect(toggled(s, null)).toEqual(EMPTY_SELECTION);
  });
});

describe('선택: the action bar', () => {
  it('deletes the picked edges and points in one action', () => {
    const action = planDeleteSelection(start, ctx(), { nodes: ['n_A_1_esc'], edges: ['e_A_1_hall__A_elevA_L1'], building: null });
    if ('error' in action) throw new Error(action.error);
    const after = createHistory(start).perform(action);
    expect(after.nodes['n_A_1_esc']).toBeUndefined();
    expect(after.edges['e_A_1_hall__A_elevA_L1']).toBeUndefined();
    expect(after.edges['e_A_1_esc__A_2_esc_up']).toBeUndefined();
  });

  it('writes the step answer only on edges that are not steps, the belt direction only on escalators', () => {
    const action = planEdgeEdits(start, ['e_A_1_hall__A_1_esc', 'e_A_1_esc__A_2_esc_up', 'e_A_1_stair__A_2_stair'], { stepFree: true, conveying: 'reversible' });
    if ('error' in action) throw new Error(action.error);
    const after = createHistory(start).perform(action);
    expect(after.edges['e_A_1_hall__A_1_esc']!.props.step_free).toBe(true);
    expect(after.edges['e_A_1_stair__A_2_stair']!.props.step_free).toBe(false);
    expect(after.edges['e_A_1_esc__A_2_esc_up']!.props).toMatchObject({ conveying: 'reversible', bidirectional: true, step_free: false });
    expect(rideDirections(after, 'e_A_1_esc__A_2_esc_up')).toEqual(['forward', 'backward']);
  });

  it('완전 평지 / 단절선: each only where the schema allows it, turning one on turns the other off, and the result validates', () => {
    const ids = ['e_out_0001__out_0002', 'e_out_0002__out_0003', 'e_A_1_hall__A_1_esc']; // footway, outdoor steps, corridor
    const flat = planEdgeEdits(start, ids, { flatExact: true });
    if ('error' in flat) throw new Error(flat.error);
    const s1 = createHistory(start).perform(flat);
    expect(s1.edges['e_out_0001__out_0002']!.props.flat_exact).toBe(true);
    expect(s1.edges['e_A_1_hall__A_1_esc']!.props.flat_exact).toBe(true);
    expect(s1.edges['e_out_0002__out_0003']!.props.flat_exact).toBeUndefined(); // steps
    const brk = planEdgeEdits(s1, ids, { isBreakline: true });
    if ('error' in brk) throw new Error(brk.error);
    const s2 = createHistory(s1).perform(brk);
    expect(s2.edges['e_out_0001__out_0002']!.props).toMatchObject({ is_breakline: true });
    expect('flat_exact' in s2.edges['e_out_0001__out_0002']!.props).toBe(false);
    expect(s2.edges['e_out_0002__out_0003']!.props.is_breakline).toBe(true);
    expect(s2.edges['e_A_1_hall__A_1_esc']!.props).toMatchObject({ flat_exact: true }); // a corridor cannot be a break line
    expect(campusErrors(loaded, s2)).toEqual([]);
    expect('error' in planEdgeEdits(start, ids, { flatExact: true, isBreakline: true })).toBe(true);
    expect('error' in planEdgeEdits(start, ['e_out_0002__out_0003'], { flatExact: true })).toBe(true); // nothing it applies to
  });

  it('copies only from one floor of one building', () => {
    expect(selectionFloor(start, { nodes: ['n_A_1_hall'], edges: ['e_A_1_hall__A_1_esc'], building: null })).toMatchObject({ buildingId: 'bldg_A', level: 1 });
    expect('error' in selectionFloor(start, { nodes: ['n_A_1_hall', 'n_A_2_hall'], edges: [], building: null })).toBe(true);
    expect('error' in selectionFloor(start, { nodes: ['n_out_0002'], edges: [], building: null })).toBe(true);
  });

  it('edits a building: name, levels and code in one action, the new id is told', () => {
    const plan = planBuildingEdit(start, ctx(), 'bldg_C', { name: '새 이름', code: 'C2', levels: [5, 6] });
    if ('error' in plan) throw new Error(plan.error);
    const after = createHistory(start).perform(plan.action);
    expect(plan.newId).toBe('bldg_C2');
    expect(after.buildings['C2']!.props).toMatchObject({ name: '새 이름', levels: [5, 6] });
    valid(after);
    expect('error' in planBuildingEdit(start, ctx(), 'bldg_C', { name: 'x', code: '한글', levels: [5] })).toBe(true);
    expect('error' in planBuildingEdit(start, ctx(), 'bldg_C', { name: start.buildings['C']!.props.name, code: 'C', levels: [5] })).toBe(true);
  });
});

describe('에스컬레이터 스톱워치', () => {
  it('times add up in the session, are undone one by one, and are exported as field measurements', () => {
    const s = new SurveySession({ campus: CAMPUS, base: start, ids: createIdGen(3), startedAt: AT });
    expect('error' in s.addTiming('e_A_1_esc__A_2_esc_up', 0.4, 'forward', AT)).toBe(true);
    s.addTiming('e_A_1_esc__A_2_esc_up', 20, 'forward', AT);
    s.addTiming('e_A_1_esc__A_2_esc_up', 22, 'forward', AT);
    expect(s.timingsOf('e_A_1_esc__A_2_esc_up')).toHaveLength(2);
    const stats = timingStats(s.state, 'e_A_1_esc__A_2_esc_up', 'forward', s.timings)!;
    expect(stats).toMatchObject({ n: 2, taken: 2, medianSec: 21 });
    expect(stats.estimateSec).toBeCloseTo((3 * stats.priorSec + 2 * 21) / 5, 0);
    expect(s.undo()).toBe(true);
    expect(s.timings).toHaveLength(1);

    const survey = s.toSurvey('a-esc', AT);
    expect(survey.timings).toEqual([{ target: 'edge:e_A_1_esc__A_2_esc_up', duration_sec: 20, measured_at: AT }]);
    expect(validateSurvey(survey)).toMatchObject({ ok: true });
    expect(s.counts().timings).toBe(1);
    // Kept on the phone and read back.
    const back = SurveySession.restore({ campus: CAMPUS, base: start, ids: createIdGen(4) }, s.snapshot());
    if ('error' in back) throw new Error(back.error);
    expect(back.session.timings).toHaveLength(1);
  });
});

describe('호실 연속 입력 · 강의실 자동 연결', () => {
  it('the run counts up by its step and remembers the last front door', () => {
    expect(advanceRun({ nextRef: '301', step: 2, lastRef: null }, '301')).toEqual({ nextRef: '303', step: 2, lastRef: '301' });
    expect(advanceRun({ nextRef: 'B09', step: 1, lastRef: null }, 'B09').nextRef).toBe('B10');
  });

  it('picks the corridor under the crosshair and lays a row of doors along it in one action', () => {
    const corridor = corridorAt(start, A1, [127.0005, 37.00046]);
    expect(corridor?.id).toBe('e_A_1_main__A_1_hall');
    expect(corridorAt(start, OUTDOOR, [127.0005, 37.00046])).toBeUndefined();
    const input = {
      corridorEdgeIds: [corridor!.id], first: [127.00046, 37.00045] as Position, last: [127.00056, 37.0005] as Position,
      count: 3, startRef: '101', refStep: 1, doorsPerRoom: 1 as const, source: SOURCE,
    };
    const preview = stripPreview(start, input);
    if ('error' in preview) throw new Error(preview.error);
    expect(preview.map((d) => d.room_ref)).toEqual(['101', '102', '103']);
    const plan = planStrip(start, ctx(), input);
    if ('error' in plan) throw new Error(plan.error);
    const after = createHistory(start).perform(plan.action);
    const doors = Object.values(after.nodes).filter((n) => !(n.id in start.nodes) && n.props.node_type === 'door');
    expect(doors.map((n) => n.props.room_ref).sort()).toEqual(['101', '102', '103']);
    valid(after);
    expect('error' in planStrip(start, ctx(), { ...input, startRef: '' })).toBe(true);
  });
});
