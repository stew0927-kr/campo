// 현장 기록 불러오기의 마그넷 (surveySnap.ts): point by point, what follows an existing way is left out and its records
// are shown on that way; what is new comes in as surveyed and its ends are put onto the ways they meet.
import { describe, expect, it } from 'vitest';
import {
  addEdge, addNode, buildSurvey, checkInvariants, compose, createHistory, metres,
  type Action, type EditState, type Position, type Survey, type SurveyAttachment, type VerticalMeasurement,
} from '@campo/core';
import { runPlan } from '../src/model/plan.ts';
import { planSurveyImport, surveyNotes } from '../src/model/survey.ts';
import { INDOOR_SNAP_M, OUTDOOR_SNAP_M, snapChangeset } from '../src/model/surveySnap.ts';
import { fixtureSession } from './fixture.ts';

const AT = '2026-11-14T10:00:00+09:00';
const SOURCE = 'field-survey-2026-11';
const CAMPUS = 'fixture-basic';
const base: EditState = fixtureSession().history.current();

const east = (m: number, lat: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
const move = ([x, y]: Position, eastM: number, northM: number): Position => [x + east(eastM, y), y + northM / 111_320];
/** e_out_0002__out_0004 runs north-west from n_out_0002; ACROSS is one metre to its south-west side (nothing else is there). */
const WAY = 'e_out_0002__out_0004';
const [A, B] = [base.nodes['n_out_0002']!.coord, base.nodes['n_out_0004']!.coord];
const MID: Position = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
const ACROSS: [number, number] = [-0.781, -0.625];
const beside = (at: Position, m: number): Position => move(at, ACROSS[0] * m, ACROSS[1] * m);

const outdoor = (id: string, coord: Position) => addNode({ id, coord, props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: SOURCE } });
const footway = (id: string, from: string, to: string) => addEdge({ id, props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: null, source: SOURCE } });

function survey(steps: Action[], extra: { attachments?: Record<string, SurveyAttachment>; vertical?: VerticalMeasurement[] } = {}, id = 'sv-20261114-walk'): Survey {
  const walk = createHistory(base);
  walk.perform(compose(steps, '걷기'));
  return buildSurvey({ base, current: walk.current(), campus: CAMPUS, id, surveyedAt: AT, summary: '현장 조사', attachments: extra.attachments ?? {}, vertical: extra.vertical ?? [] });
}
const height = (edge_id: string, m: number): VerticalMeasurement => ({ edge_id, pressure_start_hpa: 1012.5, pressure_end_hpa: 1012.3, height_m: m, grade_pct: 5, method: 'barometer', measured_at: AT });

function imported(sv: Survey, session = fixtureSession(7)) {
  const before = session.history.current();
  const planned = planSurveyImport(before, CAMPUS, sv, session.ctx);
  if ('error' in planned) throw new Error(`${planned.error} ${planned.reasons.join(' ')}`);
  if (planned.plan) {
    const r = runPlan(session.history, planned.plan);
    if (!r.ok) throw new Error(r.reason);
  }
  return { session, before, after: session.history.current(), planned };
}

