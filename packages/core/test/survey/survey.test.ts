// Field survey files (docs/mobile/SPEC-mobile.md): sensor arithmetic, buildSurvey, schema, and the way back through applyChangeset.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  applyChangeset,
  buildSurvey,
  circularMeanDeg,
  compose,
  createHistory,
  formatSurvey,
  gradePct,
  headingFromMagnetometer,
  heightFromPressure,
  surveyDanglingIds,
  surveyId,
  surveySource,
  validateSurvey,
  type EditState,
  type Survey,
  type SurveyAttachment,
  type VerticalMeasurement,
} from '../../src/index.ts';
import { fixtureState } from '../edit/helpers.ts';

let start: EditState;
beforeAll(async () => {
  start = await fixtureState();
});

const AT = '2026-11-14T10:00:00+09:00';
const SOURCE = surveySource(AT);

/** A new outdoor point joined to n_out_0004, the way the survey app records a junction. */
function surveyed() {
  const h = createHistory(start);
  h.perform(compose([
    addNode({ id: 'n_out_sv01', coord: [127.0002, 37.0002], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: SOURCE } }),
    addEdge({ id: 'e_out_sv01', props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'n_out_0004', to: 'n_out_sv01', bidirectional: true, step_free: true, source: SOURCE } }),
  ], '갈림길 기록'));
  return h;
}

const attachment: SurveyAttachment = { recorded_at: AT, photos: ['photos/n_out_sv01-1.jpg'], heading_mag_deg: 87.5, pressure_hpa: 1012.3 };
const measurement: VerticalMeasurement = {
  edge_id: 'e_out_sv01', pressure_start_hpa: 1012.3, pressure_end_hpa: 1011.8, height_m: 4.2, grade_pct: 8.1, method: 'barometer', measured_at: AT,
};

function build(h = surveyed(), attachments: Record<string, SurveyAttachment> = { n_out_sv01: attachment }, vertical = [measurement]): Survey {
  return buildSurvey({
    base: h.base(), current: h.current(), campus: 'fixture-basic', id: surveyId('20261114', 'A동 1층'), surveyedAt: AT, attachments, vertical, summary: '현장 조사',
  });
}

describe('sensor arithmetic', () => {
  it('pressure falling by about 0.12 hPa is one metre up, and the same readings swapped is the same height down', () => {
    expect(heightFromPressure(1013.25, 1013.13)).toBeCloseTo(1, 1);
    expect(heightFromPressure(1013.25, 1012.77)).toBeCloseTo(4, 1);
    expect(heightFromPressure(1012.77, 1013.25)).toBeCloseTo(-4, 1);
    expect(heightFromPressure(1000, 1000)).toBe(0);
  });

  it('the difference barely depends on the weather: the same step at 990 hPa is within a few percent', () => {
    const fair = heightFromPressure(1020, 1019.5);
    const storm = heightFromPressure(990, 989.5);
    expect(Math.abs(fair - storm) / fair).toBeLessThan(0.03);
  });

  it('grade is height over plan length in percent, and is not defined for a zero-length edge', () => {
    expect(gradePct(2, 25)).toBeCloseTo(8);
    expect(gradePct(-2, 25)).toBeCloseTo(-8);
    expect(gradePct(4, 0)).toBeUndefined();
  });

  it('heading: top edge to magnetic north is 0, east 90, south 180, west 270', () => {
    expect(headingFromMagnetometer(0, 30)).toBe(0);
    expect(headingFromMagnetometer(-30, 0)).toBeCloseTo(90);
    expect(headingFromMagnetometer(0, -30)).toBeCloseTo(180);
    expect(headingFromMagnetometer(30, 0)).toBeCloseTo(270);
    expect(headingFromMagnetometer(0, 0)).toBeUndefined();
  });

  it('the mean of headings goes around north instead of through south', () => {
    expect(circularMeanDeg([350, 10])).toBeCloseTo(0);
    expect(circularMeanDeg([80, 100])).toBeCloseTo(90);
    expect(circularMeanDeg([])).toBeUndefined();
    expect(circularMeanDeg([0, 180])).toBeUndefined();
  });
});

