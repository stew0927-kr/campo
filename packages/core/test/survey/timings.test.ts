// Stopwatch times in a survey file (survey.schema.json timings): built, checked, and read as field observations.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildSurvey, observationProblem, surveyDanglingIds, surveyObservations, timingEdgeId, validateSurvey, type EditState, type SurveyTiming,
} from '../../src/index.ts';
import { fixtureState } from '../edit/helpers.ts';

let start: EditState;
beforeAll(async () => {
  start = await fixtureState();
});

const AT = '2026-11-14T10:00:00+09:00';
const ride: SurveyTiming = { target: 'edge:e_A_1_esc__A_2_esc_up', duration_sec: 21.4, measured_at: AT };
const build = (timings: SurveyTiming[]) => buildSurvey({
  base: start, current: start, campus: 'fixture-basic', id: 'sv-20261114-esc', surveyedAt: AT, attachments: {}, vertical: [], timings, summary: '시간',
});

describe('survey timings', () => {
  it('keeps the times of edges that exist and leaves the field out when there are none', () => {
    const survey = build([ride, { ...ride, target: 'edge:e_gone' }, { ...ride, direction: 'backward' }]);
    expect(survey.timings).toEqual([ride, { ...ride, direction: 'backward' }]);
    expect(validateSurvey(survey).ok).toBe(true);
    expect('timings' in build([])).toBe(false);
  });

  it('the schema refuses a time that is not positive, an unknown target kind and unknown fields', () => {
    const bad = (t: object) => validateSurvey({ ...build([ride]), timings: [t] }).ok;
    expect(bad({ ...ride, duration_sec: 0 })).toBe(false);
    expect(bad({ ...ride, target: 'elevator:A_elevA' })).toBe(false);
    expect(bad({ ...ride, source: 'field' })).toBe(false);
    expect(bad({ ...ride, device: 'x' })).toBe(false);
  });

  it('becomes observation lines with source field, and dangling targets are reported', () => {
    const [o] = surveyObservations(build([ride]));
    expect(o).toEqual({ ...ride, source: 'field' });
    expect(observationProblem(o)).toBeUndefined();
    expect(timingEdgeId(ride)).toBe('e_A_1_esc__A_2_esc_up');
    expect(surveyDanglingIds(start, { ...build([]), timings: [{ ...ride, target: 'edge:e_gone' }] })).toEqual(['e_gone']);
  });
});
