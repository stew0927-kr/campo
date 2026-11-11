import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrateCampusFiles, parseCampus, validateCampus, type LoadedFile } from '../src/index.ts';
import { readCampusFiles } from '../src/node/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFeature = any;

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/campus-basic', import.meta.url));

// ---- A small v0.1 campus: no rev, no schema_version, shaft_id, step_free always a boolean ----

const P: [number, number] = [127, 37];
const pos = (i: number): [number, number] => [P[0] + i * 0.00001, P[1]];
const node = (id: string, i: number, properties: AnyFeature): AnyFeature => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: pos(i) },
  properties: { kind: 'node', building_id: 'bldg_T', level: 1, source: 'estimate', ...properties },
});
const edge = (id: string, from: AnyFeature, to: AnyFeature, properties: AnyFeature): AnyFeature => ({
  type: 'Feature', id, geometry: { type: 'LineString', coordinates: [from.geometry.coordinates, to.geometry.coordinates] },
  properties: { kind: 'edge', from: from.id, to: to.id, bidirectional: true, source: 'estimate', ...properties },
});
const collection = (features: AnyFeature[]): string => `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
const meta = (extra = {}): string => `${JSON.stringify({ id: 't', name: 'T', center: [127, 37], bbox: [126.9, 36.9, 127.1, 37.1], ...extra }, null, 2)}\n`;

// NOTE: every node says level 1. Elevator groups must come from the edges, not from floor numbers.
const lift = (id: string, i: number, extra: AnyFeature = {}) => node(id, i, { node_type: 'elevator_stop', ...extra });
const a1 = lift('n_T_a1', 0, { shaft_id: 'T_elevA' });
const a2 = lift('n_T_a2', 1);
const a3 = lift('n_T_a3', 2, { shaft_id: 'T_elevA' });
const b1 = lift('n_T_b1', 3);
const b2 = lift('n_T_b2', 4);
const hall = node('n_T_hall', 5, { node_type: 'corridor' });
const hall2 = node('n_T_hall2', 6, { node_type: 'corridor' });

const v01 = (): LoadedFile[] => [
  { path: 'campus.json', text: meta() },
  {
    path: 'buildings/T/building.geojson',
    text: collection([{
      type: 'Feature', id: 'bldg_T',
      geometry: { type: 'Polygon', coordinates: [[[127, 37], [127.001, 37], [127.001, 37.001], [127, 37.001], [127, 37]]] },
      properties: { kind: 'building', name: 'T동', code: 'T', levels: [1], ground_levels: [1], source: 'estimate' },
    }]),
  },
  {
    path: 'buildings/T/L1.geojson',
    text: collection([
      a1, a2, a3, b1, b2, hall, hall2,
      edge('e_a1_a2', a1, a2, { highway: 'elevator', edge_type: 'indoor', step_free: false }),
      edge('e_a2_a3', a2, a3, { highway: 'elevator', edge_type: 'indoor', step_free: false }),
      edge('e_b1_b2', b1, b2, { highway: 'elevator', edge_type: 'indoor', step_free: false, source: 'field-survey-2026-11' }),
      edge('e_ramp_est', hall, hall2, { highway: 'ramp', edge_type: 'indoor', step_free: false }),
      edge('e_ramp_site', hall, hall2, { highway: 'ramp', edge_type: 'indoor', step_free: false, source: 'field-survey-2026-11' }),
      edge('e_corr_est', hall, a1, { highway: 'corridor', edge_type: 'indoor', step_free: false }),
      edge('e_corr_ok', hall, b1, { highway: 'corridor', edge_type: 'indoor', step_free: true }),
      edge('e_corr_site', hall2, b2, { highway: 'corridor', edge_type: 'indoor', step_free: false, source: 'field-survey-2026-11' }),
      edge('e_steps', hall, hall2, { highway: 'steps', edge_type: 'indoor', step_free: false }),
      edge('e_foot_blank', hall2, a2, { highway: 'footway', edge_type: 'outdoor' }),
    ]),
  },
];

const featuresOf = (files: LoadedFile[]): Map<string, AnyFeature> =>
  new Map(parseCampus(files).features.map((f) => [(f.feature as AnyFeature).id, f.feature as AnyFeature]));

/** The input files with the migrated ones swapped in. */
const applied = (input: LoadedFile[], files: LoadedFile[]): LoadedFile[] =>
  input.map((f) => files.find((m) => m.path === f.path) ?? f);

describe('migrateCampusFiles: step_free (SPEC-v0.2 §2.1, audit R19)', () => {
  const result = migrateCampusFiles(v01());
  const features = featuresOf(applied(v01(), result.files));
  const stepFree = (id: string) => features.get(id).properties.step_free;

  it('turns an unchecked false into null, ramps included', () => {
    expect(stepFree('e_corr_est')).toBeNull();
    expect(stepFree('e_ramp_est')).toBeNull();
  });

  it('keeps what a person checked on site, and what is true', () => {
    expect(stepFree('e_ramp_site')).toBe(false);
    expect(stepFree('e_corr_site')).toBe(false);
    expect(stepFree('e_corr_ok')).toBe(true);
  });

  it('keeps false on steps', () => {
    expect(stepFree('e_steps')).toBe(false);
  });

  it('makes elevator edges true unless a site check said otherwise', () => {
    expect(stepFree('e_a1_a2')).toBe(true);
    expect(stepFree('e_a2_a3')).toBe(true);
    expect(stepFree('e_b1_b2')).toBe(false);
  });

  it('fills an edge that had no value with the §2.1 default', () => {
    expect(stepFree('e_foot_blank')).toBeNull();
  });

  it('counts what it changed', () => {
    expect(result.summary).toMatchObject({
      stepFreeToNull: 2, elevatorEdgeStepFreeTrue: 2, stepFreeFilled: 1,
    });
  });
});

describe('migrateCampusFiles: elevator_id', () => {
  const result = migrateCampusFiles(v01());
  const features = featuresOf(applied(v01(), result.files));
  const idOf = (id: string) => features.get(id).properties.elevator_id;

  it('moves a shaft_id to every stop of the group, whichever stops carried it', () => {
    expect(['n_T_a1', 'n_T_a2', 'n_T_a3'].map(idOf)).toEqual(['T_elevA', 'T_elevA', 'T_elevA']);
  });

  it('fills a group with no value as {building}_elev{first unused letter}', () => {
    expect(['n_T_b1', 'n_T_b2'].map(idOf)).toEqual(['T_elevB', 'T_elevB']); // T_elevA is taken
  });

  it('removes shaft_id everywhere', () => {
    expect([...features.values()].some((f) => f.properties && 'shaft_id' in f.properties)).toBe(false);
    expect(result.summary).toMatchObject({ shaftIdRemoved: 2, elevatorIdFromShaft: 2, elevatorIdGenerated: 3 });
  });

  it('groups by edges, not by level (all stops say level 1 here)', () => {
    expect(new Set(['n_T_a1', 'n_T_a3'].map(idOf))).toEqual(new Set(['T_elevA']));
    expect(idOf('n_T_b1')).not.toBe(idOf('n_T_a1'));
  });

  it('skips letters that another elevator in the building already uses', () => {
    const files = v01();
    const lower = files.find((f) => f.path === 'buildings/T/L1.geojson')!;
    // The second group already holds T_elevB through a shaft_id on a stop outside any elevator edge.
    const lone = lift('n_T_lone', 7, { shaft_id: 'T_elevB' });
    lower.text = lower.text.replace('\n]}\n', `,\n${JSON.stringify(lone)}\n]}\n`);
    const out = featuresOf(applied(files, migrateCampusFiles(files).files));
    expect(out.get('n_T_lone').properties.elevator_id).toBe('T_elevB');
    expect(out.get('n_T_b1').properties.elevator_id).toBe('T_elevC');
  });

  it('stops and lists the stops when one group carries different shaft_ids', () => {
    const files = v01();
    const lower = files.find((f) => f.path === 'buildings/T/L1.geojson')!;
    lower.text = lower.text.replace('"id":"n_T_a2","geometry":{"type":"Point","coordinates":[127.00001,37]},"properties":{"kind":"node",',
      '"id":"n_T_a2","geometry":{"type":"Point","coordinates":[127.00001,37]},"properties":{"kind":"node","shaft_id":"T_elevZ",');
    const result = migrateCampusFiles(files);
    expect(result.files).toEqual([]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({ code: 'mixed-shaft' });
    expect(result.problems[0]!.nodes).toEqual([
      { id: 'n_T_a1', shaft_id: 'T_elevA', elevator_id: null },
      { id: 'n_T_a2', shaft_id: 'T_elevZ', elevator_id: null },
      { id: 'n_T_a3', shaft_id: 'T_elevA', elevator_id: null },
    ]);
  });
});

describe('migrateCampusFiles: rev, schema_version and the rest', () => {
  it('adds rev: 1 to every feature and schema_version to campus.json', () => {
    const result = migrateCampusFiles(v01());
    const out = applied(v01(), result.files);
    const parsed = parseCampus(out);
    expect(parsed.features.every((f) => (f.feature as AnyFeature).properties.rev === 1)).toBe(true);
    expect(parsed.meta).toMatchObject({ id: 't', schema_version: '0.2' });
    expect(result.summary.revAdded).toBe(parsed.features.length);
    expect(result.summary.schemaVersionSet).toBe(1);
  });

  it('writes files in the editor format: one feature per line, sorted by id', () => {
    const result = migrateCampusFiles(v01());
    const text = result.files.find((f) => f.path === 'buildings/T/L1.geojson')!.text;
    const ids = text.split('\n').filter((l) => l.startsWith('{"type":"Feature"')).map((l) => JSON.parse(l.replace(/,$/, '')).id);
    expect(ids).toEqual([...ids].sort());
    expect(text.endsWith(']}\n')).toBe(true);
  });

  it('gives data that passes the v0.2 schema once the rest of the campus is in place', () => {
    const out = applied(v01(), migrateCampusFiles(v01()).files);
    const schemaErrors = validateCampus(parseCampus(out)).errors.filter((e) => e.code === 'schema');
    expect(schemaErrors).toEqual([]);
  });

  it('refuses a schema_version it does not know, and unreadable files', () => {
    const unknown = migrateCampusFiles([{ path: 'campus.json', text: meta({ schema_version: '9.9' }) }]);
    expect(unknown.problems).toEqual([expect.objectContaining({ code: 'unknown-version' })]);
    const broken = migrateCampusFiles([...v01(), { path: 'outdoor.geojson', text: '{"type":"Feature"}' }]);
    expect(broken.problems).toEqual([expect.objectContaining({ code: 'bad-file' })]);
    expect(broken.files).toEqual([]);
  });
});

describe('migrateCampusFiles is idempotent', () => {
  it('changes nothing when run on its own output', () => {
    const first = migrateCampusFiles(v01());
    const out = applied(v01(), first.files);
    const second = migrateCampusFiles(out);
    expect(second.files).toEqual([]);
    expect(second.problems).toEqual([]);
    expect(Object.values(second.summary).every((n) => n === 0)).toBe(true);
  });

  it('works on an empty campus, twice, with the same result', () => {
    const empty: LoadedFile[] = [
      { path: 'campus.json', text: meta() },
      { path: 'outdoor.geojson', text: '{"type":"FeatureCollection","features":[]}\n' },
      { path: 'connections.geojson', text: '{"type":"FeatureCollection","features":[]}\n' },
    ];
    const first = migrateCampusFiles(empty);
    expect(first.problems).toEqual([]);
    expect(first.files.map((f) => f.path)).toEqual(['campus.json']); // only the version is new
    const second = migrateCampusFiles(applied(empty, first.files));
    expect(second.files).toEqual([]);
    expect(validateCampus(parseCampus(applied(empty, first.files))).errors).toEqual([]);
  });

  it('leaves the v0.2 fixture folder untouched', async () => {
    const result = migrateCampusFiles(await readCampusFiles(FIXTURE_DIR));
    expect(result.problems).toEqual([]);
    expect(result.files).toEqual([]);
  });
});