describe('buildSurvey', () => {
  it('ids: the slug is cleaned, and the source carries year and month', () => {
    expect(surveyId('20261114', 'A동 1층')).toBe('sv-20261114-a-1');
    expect(SOURCE).toBe('field-survey-2026-11');
    expect(() => surveySource('어제')).toThrow();
  });

  it('holds the map changes as a changeset with the same day and slug, and passes the schema', () => {
    const survey = build();
    expect(survey.changeset?.id).toBe('cs-20261114-a-1');
    expect(survey.changeset?.source).toBe('editor');
    expect(survey.changeset?.changes.map((c) => [c.op, c.op === 'delete' ? c.id : c.feature.id])).toEqual([['create', 'e_out_sv01'], ['create', 'n_out_sv01']]);
    expect(validateSurvey(survey)).toEqual({ ok: true, errors: [] });
    expect(JSON.parse(formatSurvey(survey))).toEqual(survey);
    expect(formatSurvey(survey).endsWith('}\n')).toBe(true);
  });

  it('applies to the campus it was made from as one undoable action, and nothing is left dangling', () => {
    const survey = build();
    const h = createHistory(start);
    const after = h.perform(applyChangeset(survey.changeset!));
    expect(after.nodes['n_out_sv01']?.props.source).toBe(SOURCE);
    expect(after.edges['e_out_sv01']?.props.from).toBe('n_out_0004');
    expect(surveyDanglingIds(after, survey)).toEqual([]);
    expect(surveyDanglingIds(start, survey)).toEqual(['e_out_sv01', 'n_out_sv01']);
    expect(h.undo()).toEqual(start);
  });

  it('drops attachments and measurements of Features that were undone, and leaves the changeset out when nothing changed', () => {
    const h = surveyed();
    h.undo();
    const survey = build(h, { n_out_sv01: attachment, n_out_0004: { recorded_at: AT, photos: ['photos/n_out_0004-1.jpg'] } });
    expect(survey.changeset).toBeUndefined();
    expect(Object.keys(survey.attachments)).toEqual(['n_out_0004']);
    expect(survey.vertical).toEqual([]);
    expect(validateSurvey(survey)).toEqual({ ok: true, errors: [] });
  });
});

describe('validateSurvey', () => {
  it('refuses unknown fields at every level (no device id, no track)', () => {
    const survey = build();
    expect(validateSurvey({ ...survey, device_id: 'x' }).ok).toBe(false);
    expect(validateSurvey({ ...survey, attachments: { n_out_sv01: { ...attachment, gps_track: [] } } }).ok).toBe(false);
    expect(validateSurvey({ ...survey, vertical: [{ ...measurement, user: 'x' }] }).ok).toBe(false);
  });

  it('refuses photo paths that leave the photos folder, headings of 360, and impossible pressures', () => {
    const survey = build();
    const withAttachment = (a: SurveyAttachment) => validateSurvey({ ...survey, attachments: { n_out_sv01: a } }).ok;
    expect(withAttachment({ recorded_at: AT, photos: ['photos/../../campus.json'] })).toBe(false);
    expect(withAttachment({ recorded_at: AT, photos: ['C:/x.jpg'] })).toBe(false);
    expect(withAttachment({ recorded_at: AT, heading_mag_deg: 360 })).toBe(false);
    expect(withAttachment({ recorded_at: AT, pressure_hpa: 10 })).toBe(false);
    expect(withAttachment({ recorded_at: AT, heading_mag_deg: 359.9 })).toBe(true);
  });

  it('refuses a changeset for another campus, and a malformed changeset', () => {
    const survey = build();
    const other = validateSurvey({ ...survey, changeset: { ...survey.changeset!, campus: 'other' } });
    expect(other.ok).toBe(false);
    expect(other.errors[0]).toContain('캠퍼스');
    expect(validateSurvey({ ...survey, changeset: { ...survey.changeset!, changes: [] } }).ok).toBe(false);
  });
});
