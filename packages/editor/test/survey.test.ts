// 현장 기록 불러오기: reading the exported file, the import as one undoable Plan, and what the 상세 정보 tab shows.
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  addEdge, addNode, buildSurvey, compose, createHistory, formatSurvey, moveNode, setProps,
  type EditState, type Survey, type SurveyAttachment, type VerticalMeasurement,
} from '@campo/core';
import { runPlan } from '../src/model/plan.ts';
import { loadSurveys, photoUrl, planSurveyImport, readSurveyFile, surveyNotes, toBase64, withSurvey } from '../src/model/survey.ts';
import { fixtureSession } from './fixture.ts';

const AT = '2026-11-14T10:00:00+09:00';
const SOURCE = 'field-survey-2031-01';
const CAMPUS = 'fixture-basic';
const base: EditState = fixtureSession().history.current();

/** What the survey app would export after recording one outdoor point joined to n_out_0004, with a photo and a height. */
function exported(extra: Partial<{ attachments: Record<string, SurveyAttachment>; vertical: VerticalMeasurement[] }> = {}): Survey {
  const walk = createHistory(base);
  walk.perform(compose([
    addNode({ id: 'n_out_sv01', coord: [126.9997, 37.0006], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: SOURCE } }),
    addEdge({ id: 'e_out_sv01', props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'n_out_0004', to: 'n_out_sv01', bidirectional: true, step_free: true, source: SOURCE } }),
  ], '갈림길 기록'));
  return buildSurvey({
    base, current: walk.current(), campus: CAMPUS, id: 'sv-20261114-outdoor-1000', surveyedAt: AT, summary: '현장 조사',
    attachments: extra.attachments ?? { n_out_sv01: { recorded_at: AT, photos: ['photos/n_out_sv01-1.jpg'], heading_mag_deg: 87.5, pressure_hpa: 1012.3 } },
    vertical: extra.vertical ?? [{ edge_id: 'e_out_sv01', pressure_start_hpa: 1012.5, pressure_end_hpa: 1012.3, height_m: 1.67, grade_pct: 4.2, method: 'barometer', measured_at: AT }],
  });
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const zipOf = (survey: Survey, files: Record<string, Uint8Array> = { 'photos/n_out_sv01-1.jpg': JPEG }) =>
  zipSync({ 'survey.json': strToU8(formatSurvey(survey)), ...files });

describe('readSurveyFile', () => {
  it('reads the zip: the survey, its text as stored, and the photos it lists by file name', () => {
    const survey = exported();
    const read = readSurveyFile(zipOf(survey));
    if ('error' in read) throw new Error(read.error);
    expect(read.survey).toEqual(survey);
    expect(read.text).toBe(formatSurvey(survey));
    expect(read.photos).toEqual({ 'n_out_sv01-1.jpg': JPEG });
    expect(read.missingPhotos).toEqual([]);
  });

  it('reads a bare survey.json and names the photos that did not come with it', () => {
    const read = readSurveyFile(strToU8(formatSurvey(exported())));
    if ('error' in read) throw new Error(read.error);
    expect(read.photos).toEqual({});
    expect(read.missingPhotos).toEqual(['photos/n_out_sv01-1.jpg']);
  });

  it('takes nothing from the zip but survey.json and the photos the survey lists', () => {
    const read = readSurveyFile(zipOf(exported(), {
      'photos/n_out_sv01-1.jpg': JPEG, 'photos/unlisted.jpg': JPEG, '../outside.txt': strToU8('x'), 'campus.json': strToU8('{}'),
    }));
    if ('error' in read) throw new Error(read.error);
    expect(Object.keys(read.photos)).toEqual(['n_out_sv01-1.jpg']);
  });

  it('refuses a zip without survey.json, text that is not JSON, and a survey that breaks the schema (with every reason)', () => {
    expect(readSurveyFile(zipSync({ 'other.json': strToU8('{}') }))).toMatchObject({ error: expect.stringContaining('survey.json') });
    expect(readSurveyFile(strToU8('not json'))).toMatchObject({ error: expect.stringContaining('JSON') });
    const broken = readSurveyFile(strToU8(JSON.stringify({ ...exported(), device_id: 'x', version: 2 })));
    if (!('error' in broken)) throw new Error('expected a refusal');
    expect(broken.reasons.length).toBeGreaterThanOrEqual(2);
    expect(readSurveyFile(new Uint8Array([0x50, 0x4b, 1, 2, 3]))).toMatchObject({ error: expect.stringContaining('열 수 없습니다') });
  });
});

