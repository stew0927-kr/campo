// 기존 지점·문 정보 입력 (SurveySession.annotate): the values go onto the point, into the survey's changeset and
// attachment, and the editor's side gets them by applying that changeset.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyChangeset, createIdGen, validateSurvey, type EditState } from '@campo/core';
import { pointTitle } from '../src/model/scope.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, fixture } from './helpers.ts';

let base: EditState;
beforeAll(async () => {
  ({ state: base } = await fixture());
});
const newSession = () => new SurveySession({ campus: CAMPUS, base, ids: createIdGen(5), startedAt: AT });
const DOOR = 'n_B_2_201door';
const FULL = { hours: '09:00-18:00', closed_period: '2026-11-15~2026-11-30', access_condition: '관리실 문의' };

describe('SurveySession.annotate', () => {
  it('writes the values onto the existing door, keeps them with the note and photos, and exports them', () => {
    const s = newSession();
    const done = s.annotate(DOOR, { access: { ...FULL, hours: ' 09:00-18:00 ' }, note: '주말에는 잠겨 있음', photos: 2 }, AT);
    if ('error' in done) throw new Error(done.error);
    expect(done.paths).toEqual([`photos/${DOOR}-1.jpg`, `photos/${DOOR}-2.jpg`]);
    expect(s.state.nodes[DOOR]!.props).toMatchObject({ ...FULL, rev: base.nodes[DOOR]!.props.rev + 1 });
    expect(s.attachments[DOOR]).toEqual({ recorded_at: AT, ...FULL, note: '주말에는 잠겨 있음', photos: done.paths });
    expect(s.anchorId).toBeNull(); // the walk did not move
    expect(s.counts()).toMatchObject({ nodes: 0, edges: 0, photos: 2 });

    const survey = s.toSurvey('b-2f', AT);
    expect(validateSurvey(JSON.parse(JSON.stringify(survey)))).toEqual({ ok: true, errors: [] });
    expect(survey.changeset!.changes).toHaveLength(1);
    expect(survey.changeset!.changes[0]).toMatchObject({ op: 'modify', base_rev: base.nodes[DOOR]!.props.rev, feature: { id: DOOR, properties: FULL } });
    // the editor applies the same changeset to the same campus
    expect(applyChangeset(survey.changeset!).apply(base).nodes[DOOR]!.props).toMatchObject(FULL);
  });

  it('an emptied value is removed from the point and from the record; untouched values stay', () => {
    const s = newSession();
    s.annotate(DOOR, { access: FULL }, AT);
    const done = s.annotate(DOOR, { access: { ...FULL, closed_period: '' } }, AT);
    expect('error' in done).toBe(false);
    const props = s.state.nodes[DOOR]!.props;
    expect('closed_period' in props).toBe(false);
    expect(props).toMatchObject({ hours: FULL.hours, access_condition: FULL.access_condition });
    expect('closed_period' in s.attachments[DOOR]!).toBe(false);
  });

  it('a note or a photo alone changes no map data', () => {
    const s = newSession();
    expect(s.annotate(DOOR, { access: {}, note: '손잡이 고장' }, AT)).toEqual({ paths: [] });
    expect(s.state).toBe(base);
    expect(s.attachments[DOOR]).toEqual({ recorded_at: AT, note: '손잡이 고장' });
    expect(s.toSurvey('b-2f', AT).changeset).toBeUndefined();
  });

  it('refuses when nothing changed or the point is gone, and leaves the walk alone', () => {
    const s = newSession();
    expect(s.annotate(DOOR, { access: { hours: '' }, note: '' }, AT)).toEqual({ error: '바뀐 내용이 없습니다.' });
    expect(s.annotate('n_none', { access: FULL }, AT)).toEqual({ error: '지점을 찾을 수 없습니다.' });
    expect(s.canUndo).toBe(false);
  });

  it('one 되돌리기 takes the values, the note and the photo entries back; the entrance of the fixture keeps its own hours', () => {
    const s = newSession();
    expect(base.nodes['n_A_1_main']!.props.hours).toBe('07:00-22:00');
    s.annotate('n_A_1_main', { access: { hours: '24/7' }, note: '상시', photos: 1 }, AT);
    expect(s.state.nodes['n_A_1_main']!.props.hours).toBe('24/7');
    expect(s.undo()).toBe(true);
    expect(s.state).toEqual(base);
    expect(s.attachments).toEqual({});
    expect(s.canUndo).toBe(false);
  });

  it('survives saving on the phone and continuing', () => {
    const s = newSession();
    s.annotate(DOOR, { access: FULL, note: '메모' }, AT);
    const restored = SurveySession.restore({ campus: CAMPUS, base, ids: createIdGen(6) }, JSON.parse(JSON.stringify(s.snapshot())));
    if ('error' in restored) throw new Error(restored.error);
    expect(restored.session.state.nodes[DOOR]!.props).toMatchObject(FULL);
    expect(restored.session.attachments[DOOR]).toMatchObject({ ...FULL, note: '메모' });
  });
});

describe('pointTitle', () => {
  it('names the point the way the surveyor sees it', () => {
    expect(pointTitle(base.nodes['n_A_4_408door']!)).toBe('문 408호');
    expect(pointTitle(base.nodes['n_A_1_main']!)).toBe('출입구 A동 1층 출입구');
    expect(pointTitle(base.nodes['n_B_2_hall']!)).toBe('복도 지점');
  });
});
