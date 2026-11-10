import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES as E,
  WARNING_CODES as W,
  parseCampus,
  validateCampus,
  type LoadedCampus,
  type ValidationResult,
} from '../src/index.ts';
import { loadCampus } from '../src/node/index.ts';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/campus-basic', import.meta.url));

let fixture: LoadedCampus;
beforeAll(async () => {
  fixture = await loadCampus(FIXTURE_DIR);
});

// Tests reach into unvalidated features on purpose, so a loose type is fine here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFeature = any;

/** Copy the fixture, let `mutate` break it, and validate the copy. */
function broken(mutate: (helpers: {
  campus: LoadedCampus;
  get: (id: string) => AnyFeature;
  remove: (id: string) => void;
  add: (file: string, feature: AnyFeature) => void;
}) => void): ValidationResult {
  const campus = structuredClone(fixture);
  const get = (id: string): AnyFeature => {
    const found = campus.features.find((f) => (f.feature as AnyFeature).id === id);
    if (!found) throw new Error(`fixture has no feature ${id}`);
    return found.feature;
  };
  const remove = (id: string) => {
    get(id);
    campus.features = campus.features.filter((f) => (f.feature as AnyFeature).id !== id);
  };
  const add = (file: string, feature: AnyFeature) => campus.features.push({ file, feature });
  mutate({ campus, get, remove, add });
  return validateCampus(campus);
}

const outdoorNode = (id: string, coordinates: [number, number]) => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates },
  properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate' },
});

const codes = (issues: { code: string; featureId: string | null }[]) => issues.map((i) => [i.code, i.featureId]);

describe('fixture campus-basic', () => {
  it('loads every file of the campus folder into one feature list', () => {
    const files = new Set(fixture.features.map((f) => f.file));
    expect([...files].sort()).toEqual([
      'buildings/A/L1.geojson', 'buildings/A/L2.geojson', 'buildings/A/L3.geojson', 'buildings/A/L4.geojson',
      'buildings/A/building.geojson', 'buildings/B/L1.geojson', 'buildings/B/L2.geojson',
      'buildings/B/building.geojson', 'connections.geojson', 'outdoor.geojson',
    ]);
    expect(fixture.meta).toMatchObject({ id: 'fixture-basic' });
    expect(fixture.fileErrors).toEqual([]);
  });

  it('has the shape the routing tests rely on', () => {
    const features = fixture.features.map((f) => f.feature as AnyFeature);
    const nodes = features.filter((f) => f.properties.kind === 'node');
    const of = (pred: (f: AnyFeature) => boolean) => features.filter(pred).map((f) => f.id).sort();

    expect(nodes.filter((n) => n.properties.building_id === null)).toHaveLength(6);
    expect(of((f) => f.properties.kind === 'building')).toEqual(['bldg_A', 'bldg_B']);
    expect(of((f) => f.properties.highway === 'elevator')).toHaveLength(3); // A 1→2→3→4
    expect(of((f) => f.properties.highway === 'steps' && f.properties.edge_type === 'indoor' && f.properties.from.startsWith('n_A_')))
      .toHaveLength(3); // A 1→2→3→4
    expect(of((f) => f.properties.highway === 'steps' && f.properties.edge_type === 'outdoor')).toEqual(['e_out_0002__out_0003']);
    expect(of((f) => f.properties.edge_type === 'portal')).toContain('e_portal_A_4_north');
    expect(of((f) => f.properties.edge_type === 'bridge')).toEqual(['e_A_3_bridge__B_2_bridge']);
    expect(of((f) => f.properties.node_type === 'door' && f.properties.space_name)).toEqual(['n_A_4_408door', 'n_B_2_201door']);
  });

  it('passes validation with no errors and no warnings', () => {
    expect(validateCampus(fixture)).toEqual({ errors: [], warnings: [] });
  });
});

