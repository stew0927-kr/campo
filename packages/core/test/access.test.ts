// hours / closed_period / access_condition / sync_group (SPEC 4.2): optional node properties that old files do not have.
import { describe, expect, it } from 'vitest';
import {
  ACCESS_PROPS, accessPatch, applyChangeset, buildSurvey, createHistory, formatSurvey, fromCampus, historyToChangeset, isValidFeature, parseCampus,
  serialize, setProps, validateSurvey, type CampusMeta, type NodeFeature,
} from '../src/index.ts';
import { fixtureState } from './edit/helpers.ts';

const door = (extra: Record<string, unknown> = {}): NodeFeature => ({
  type: 'Feature',
  id: 'n_A_1_side',
  geometry: { type: 'Point', coordinates: [127.0004, 37.0004] },
  properties: { kind: 'node', node_type: 'door', building_id: 'bldg_A', level: 1, source: 'estimate', rev: 1, ...extra } as NodeFeature['properties'],
});

const ALL = { hours: '07:00-22:00', closed_period: '2026-11-15~2026-11-30', access_condition: '학생증 태깅', sync_group: 'sg_k7x2qa' };

describe('schema', () => {
  it('accepts a node without the new properties (old files) and with all of them', () => {
    expect(isValidFeature(door())).toBe(true);
    expect(isValidFeature(door(ALL))).toBe(true);
    expect(isValidFeature(door({ hours: '24/7' }))).toBe(true);
  });

  it('accepts them on every kind of point the task names', () => {
    for (const node_type of ['entrance', 'door']) expect(isValidFeature(door({ ...ALL, node_type }))).toBe(true);
    for (const node_type of ['outdoor', 'poi']) expect(isValidFeature(door({ ...ALL, node_type, building_id: null, level: null }))).toBe(true);
  });

  it('refuses a value that is not a non-empty string', () => {
    for (const key of [...ACCESS_PROPS, 'sync_group']) {
      expect(isValidFeature(door({ [key]: '' }))).toBe(false);
      expect(isValidFeature(door({ [key]: 7 }))).toBe(false);
    }
  });
});

describe('setProps and files', () => {
  it('sets, keeps and removes the properties, and they survive save → load byte for byte', async () => {
    const s = await fixtureState();
    expect(s.nodes['n_A_1_main']!.props).toMatchObject({ hours: '07:00-22:00', access_condition: '학생증 태깅' }); // the fixture has them
    const next = setProps(['n_A_1_main'], ALL).apply(s);
    expect(next.nodes['n_A_1_main']!.props).toMatchObject({ ...ALL, rev: 2 });

    const meta: CampusMeta = { id: 'campus-basic', schema_version: '0.2', name: 't', center: [127, 37], bbox: [126, 36, 128, 38] };
    const files = serialize(next, meta);
    const again = fromCampus(parseCampus(files));
    expect(again.issues).toEqual([]);
    expect(again.state.nodes['n_A_1_main']!.props).toEqual(next.nodes['n_A_1_main']!.props);
    expect(serialize(again.state, meta)).toEqual(files);

    const cleared = setProps(['n_A_1_main'], { hours: undefined, sync_group: undefined }).apply(next);
    expect('hours' in cleared.nodes['n_A_1_main']!.props).toBe(false);
    expect('sync_group' in cleared.nodes['n_A_1_main']!.props).toBe(false);
    expect(cleared.nodes['n_A_1_main']!.props.closed_period).toBe(ALL.closed_period);
  });

  it('accessPatch trims, removes emptied values and leaves out what did not change', () => {
    expect(accessPatch({}, { hours: ' 24/7 ' })).toEqual({ hours: '24/7' });
    expect(accessPatch({ hours: '24/7', access_condition: '상시개방' }, { hours: '24/7', access_condition: '  ' })).toEqual({ access_condition: undefined });
    expect(accessPatch({ hours: '24/7' }, { hours: '24/7', closed_period: '' })).toBeNull();
  });
});

describe('survey files', () => {
  it('carry the properties through the changeset and the attachment without loss', async () => {
    const base = await fixtureState();
    const h = createHistory(base);
    h.perform(setProps(['n_A_1_main'], ALL));
    const { sync_group: _s, ...read } = ALL;
    const survey = buildSurvey({
      base, current: h.current(), campus: 'campus-basic', id: 'sv-20261114-a-1f', surveyedAt: '2026-11-14T10:00:00+09:00',
      attachments: { n_A_1_main: { recorded_at: '2026-11-14T10:00:00+09:00', ...read, sync_group: ALL.sync_group, note: '경비실 옆' } },
      vertical: [], summary: '출입구 개방시간',
    });
    const parsed: unknown = JSON.parse(formatSurvey(survey));
    expect(validateSurvey(parsed)).toEqual({ ok: true, errors: [] });
    expect(survey.attachments['n_A_1_main']).toMatchObject(ALL);
    const change = survey.changeset!.changes[0]!;
    expect(change).toMatchObject({ op: 'modify', base_rev: 1, feature: { id: 'n_A_1_main', properties: { ...ALL, rev: 2 } } });

    // The editor's side: the same changeset onto the same campus gives the surveyed properties.
    const imported = applyChangeset(survey.changeset!).apply(base);
    expect(imported.nodes['n_A_1_main']!.props).toMatchObject(ALL);
    expect(historyToChangeset(base, imported, { id: 'cs-20261114-x', campus: 'campus-basic', source: 'editor', summary: 's' }).changes).toEqual(survey.changeset!.changes);
  });

  it('refuse an empty value in an attachment', () => {
    const survey = { format: 'campo-survey', version: 1, id: 'sv-20261114-x', campus: 'c', surveyed_at: '2026-11-14T10:00:00+09:00', attachments: { n1: { recorded_at: '2026-11-14T10:00:00+09:00', hours: '' } }, vertical: [] };
    expect(validateSurvey(survey).ok).toBe(false);
  });
});