describe('snapChangeset: 지점 단위 판단', () => {
  it('outdoors a point within 5m of an existing way follows it; one 6m away does not', () => {
    expect(OUTDOOR_SNAP_M).toBe(5);
    const sv = survey([outdoor('n_out_in', beside(MID, 4.5)), outdoor('n_out_away', beside(MID, 6))]);
    const snap = snapChangeset(base, sv.changeset!);
    expect(snap.droppedNodes).toEqual(['n_out_in']);
    expect(snap.changeset!.changes.map((c) => (c.op === 'create' ? c.feature.id : ''))).toEqual(['n_out_away']);
  });

  it('indoors the reach is 2.5m, and only ways of the same building and floor count', () => {
    expect(INDOOR_SNAP_M).toBe(2.5);
    // B동 2층's corridor runs west → east from n_B_2_bridge to n_B_2_hall; B동 1층 has no way under its west half.
    const [w, e] = [base.nodes['n_B_2_bridge']!.coord, base.nodes['n_B_2_hall']!.coord];
    const mid: Position = [(w[0] + e[0]) / 2, w[1]];
    const corridor = (id: string, coord: Position, level: number) => addNode({ id, coord, props: { kind: 'node', node_type: 'corridor', building_id: 'bldg_B', level, source: SOURCE } });
    const sv = survey([
      corridor('n_B_2_in', move(mid, 0, -2), 2), corridor('n_B_2_away', move(mid, 0, -3.2), 2), corridor('n_B_1_other', move(w, 1, -2), 1),
    ]);
    expect(snapChangeset(base, sv.changeset!).droppedNodes).toEqual(['n_B_2_in']);
  });

  it('a door is never taken for a point of the way, however close it stands', () => {
    const sv = survey([addNode({ id: 'n_B_2_door', coord: move(base.nodes['n_B_2_hall']!.coord, -3, 0.5), props: { kind: 'node', node_type: 'door', building_id: 'bldg_B', level: 2, source: SOURCE } })]);
    const snap = snapChangeset(base, sv.changeset!);
    expect(snap.droppedNodes).toEqual([]);
    expect(snap.changeset!.changes).toHaveLength(1);
  });

  it('a stretch between two ways whose middle follows none of them is a new way', () => {
    const sv = survey([footway('e_out_short', 'n_out_0004', 'n_out_0001')]); // both ends are on ways, 89m apart across open ground
    const snap = snapChangeset(base, sv.changeset!);
    expect(snap.droppedEdges).toEqual([]);
    expect(snap.changeset!.changes).toHaveLength(1);
  });
});