describe('validateCampus errors (SPEC §7)', () => {
  it('1. reports JSON Schema violations', () => {
    const result = broken(({ get }) => {
      delete get('e_out_0001__out_0002').properties.step_free; // required
      get('n_A_2_hall').properties.level = 0; // 0 is never a level
    });
    expect(codes(result.errors)).toEqual(expect.arrayContaining([
      [E.schema, 'n_A_2_hall'],
      [E.schema, 'e_out_0001__out_0002'],
    ]));
    expect(result.errors).toHaveLength(2);
    const stepFree = result.errors.find((e) => e.featureId === 'e_out_0001__out_0002')!;
    expect(stepFree.file).toBe('outdoor.geojson');
    expect(stepFree.message).toContain('step_free');
  });

  it('2. reports an id used twice anywhere in the campus', () => {
    const result = broken(({ get, add }) => {
      add('buildings/B/L1.geojson', structuredClone(get('n_A_1_hall')));
    });
    expect(result.errors).toEqual([
      expect.objectContaining({ code: E.duplicateId, featureId: 'n_A_1_hall', file: 'buildings/B/L1.geojson' }),
    ]);
  });

  it('3. reports an edge pointing at a node that does not exist', () => {
    const result = broken(({ get }) => {
      get('e_out_0001__out_0006').properties.to = 'n_out_9999';
    });
    expect(codes(result.errors)).toEqual([[E.danglingRef, 'e_out_0001__out_0006']]);
    expect(result.errors[0]!.message).toContain('n_out_9999');
  });

  it('4. reports line ends more than 1m from their nodes, except for elevators', () => {
    const result = broken(({ get }) => {
      get('e_out_0001__out_0002').geometry.coordinates[0] = [127.0001, 37.0000]; // ~9m east of the gate
      get('e_A_1_main__A_1_hall').geometry.coordinates[1] = [127.000605, 37.0005]; // ~0.4m: allowed
      get('e_A_elevA_L1__A_elevA_L2').geometry.coordinates = [[127.0, 37.0], [127.1, 37.1]]; // elevator: ignored
    });
    expect(codes(result.errors)).toEqual([[E.endpointMismatch, 'e_out_0001__out_0002']]);
  });

  it('5. reports an indoor node whose level is not one of its building levels', () => {
    const result = broken(({ get }) => {
      get('n_B_2_hall').properties.level = 3; // B has levels [1, 2]
    });
    expect(codes(result.errors)).toEqual([[E.levelNotInBuilding, 'n_B_2_hall']]);
  });

  it('6. reports elevator or stair levels that differ from their end nodes', () => {
    const result = broken(({ get }) => {
      get('e_A_elevA_L1__A_elevA_L2').properties.level_to = 3;
      delete get('e_A_2_stair__A_3_stair').properties.level_from;
    });
    expect(codes(result.errors)).toEqual([
      [E.verticalLevelMismatch, 'e_A_elevA_L1__A_elevA_L2'],
      [E.verticalLevelMismatch, 'e_A_2_stair__A_3_stair'],
    ]);
  });

  it('7. reports a ground level without any entrance', () => {
    const result = broken(({ get }) => {
      get('n_A_4_north').properties.node_type = 'corridor'; // A 4F touches the ground but loses its entrance
    });
    expect(codes(result.errors)).toEqual([[E.groundLevelWithoutEntrance, 'bldg_A']]);
    expect(result.errors[0]!.message).toContain('4층');
  });

  it('8. reports an entrance that no portal edge connects', () => {
    const result = broken(({ remove }) => {
      remove('e_portal_B_1_main');
    });
    expect(codes(result.errors)).toEqual([[E.entranceWithoutPortal, 'n_B_1_main']]);
  });

  it('does not also report a missing portal when the portal only has a broken far end', () => {
    const result = broken(({ get }) => {
      get('e_portal_B_1_main').properties.to = 'n_out_9999';
    });
    expect(codes(result.errors)).toEqual([[E.danglingRef, 'e_portal_B_1_main']]);
  });

  it('reports unreadable files and a missing campus.json as schema errors', () => {
    const campus = parseCampus([
      { path: 'outdoor.geojson', text: '{"type":"FeatureCollection","features":[' },
      { path: 'connections.geojson', text: '{"type":"Feature"}' },
    ]);
    expect(validateCampus(campus).errors.map((e) => [e.code, e.file, e.featureId])).toEqual([
      [E.schema, 'connections.geojson', null],
      [E.schema, 'outdoor.geojson', null],
      [E.schema, 'campus.json', null],
    ]);
  });
});

describe('validateCampus warnings (SPEC §7)', () => {
  it('1. warns about a node no edge uses', () => {
    const result = broken(({ add }) => add('outdoor.geojson', outdoorNode('n_out_0099', [127.0, 37.001])));
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.isolatedNode, 'n_out_0099']]);
  });

  it('2. warns about a piece of graph cut off from the rest', () => {
    const result = broken(({ add }) => {
      add('outdoor.geojson', outdoorNode('n_out_0098', [127.002, 37.002]));
      add('outdoor.geojson', outdoorNode('n_out_0099', [127.002, 37.0021]));
      add('outdoor.geojson', {
        type: 'Feature', id: 'e_out_0098__out_0099',
        geometry: { type: 'LineString', coordinates: [[127.002, 37.002], [127.002, 37.0021]] },
        properties: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'n_out_0098', to: 'n_out_0099',
          bidirectional: true, step_free: true, source: 'estimate' },
      });
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.disconnectedComponent, 'n_out_0098']]);
  });

  it('3. lists features marked needs_check', () => {
    const result = broken(({ get }) => {
      get('bldg_B').properties.needs_check = true;
      get('e_out_0002__out_0003').properties.needs_check = true;
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([
      [W.needsCheck, 'bldg_B'],
      [W.needsCheck, 'e_out_0002__out_0003'],
    ]);
  });

  it('4. warns when a classroom door has no step-free route from a poi', () => {
    const result = broken(({ get }) => {
      get('e_A_3_bridge__B_2_bridge').properties.step_free = false; // B 2F is then reachable only by stairs
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.noStepFreeRoute, 'n_B_2_201door']]);
    expect(result.warnings[0]!.message).toContain('201호 강의실');
  });
});