describe('planSurveyImport', () => {
  it('is one history entry: the survey\'s Features appear, and one undo takes them all back', () => {
    const session = fixtureSession();
    const planned = planSurveyImport(session.history.current(), CAMPUS, exported());
    if ('error' in planned) throw new Error(planned.error);
    expect(planned.lines[0]).toContain('추가 2개, 변경 0개, 삭제 0개');
    expect(planned.lines[1]).toContain('사진 1장, 높이 측정 1건');
    expect(runPlan(session.history, planned.plan!)).toMatchObject({ ok: true });
    const after = session.history.current();
    expect(after.nodes['n_out_sv01']?.props.source).toBe(SOURCE);
    expect(after.edges['e_out_sv01']?.props.to).toBe('n_out_sv01');
    expect(session.history.undo()).toEqual(base);
  });

  it('importing the same survey again changes nothing and says it is already there', () => {
    const session = fixtureSession();
    const first = planSurveyImport(session.history.current(), CAMPUS, exported());
    if ('error' in first) throw new Error(first.error);
    runPlan(session.history, first.plan!);
    const again = planSurveyImport(session.history.current(), CAMPUS, exported());
    expect(again).toMatchObject({ plan: null, lines: [expect.stringContaining('이미'), expect.any(String)] });
  });

  it('a survey of photos only has no plan', () => {
    const photosOnly: Survey = { ...exported(), attachments: { n_out_0004: { recorded_at: AT, photos: ['photos/n_out_0004-1.jpg'] } }, vertical: [] };
    delete photosOnly.changeset;
    expect(planSurveyImport(base, CAMPUS, photosOnly)).toMatchObject({ plan: null, lines: [expect.stringContaining('바꾸지 않습니다'), expect.stringContaining('사진 1장')] });
  });

  it('collects every conflict when the map changed since the survey, and applies nothing', () => {
    // On site: an existing point was renamed and another was moved. Meanwhile the editor changed both.
    const walk = createHistory(base);
    walk.perform(setProps(['n_out_0002'], { name: '현장 이름' }));
    walk.perform(moveNode('n_out_0004', [126.99981, 37.00081]));
    const survey = buildSurvey({ base, current: walk.current(), campus: CAMPUS, id: 'sv-20261114-x', surveyedAt: AT, attachments: {}, vertical: [], summary: 's' });
    const session = fixtureSession();
    session.history.perform(setProps(['n_out_0002'], { name: '편집기 이름' }));
    session.history.perform(setProps(['n_out_0004'], { needs_check: true }));
    const before = session.history.current();
    const refused = planSurveyImport(before, CAMPUS, survey);
    if (!('error' in refused)) throw new Error('expected a refusal');
    expect(refused.error).toContain('아무것도 바꾸지 않았습니다');
    expect(refused.reasons.filter((r) => r.startsWith('[rev_mismatch]')).map((r) => /n_out_000\d/.exec(r)?.[0]).sort()).toEqual(['n_out_0002', 'n_out_0004']);
    expect(session.history.current()).toBe(before);
  });

  it('refuses a survey of another campus', () => {
    expect(planSurveyImport(base, 'hanyang-seoul', exported())).toMatchObject({ error: expect.stringContaining('다른 캠퍼스') });
  });
});

describe('what the panel shows', () => {
  const first = exported();
  const second: Survey = {
    ...exported({ attachments: { n_out_sv01: { recorded_at: AT, note: '문이 잠겨 있음' } }, vertical: [] }),
    id: 'sv-20261120-outdoor-0900', surveyed_at: '2026-11-20T09:00:00+09:00',
  };

  it('notes of a Feature come from every survey that mentions it, oldest first; an edge shows its measured height', () => {
    const notes = surveyNotes([second, first], 'n_out_sv01');
    expect(notes.map((n) => n.surveyId)).toEqual([first.id, second.id]);
    expect(notes[0]!.attachment?.photos).toEqual(['photos/n_out_sv01-1.jpg']);
    expect(notes[1]!.attachment?.note).toBe('문이 잠겨 있음');
    expect(surveyNotes([first, second], 'e_out_sv01')).toEqual([{ surveyId: first.id, surveyedAt: AT, vertical: first.vertical[0] }]);
    expect(surveyNotes([first, second], 'n_out_0001')).toEqual([]);
  });

  it('photo URLs point at the dev server, and a newer copy of a survey replaces the older one', () => {
    expect(photoUrl(first.id, 'photos/n_out_sv01-1.jpg')).toBe('/api/surveys/sv-20261114-outdoor-1000/photos/n_out_sv01-1.jpg');
    expect(withSurvey([first, second], { ...first, surveyed_at: 'x' }).map((s) => s.id)).toEqual([second.id, first.id]);
  });

  it('loadSurveys keeps the open campus\'s surveys and leaves out the unreadable ones', () => {
    const files = [
      { id: first.id, text: formatSurvey(first) },
      { id: 'sv-20261101-other', text: formatSurvey({ ...first, id: 'sv-20261101-other', campus: 'other', changeset: { ...first.changeset!, campus: 'other' } }) },
      { id: 'sv-20261102-bad', text: '{ not json' },
      { id: 'sv-20261103-old', text: JSON.stringify({ ...first, version: 0 }) },
    ];
    expect(loadSurveys(files, CAMPUS)).toEqual([first]);
  });

  it('toBase64 matches Node for bytes of every value and for more than one chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(toBase64(new Uint8Array())).toBe('');
  });
});