describe('planSurveyImport: 스냅과 병합', () => {
  it('a walk along an existing way changes nothing on the map; its photo and height are shown on that way', () => {
    const sv = survey(
      [outdoor('n_out_p1', beside(MID, 3)), footway('e_out_w1', 'n_out_0002', 'n_out_p1')],
      { attachments: { n_out_p1: { recorded_at: AT, photos: ['photos/n_out_p1-1.jpg'], heading_mag_deg: 310 } }, vertical: [height('e_out_w1', 1.6)] },
    );
    const { before, after, planned } = imported(sv);
    expect(planned.plan).toBeNull();
    expect(after).toBe(before);
    expect(planned.lines.join(' ')).toContain('기존 길을 따라 걸은 구간 1개와 지점 1개는 새로 만들지 않았습니다');
    expect(planned.lines.join(' ')).not.toContain('지도에 없는 Feature');

    const notes = surveyNotes([sv], WAY, after);
    expect(notes.map((n) => n.recordedAt).sort()).toEqual(['e_out_w1', 'n_out_p1']);
    expect(notes.find((n) => n.recordedAt === 'n_out_p1')!.attachment!.photos).toEqual(['photos/n_out_p1-1.jpg']);
    // walked from the way's start towards its end: the height keeps its sign and now names the way
    expect(notes.find((n) => n.recordedAt === 'e_out_w1')!.vertical).toMatchObject({ edge_id: WAY, height_m: 1.6, grade_pct: 5 });
    expect(surveyNotes([sv], 'e_out_0002__out_0003', after)).toEqual([]); // another way gets nothing
    expect(surveyNotes([sv], WAY)).toEqual([]); // without the map there is nothing to follow
  });

  it('a height measured walking against the way is turned round', () => {
    const [nearEnd, nearStart] = [beside([(MID[0] + B[0]) / 2, (MID[1] + B[1]) / 2], 2), beside([(MID[0] + A[0]) / 2, (MID[1] + A[1]) / 2], 2)];
    const sv = survey([outdoor('n_out_a', nearEnd), outdoor('n_out_b', nearStart), footway('e_out_back', 'n_out_a', 'n_out_b')], { vertical: [height('e_out_back', 2)] });
    const { after, planned } = imported(sv);
    expect(planned.plan).toBeNull();
    expect(surveyNotes([sv], WAY, after)[0]!.vertical).toMatchObject({ edge_id: WAY, height_m: -2, grade_pct: -5, pressure_start_hpa: 1012.3, pressure_end_hpa: 1012.5 });
  });

  it('where the walk leaves the way, the new stretch comes in as surveyed and its end is put onto the way: one undo', () => {
    const far = beside(MID, 30);
    const sv = survey(
      [outdoor('n_out_p1', beside(MID, 3)), footway('e_out_w1', 'n_out_0002', 'n_out_p1'), outdoor('n_out_p2', far), footway('e_out_w2', 'n_out_p1', 'n_out_p2')],
      { attachments: { n_out_p2: { recorded_at: AT, note: '쪽문' } }, vertical: [height('e_out_w1', 1.6), height('e_out_w2', -0.8)] },
    );
    const { session, before, after, planned } = imported(sv);
    expect(planned.lines.join(' ')).toContain('새 길의 끝 1곳을 기존 길 위에 이었습니다');
    expect(planned.lines.join(' ')).toContain('구간 1개와 지점 0개는 새로 만들지 않았습니다');
    // the followed stretch is not there; the new one is, exactly as surveyed at its far end
    expect(after.edges['e_out_w1']).toBeUndefined();
    expect(after.nodes['n_out_p2']!.coord).toEqual(far);
    expect(after.edges['e_out_w2']!.props).toMatchObject({ from: 'n_out_p1', to: 'n_out_p2', source: SOURCE });
    // p1 moved onto the old way, which now passes through it: no gap between the new stretch and the network
    const p1 = after.nodes['n_out_p1']!;
    expect(metres(p1.coord, MID)).toBeLessThan(0.1);
    const through = Object.values(after.edges).filter((e) => e.id !== 'e_out_w2' && [e.props.from, e.props.to].includes('n_out_p1'));
    expect(through.map((e) => [e.props.from, e.props.to].find((id) => id !== 'n_out_p1')).sort()).toEqual(['n_out_0002', 'n_out_0004']);
    expect(Object.keys(after.edges)).toHaveLength(Object.keys(before.edges).length + 2);
    expect(checkInvariants(after)).toEqual([]);
    // records: the new point and edge keep theirs; the followed stretch's height shows on the piece of the way it followed
    expect(surveyNotes([sv], 'n_out_p2', after)[0]!.attachment!.note).toBe('쪽문');
    expect(surveyNotes([sv], 'e_out_w2', after)[0]!.vertical!.height_m).toBe(-0.8);
    const piece = through.find((e) => [e.props.from, e.props.to].includes('n_out_0002'))!;
    expect(surveyNotes([sv], piece.id, after).map((n) => n.recordedAt)).toEqual(['e_out_w1']);

    expect(session.history.size()).toBe(1);
    expect(session.history.undo()).toEqual(before);
    session.history.redo();

    // the same file again (or a later export of the same walk) brings nothing more
    const again = planSurveyImport(session.history.current(), CAMPUS, sv, session.ctx);
    if ('error' in again) throw new Error(again.error);
    expect(again.plan).toBeNull();
  });

  it('a stretch with no way in reach is created whole, joined to the existing point it started from', () => {
    const sv = survey([outdoor('n_out_new', beside(B, 25)), footway('e_out_new', 'n_out_0004', 'n_out_new')]);
    const { before, after } = imported(sv);
    expect(after.nodes['n_out_new']!.coord).toEqual(beside(B, 25));
    expect(after.edges['e_out_new']!.props).toMatchObject({ from: 'n_out_0004', to: 'n_out_new' });
    expect(Object.keys(after.edges)).toHaveLength(Object.keys(before.edges).length + 1); // nothing was cut
  });
});
