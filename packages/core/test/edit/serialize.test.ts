import { describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  addRoom,
  deleteBuilding,
  fromCampus,
  moveNode,
  observationTargetsOf,
  overrideIdsOf,
  parseCampus,
  serialize,
  toFeatures,
  type LoadedCampus,
} from '../../src/index.ts';
import { readCampusFiles } from '../../src/node/index.ts';
import { ctx, FIXTURE_DIR, fixture } from './helpers.ts';

function copyOf(loaded: LoadedCampus): LoadedCampus {
  return JSON.parse(JSON.stringify(loaded)) as LoadedCampus;
}

describe('serialize', () => {
  it('load → fromCampus → serialize gives every .geojson and campus.json back byte for byte', async () => {
    const disk = (await readCampusFiles(FIXTURE_DIR)).filter((f) => f.path.endsWith('.geojson') || f.path === 'campus.json');
    const { loaded, state } = await fixture();
    const out = serialize(state, loaded.meta);
    expect(out.map((f) => f.path)).toEqual(disk.map((f) => f.path).sort());
    for (const file of out) {
      expect(file.text, file.path).toBe(disk.find((d) => d.path === file.path)!.text);
    }
  });

  it('writes LF only, no campus.json without meta, and never overrides / observations / calibration', async () => {
    const { state } = await fixture();
    const out = serialize(state);
    expect(out.some((f) => f.path === 'campus.json')).toBe(false);
    expect(out.every((f) => !f.text.includes('\r'))).toBe(true);
    expect(out.every((f) => f.path.endsWith('.geojson'))).toBe(true);
  });

  it('an end coordinate off its node is an I2 issue; the state keeps the edge and the save puts the end on the node', async () => {
    const loaded = copyOf((await fixture()).loaded);
    const f = loaded.features.find((x) => (x.feature as { id: string }).id === 'e_A_3_hall__A_3_north')!.feature as { geometry: { coordinates: number[][] } };
    f.geometry.coordinates[1] = [127.000700001, 37.0007];
    const { state, issues } = fromCampus(loaded);
    expect(issues).toEqual([expect.objectContaining({ code: 'I2', featureId: 'e_A_3_hall__A_3_north', file: 'buildings/A/L3.geojson' })]);
    expect(state.edges['e_A_3_hall__A_3_north']).toBeDefined();
    const saved = toFeatures(state).find((x) => x.id === 'e_A_3_hall__A_3_north')!;
    expect(saved.geometry.coordinates).toEqual([[127.0006, 37.0005], [127.0007, 37.0007]]);
  });

  it('after moving a node the saved edges end on its new coordinate', async () => {
    const { state } = await fixture();
    const moved = moveNode('n_out_0002', [127.00021, 37.00041]).apply(state);
    const back = fromCampus(parseCampus(serialize(moved, (await fixture()).loaded.meta)));
    expect(back.issues).toEqual([]);
    expect(back.state).toEqual(moved);
  });

  it('schema-invalid features, dangling edges and repeated ids are left out as issues', async () => {
    const loaded = copyOf((await fixture()).loaded);
    (loaded.features[0]!.feature as { properties: { kind: string } }).properties.kind = 'nope';
    const edge = loaded.features.find((x) => (x.feature as { id: string }).id === 'e_C_5_hall__C_5_east')!;
    (edge.feature as { properties: { to: string } }).properties.to = 'n_gone';
    loaded.features.push({ file: 'outdoor.geojson', feature: JSON.parse(JSON.stringify(loaded.features.find((x) => (x.feature as { id: string }).id === 'n_out_0001')!.feature)) });
    const { state, issues } = fromCampus(loaded);
    expect(issues.map((i) => [i.code, i.featureId])).toEqual([
      ['schema', (loaded.features[0]!.feature as { id: string }).id],
      ['I3', 'n_out_0001'],
      ['I1', 'e_C_5_hall__C_5_east'],
    ]);
    expect(state.edges['e_C_5_hall__C_5_east']).toBeUndefined();
  });

  it('places new Features by scope: indoor by lower level, cross-building edges in connections, rooms by level', async () => {
    const { state } = await fixture();
    let s = addRoom({ id: 'r_B_2_x', polygon: [[[127.0012, 37.0005], [127.0013, 37.0005], [127.0013, 37.0006], [127.0012, 37.0005]]], props: { kind: 'room', building_id: 'bldg_B', level: 2, source: 'estimate' } }).apply(state);
    s = addEdge({ id: 'e_steps_A_B', props: { kind: 'edge', highway: 'steps', from: 'n_A_4_hall', to: 'n_B_1_hall', bidirectional: true, step_free: false, source: 'estimate' } }).apply(s);
    s = addEdge({ id: 'e_steps_A_4_2', props: { kind: 'edge', highway: 'steps', edge_type: 'indoor', from: 'n_A_4_hall', to: 'n_A_2_hall', bidirectional: true, step_free: false, source: 'estimate' } }).apply(s);
    s = addNode({ id: 'n_out_new', coord: [127.0001, 37.0001], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate' } }, ctx()).apply(s);
    const where = (id: string) => serialize(s).find((f) => f.text.includes(`"id":"${id}"`))!.path;
    expect(where('r_B_2_x')).toBe('buildings/B/L2.geojson');
    expect(where('e_steps_A_B')).toBe('connections.geojson');
    expect(where('e_steps_A_4_2')).toBe('buildings/A/L2.geojson');
    expect(where('n_out_new')).toBe('outdoor.geojson');
  });

  it('files left empty are not returned (removing them on disk is the caller\'s job)', async () => {
    const { state } = await fixture();
    const paths = serialize(deleteBuilding('C').apply(state)).map((f) => f.path);
    expect(paths.some((p) => p.startsWith('buildings/C/'))).toBe(false);
  });

  it('collects observation targets and override ids for the edit context', async () => {
    const loaded = copyOf((await fixture()).loaded);
    expect(observationTargetsOf(loaded).has('edge:e_out_0002__out_0003_esc')).toBe(true);
    loaded.overrides = [{ feature_id: 'n_A_elevA_L1', status: 'out_of_service', until: '2030-01-01T00:00:00+09:00', report_id: 'rp-1' }, null];
    expect([...overrideIdsOf(loaded)]).toEqual(['n_A_elevA_L1']);
  });
});
