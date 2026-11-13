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
  properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', rev: 1 },
});

const codes = (issues: { code: string; featureId: string | null }[]) => issues.map((i) => [i.code, i.featureId]);

describe('fixture campus-basic', () => {
  it('loads every file of the campus folder into one feature list', () => {
    const files = new Set(fixture.features.map((f) => f.file));
    expect([...files].sort()).toEqual([
      'buildings/A/L1.geojson', 'buildings/A/L2.geojson', 'buildings/A/L3.geojson', 'buildings/A/L4.geojson',
      'buildings/A/building.geojson', 'buildings/B/L1.geojson', 'buildings/B/L2.geojson',
      'buildings/B/building.geojson', 'buildings/C/L5.geojson', 'buildings/C/building.geojson',
      'connections.geojson', 'outdoor.geojson',
    ]);
    expect(fixture.meta).toMatchObject({ id: 'fixture-basic', schema_version: '0.2' });
    expect(fixture.fileErrors).toEqual([]);
  });

  it('has the shape the routing tests rely on', () => {
    const features = fixture.features.map((f) => f.feature as AnyFeature);
    const nodes = features.filter((f) => f.properties.kind === 'node');
    const of = (pred: (f: AnyFeature) => boolean) => features.filter(pred).map((f) => f.id).sort();

    expect(nodes.filter((n) => n.properties.building_id === null)).toHaveLength(7); // 6 on the campus paths + a dead end in front of C
    expect(of((f) => f.properties.kind === 'building')).toEqual(['bldg_A', 'bldg_B', 'bldg_C']);
    expect(of((f) => f.properties.highway === 'elevator')).toHaveLength(3); // A 1→2→3→4
    expect(of((f) => f.properties.highway === 'steps' && f.properties.edge_type === 'indoor' && f.properties.from.startsWith('n_A_')))
      .toHaveLength(5); // A 1→2→3→4 flights + the 1→2 escalator pair (up, down)
    expect(of((f) => f.properties.conveying)).toEqual(['e_A_1_esc__A_2_esc_down', 'e_A_1_esc__A_2_esc_up', 'e_out_0002__out_0003_esc']);
    expect(of((f) => f.properties.highway === 'steps' && f.properties.edge_type === 'outdoor' && !f.properties.conveying)).toEqual(['e_out_0002__out_0003']);
    expect(of((f) => f.properties.edge_type === 'portal')).toContain('e_portal_A_4_north');
    expect(of((f) => f.properties.edge_type === 'bridge')).toEqual([
      'e_A_3_bridge__B_2_bridge', 'e_A_3_north__C_5_bridge', 'e_C_5_east__B_2_steps',
    ]);
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
    // The hall now sits on another scope than its three flat edges, which E9 (I4) reports as well.
    expect(codes(result.errors)).toEqual([
      [E.flatEdgeCrossesScope, 'e_B_2_bridge__B_2_hall'],
      [E.flatEdgeCrossesScope, 'e_B_2_hall__B_2_201door'],
      [E.flatEdgeCrossesScope, 'e_B_2_hall__B_2_stair'],
      [E.levelNotInBuilding, 'n_B_2_hall'],
    ]);
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
          bidirectional: true, step_free: true, source: 'estimate', rev: 1 },
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

// ---------------------------------------------------------------------------------------------
// v0.2 (docs/v0.2/SPEC-v0.2.md §2 and §8)
// ---------------------------------------------------------------------------------------------

/** The edges that end at node `id`, so a test can move the node and keep the lines on it. */
function edgesAt(campus: LoadedCampus, id: string): AnyFeature[] {
  return campus.features
    .map((f) => f.feature as AnyFeature)
    .filter((f) => f.properties.kind === 'edge' && (f.properties.from === id || f.properties.to === id));
}

describe('fixture campus-basic (v0.2 additions)', () => {
  const all = () => fixture.features.map((f) => f.feature as AnyFeature);
  const byId = (id: string) => all().find((f) => f.id === id);

  it('has two restrooms, one of them a checked wheelchair restroom', () => {
    const restrooms = all().filter((f) => f.properties.node_type === 'restroom');
    expect(restrooms.map((f) => [f.id, f.properties.restroom_gender, f.properties.wheelchair])).toEqual([
      ['n_A_4_wc_f', 'female', 'yes'], // features are listed by id
      ['n_A_4_wc_m', 'male', 'no'],
    ]);
  });

  it('gives the classroom doors a room number and a role', () => {
    expect(byId('n_A_4_408door').properties).toMatchObject({ room_ref: '408', door_role: 'front' });
    expect(byId('n_B_2_201door').properties).toMatchObject({ room_ref: '201', door_role: 'front' });
  });

  it('joins A 3F and C 5F with a bridge whose two level numbers differ', () => {
    expect(byId('e_A_3_north__C_5_bridge').properties).toMatchObject({
      edge_type: 'bridge', building_from: 'bldg_A', building_to: 'bldg_C', level_from: 3, level_to: 5, covered: true, step_free: true,
    });
  });

  it('has a bridge into B that ends in two steps', () => {
    expect(byId('e_C_5_east__B_2_steps').properties).toMatchObject({ edge_type: 'bridge', building_to: 'bldg_B', step_free: true });
    expect(byId('e_B_2_steps__B_2_bridge').properties).toMatchObject({
      highway: 'steps', step_free: false, step_count: 2, incline: 'down',
    });
  });

  it('keeps every elevator stop of A on one elevator_id and has no shaft_id left', () => {
    const ids = all().filter((f) => f.properties.node_type === 'elevator_stop').map((f) => f.properties.elevator_id);
    expect(ids).toEqual(['A_elevA', 'A_elevA', 'A_elevA', 'A_elevA']);
    expect(all().some((f) => 'shaft_id' in f.properties)).toBe(false);
  });
});

describe('schema v0.2 (SPEC-v0.2 §2)', () => {
  const schemaErrors = (r: ValidationResult) => r.errors.filter((e) => e.code === E.schema);

  it('accepts step_free true, false and null', () => {
    const result = broken(({ get }) => {
      get('e_out_0001__out_0002').properties.step_free = null;
      get('e_out_0001__out_0006').properties.step_free = false;
    });
    expect(result.errors).toEqual([]);
  });

  it('rejects other step_free values', () => {
    const result = broken(({ get }) => {
      get('e_out_0001__out_0002').properties.step_free = 'maybe';
    });
    expect(codes(result.errors)).toEqual([[E.schema, 'e_out_0001__out_0002']]);
  });

  it('requires rev on every kind of feature and rejects 0', () => {
    const result = broken(({ get }) => {
      delete get('bldg_B').properties.rev;
      delete get('n_out_0001').properties.rev;
      delete get('e_out_0001__out_0002').properties.rev;
      get('n_out_0002').properties.rev = 0;
    });
    expect(codes(schemaErrors(result))).toEqual(expect.arrayContaining([
      [E.schema, 'bldg_B'], [E.schema, 'n_out_0001'], [E.schema, 'e_out_0001__out_0002'], [E.schema, 'n_out_0002'],
    ]));
    expect(schemaErrors(result)).toHaveLength(4);
  });

  it('asks for npm run migrate when campus.json has no schema_version', () => {
    const campus = structuredClone(fixture);
    delete (campus.meta as AnyFeature).schema_version;
    const [error] = validateCampus(campus).errors;
    expect(error).toMatchObject({ code: E.schema, file: 'campus.json' });
    expect(error!.message).toContain('npm run migrate');
  });

  describe('map_limits (campus.json)', () => {
    const withLimits = (limits: unknown, center?: [number, number]) => {
      const campus = structuredClone(fixture);
      const meta = campus.meta as AnyFeature;
      meta.map_limits = limits;
      if (center) meta.center = center;
      return validateCampus(campus).errors.filter((e) => e.file === 'campus.json');
    };

    it('the fixture declares valid limits, and a campus without them is fine too', () => {
      expect((fixture.meta as AnyFeature).map_limits).toBeDefined();
      expect(validateCampus(fixture).errors).toEqual([]);
      expect(withLimits(undefined)).toEqual([]);
    });

    it('rejects bounds out of order, a centre outside, and min_zoom above max_zoom (E14)', () => {
      const ok = { bounds: [126.998, 36.998, 127.003, 37.002], min_zoom: 15, max_zoom: 22 };
      expect(withLimits({ ...ok, bounds: [127.003, 36.998, 126.998, 37.002] }).map((e) => e.code)).toEqual([E.mapLimitsInvalid]);
      expect(withLimits({ ...ok, bounds: [127.1, 36.998, 127.2, 37.002] }).map((e) => e.code)).toEqual([E.mapLimitsInvalid]);
      expect(withLimits({ ...ok, min_zoom: 20, max_zoom: 16 }).map((e) => e.code)).toEqual([E.mapLimitsInvalid]);
    });

    it('rejects a missing field, a wrong length and unknown keys (schema)', () => {
      const ok = { bounds: [126.998, 36.998, 127.003, 37.002], min_zoom: 15, max_zoom: 22 };
      expect(withLimits({ bounds: ok.bounds, min_zoom: 15 }).map((e) => e.code)).toEqual([E.schema]);
      expect(withLimits({ ...ok, bounds: [1, 2, 3] }).map((e) => e.code)).toEqual([E.schema]);
      expect(withLimits({ ...ok, radius_m: 1500 }).map((e) => e.code)).toEqual([E.schema]);
    });
  });

  it('rejects the v0.1 shaft_id', () => {
    const result = broken(({ get }) => {
      get('n_A_elevA_L1').properties.shaft_id = 'A_elevA';
    });
    expect(codes(schemaErrors(result))).toEqual([[E.schema, 'n_A_elevA_L1']]);
  });

  it('needs a gender and a wheelchair value on a restroom', () => {
    const result = broken(({ get }) => {
      delete get('n_A_4_wc_m').properties.restroom_gender;
      delete get('n_A_4_wc_f').properties.wheelchair;
    });
    expect(codes(schemaErrors(result))).toEqual([[E.schema, 'n_A_4_wc_f'], [E.schema, 'n_A_4_wc_m']]);
  });

  it('allows incline only on steps edges', () => {
    const result = broken(({ get }) => {
      get('e_out_0001__out_0002').properties.incline = 'up'; // a footway
      get('e_out_0002__out_0003').properties.incline = 'sideways'; // steps, bad value
    });
    expect(codes(schemaErrors(result))).toEqual([[E.schema, 'e_out_0001__out_0002'], [E.schema, 'e_out_0002__out_0003']]);
  });

  it('allows a bridge building with one level but not two', () => {
    const ok = broken(({ get }) => {
      get('bldg_C').properties.building_type = 'bridge';
    });
    expect(ok.errors).toEqual([]);
    const bad = broken(({ get }) => {
      get('bldg_B').properties.building_type = 'bridge'; // B has two levels
    });
    // (B's nodes then report a missing building as well; only the schema error is the point here.)
    expect(codes(schemaErrors(bad))).toEqual([[E.schema, 'bldg_B']]);
  });

  it('accepts a room outline, and the covered flag on a bridge', () => {
    const result = broken(({ add }) => {
      add('buildings/B/L2.geojson', {
        type: 'Feature', id: 'r_B_2_201',
        geometry: { type: 'Polygon', coordinates: [[[127.0012, 37.00055], [127.0013, 37.00055], [127.0013, 37.0006], [127.0012, 37.0006], [127.0012, 37.00055]]] },
        properties: { kind: 'room', building_id: 'bldg_B', level: 2, room_ref: '201', source: 'estimate', rev: 1 },
      });
    });
    expect(result.errors).toEqual([]); // the fixture's bridges already carry covered: true
  });

  it('checks overrides.json against its schema', () => {
    const campus = structuredClone(fixture);
    campus.overrides = [{ feature_id: 'n_A_elevA_L2', status: 'out_of_service', until: 'tomorrow', report_id: 'rp-1' }];
    expect(validateCampus(campus).errors).toEqual([
      expect.objectContaining({ code: E.schema, file: 'overrides.json', featureId: null }),
    ]);
  });
});

describe('validateCampus v0.2 errors (SPEC-v0.2 §8)', () => {
  it('E9 (I4): reports a flat edge that joins two different scopes', () => {
    const result = broken(({ get }) => {
      get('n_A_3_north').properties.level = 2; // its corridor to the 3F hall now crosses floors
    });
    expect(codes(result.errors)).toEqual([[E.flatEdgeCrossesScope, 'e_A_3_hall__A_3_north']]);
  });

  it('E9 (I4): lets portals and bridges cross scopes', () => {
    expect(validateCampus(fixture).errors).toEqual([]); // the fixture has three portals and three bridges
  });

  it('E9 (I5): reports stops of one elevator that are not at the same coordinate', () => {
    const result = broken(({ campus, get }) => {
      const moved: [number, number] = [127.00082, 37.0005]; // ~1.8m east of the shaft
      get('n_A_elevA_L2').geometry.coordinates = moved;
      for (const edge of edgesAt(campus, 'n_A_elevA_L2')) {
        if (edge.properties.highway === 'elevator') continue; // elevator edges are not checked for line ends
        edge.geometry.coordinates[edge.properties.from === 'n_A_elevA_L2' ? 0 : edge.geometry.coordinates.length - 1] = moved;
      }
    });
    expect(codes(result.errors)).toEqual([[E.elevatorStopsApart, 'n_A_elevA_L2']]);
  });

  it('E10: reports a restroom that no edge reaches', () => {
    const result = broken(({ remove }) => {
      remove('e_A_4_hall__A_4_wc_m');
    });
    expect(codes(result.errors)).toEqual([[E.restroomNotConnected, 'n_A_4_wc_m']]);
  });

  it('E11: reports an elevator stop without elevator_id', () => {
    const result = broken(({ get }) => {
      delete get('n_A_elevA_L3').properties.elevator_id;
    });
    expect(codes(result.errors)).toEqual([[E.elevatorIdMissing, 'n_A_elevA_L3']]);
  });

  it('E11: reports one elevator_id whose stops no elevator edges join', () => {
    const result = broken(({ remove }) => {
      remove('e_A_elevA_L2__A_elevA_L3'); // L1 L2 | L3 L4
    });
    expect(codes(result.errors)).toEqual([[E.elevatorGroupSplit, 'n_A_elevA_L1']]);
    expect(result.errors[0]!.message).toContain('n_A_elevA_L3');
    expect(result.errors[0]!.message).toContain('n_A_elevA_L4');
  });

  it('E11: a schema-invalid elevator edge still joins its stops, but a real gap is still a split', () => {
    // Invalid but joining L1–L2 (only from / to are read): one schema error, no split.
    const invalid = broken(({ get }) => {
      get('e_A_elevA_L1__A_elevA_L2').properties.step_free = 'yes';
    });
    expect(codes(invalid.errors)).toEqual([[E.schema, 'e_A_elevA_L1__A_elevA_L2']]);
    // The same invalid edge plus a missing L2–L3 edge: the schema error and the split, both.
    const gap = broken(({ get, remove }) => {
      get('e_A_elevA_L1__A_elevA_L2').properties.step_free = 'yes';
      remove('e_A_elevA_L2__A_elevA_L3'); // L1 L2 | L3 L4
    });
    expect(codes(gap.errors)).toEqual([[E.schema, 'e_A_elevA_L1__A_elevA_L2'], [E.elevatorGroupSplit, 'n_A_elevA_L1']]);
    expect(gap.errors[1]!.message).toContain('n_A_elevA_L3');
    expect(gap.errors[1]!.message).toContain('n_A_elevA_L4');
    // An invalid edge whose from / to do not reach the other stops does not join them.
    const elsewhere = broken(({ get }) => {
      const e = get('e_A_elevA_L2__A_elevA_L3');
      e.properties.to = 'n_A_elevA_L2';
      e.properties.step_free = 'yes';
    });
    expect(codes(elsewhere.errors)).toEqual([[E.schema, 'e_A_elevA_L2__A_elevA_L3'], [E.elevatorGroupSplit, 'n_A_elevA_L1']]);
  });
});

describe('validateCampus v0.2 warnings (SPEC-v0.2 §8)', () => {
  it('W5: warns about a door that no corridor reaches', () => {
    const result = broken(({ remove }) => {
      remove('e_A_4_hall__A_4_408door'); // the north entrance edge is left
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.doorNotOnCorridor, 'n_A_4_408door']]);
  });

  it('W6: warns when a room has two front doors', () => {
    const result = broken(({ get, add }) => {
      const hall = get('n_A_4_hall');
      const door = {
        type: 'Feature', id: 'n_A_4_408back', geometry: { type: 'Point', coordinates: [127.00055, 37.00055] },
        properties: { kind: 'node', node_type: 'door', building_id: 'bldg_A', level: 4, room_ref: '408', door_role: 'front', source: 'estimate', rev: 1 },
      };
      add('buildings/A/L4.geojson', door);
      add('buildings/A/L4.geojson', {
        type: 'Feature', id: 'e_A_4_hall__A_4_408back',
        geometry: { type: 'LineString', coordinates: [hall.geometry.coordinates, door.geometry.coordinates] },
        properties: { kind: 'edge', highway: 'corridor', edge_type: 'indoor', step_free: true, from: 'n_A_4_hall', to: 'n_A_4_408back', bidirectional: true, source: 'estimate', rev: 1 },
      });
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.duplicateFrontDoor, 'n_A_4_408back']]);
    expect(result.warnings[0]!.message).toContain('n_A_4_408door');
  });

  it('W7: warns about overrides that have expired, and only those', () => {
    const campus = structuredClone(fixture);
    campus.overrides = [
      { feature_id: 'n_A_elevA_L2', status: 'out_of_service', until: '2026-11-10T00:00:00+09:00', report_id: 'rp-1' },
      { feature_id: 'n_A_elevA_L3', status: 'out_of_service', until: '2026-11-12T00:00:00+09:00', report_id: 'rp-2' },
    ];
    const result = validateCampus(campus, { now: new Date('2026-11-11T00:00:00+09:00') });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.expiredOverride, 'n_A_elevA_L2']]);
    expect(result.warnings[0]!.file).toBe('overrides.json');
  });

  it('W14: an override pointing at a missing feature warns, an existing one does not', () => {
    const campus = structuredClone(fixture);
    campus.overrides = [
      { feature_id: 'n_A_elevA_L2', status: 'out_of_service', until: '2026-11-12T00:00:00+09:00', report_id: 'rp-1' },
      { feature_id: 'n_no_such_node', status: 'out_of_service', until: '2026-11-12T00:00:00+09:00', report_id: 'rp-2' },
    ];
    const result = validateCampus(campus, { now: new Date('2026-11-11T00:00:00+09:00') });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.danglingOverride, 'n_no_such_node']]);
    expect(result.warnings[0]!.message).toContain('overrides.json에서 이 항목을 지우세요');
  });

  it('W8: warns about an elevator stop with no way out into a corridor', () => {
    const result = broken(({ remove }) => {
      remove('e_A_2_hall__A_elevA_L2'); // the routes to 408 and 201 do not use the 2F stop
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.elevatorDeadEnd, 'n_A_elevA_L2']]);
  });

  it('W9: warns when every stop of an elevator is on the same level', () => {
    const result = broken(({ get, add }) => {
      const hall = get('n_B_1_hall');
      const stop = (id: string) => ({
        type: 'Feature', id, geometry: { type: 'Point', coordinates: [127.00125, 37.00045] },
        properties: { kind: 'node', node_type: 'elevator_stop', building_id: 'bldg_B', level: 1, elevator_id: 'B_elevA', source: 'estimate', rev: 1 },
      });
      const edge = (id: string, from: AnyFeature, to: AnyFeature, highway: string, extra = {}) => ({
        type: 'Feature', id, geometry: { type: 'LineString', coordinates: [from.geometry.coordinates, to.geometry.coordinates] },
        properties: { kind: 'edge', highway, edge_type: 'indoor', step_free: true, from: from.id, to: to.id, bidirectional: true, source: 'estimate', rev: 1, ...extra },
      });
      const [one, two] = [stop('n_B_1_lift1'), stop('n_B_1_lift2')];
      add('buildings/B/L1.geojson', one);
      add('buildings/B/L1.geojson', two);
      add('buildings/B/L1.geojson', edge('e_B_1_lift1__B_1_lift2', one, two, 'elevator', { level_from: 1, level_to: 1 }));
      add('buildings/B/L1.geojson', edge('e_B_1_hall__B_1_lift1', hall, one, 'corridor'));
      add('buildings/B/L1.geojson', edge('e_B_1_hall__B_1_lift2', hall, two, 'corridor'));
    });
    expect(result.errors).toEqual([]);
    expect(codes(result.warnings)).toEqual([[W.elevatorSingleLevel, 'n_B_1_lift1']]);
  });

  it('W10: warns about a bridge whose two ends are in the same building', () => {
    const result = broken(({ get }) => {
      get('e_A_3_north__C_5_bridge').properties.to = 'n_A_3_hall';
      get('e_A_3_north__C_5_bridge').geometry.coordinates[1] = get('n_A_3_hall').geometry.coordinates;
    });
    expect(codes(result.warnings)).toEqual([[W.bridgeSameBuilding, 'e_A_3_north__C_5_bridge']]);
  });
});

describe('schema v0.2: flight_sec (SPEC-v0.2 3.1)', () => {
  it('has a flight_sec on one fixture flight, and validates clean', () => {
    const edge = fixture.features.map((f) => f.feature as AnyFeature).find((f) => f.id === 'e_B_1_stair__B_2_stair');
    expect(edge.properties).toMatchObject({ highway: 'steps', edge_type: 'indoor', incline: 'up', flight_sec: 20 });
    expect(validateCampus(fixture)).toEqual({ errors: [], warnings: [] });
  });

  it('accepts 0 and 30 and rejects anything outside 0 to 30', () => {
    for (const ok of [0, 30, 12.5]) {
      const result = broken(({ get }) => {
        get('e_B_1_stair__B_2_stair').properties.flight_sec = ok;
      });
      expect(result.errors, `flight_sec ${ok}`).toEqual([]);
    }
    for (const bad of [-1, 31, 'fast']) {
      const result = broken(({ get }) => {
        get('e_B_1_stair__B_2_stair').properties.flight_sec = bad;
      });
      expect(codes(result.errors), `flight_sec ${bad}`).toEqual([[E.schema, 'e_B_1_stair__B_2_stair']]);
    }
  });

  it('allows flight_sec on indoor steps only', () => {
    const result = broken(({ get }) => {
      get('e_out_0002__out_0003').properties.flight_sec = 10; // outdoor steps
      get('e_out_0001__out_0002').properties.flight_sec = 10; // a footway
      get('e_A_1_hall__A_elevA_L1').properties.flight_sec = 10; // a corridor
    });
    expect(codes(result.errors).filter(([code]) => code === E.schema)).toEqual([
      [E.schema, 'e_A_1_hall__A_elevA_L1'],
      [E.schema, 'e_out_0001__out_0002'],
      [E.schema, 'e_out_0002__out_0003'],
    ]);
  });
});

describe('escalators and measurements (SPEC-v0.2 2.7, 3.9, 8)', () => {
  const obs = (target: string, extra: object = {}) => ({
    target, duration_sec: 21, source: 'field', measured_at: '2026-11-12T09:10:00+09:00', ...extra,
  });

  it('the fixture has an indoor pair and an outdoor escalator and validates clean', () => {
    const props = (id: string) => (fixture.features.map((f) => f.feature as AnyFeature).find((f) => f.id === id)).properties;
    expect(props('e_A_1_esc__A_2_esc_up')).toMatchObject({ highway: 'steps', conveying: 'forward', bidirectional: false, step_free: false });
    expect(props('e_A_1_esc__A_2_esc_down')).toMatchObject({ highway: 'steps', conveying: 'backward', bidirectional: false });
    expect(props('e_out_0002__out_0003_esc')).toMatchObject({ edge_type: 'outdoor', conveying: 'forward' });
    expect(validateCampus(fixture)).toEqual({ errors: [], warnings: [] });
  });

  it('E12: an escalator whose step_free is not false is an error (null and true)', () => {
    for (const value of [null, true]) {
      const result = broken(({ get }) => {
        get('e_A_1_esc__A_2_esc_up').properties.step_free = value;
      });
      expect(codes(result.errors), `step_free ${String(value)}`).toEqual([[E.escalatorNotStepFree, 'e_A_1_esc__A_2_esc_up']]);
    }
  });

  it('E13: an elevator edge whose ends are not elevator stops is an error (the old hand-drawn lift)', () => {
    const result = broken(({ get }) => {
      get('e_A_elevA_L1__A_elevA_L2').properties.from = 'n_A_1_hall';
      get('e_A_elevA_L1__A_elevA_L2').geometry.coordinates[0] = get('n_A_1_hall').geometry.coordinates;
    });
    expect(codes(result.errors)).toContainEqual([E.elevatorEdgeNotStops, 'e_A_elevA_L1__A_elevA_L2']);
    expect(result.errors.find((e) => e.code === E.elevatorEdgeNotStops)!.message).toContain('엘리베이터 도구로 다시 만드세요');
  });

  it('W12: an indoor escalator that stays on one floor warns; the outdoor one never does', () => {
    const result = broken(({ get }) => {
      // Move the upper end onto the lower floor (a node on A 1F), so both ends share a scope.
      const edge = get('e_A_1_esc__A_2_esc_up');
      edge.properties.to = 'n_A_1_stair';
      edge.properties.level_to = 1;
      edge.geometry.coordinates[1] = get('n_A_1_stair').geometry.coordinates;
    });
    expect(codes(result.warnings)).toContainEqual([W.escalatorSameScope, 'e_A_1_esc__A_2_esc_up']);
    expect(result.warnings.filter((w) => w.code === W.escalatorSameScope)).toHaveLength(1);
  });

  it('schema: conveying on an elevator is rejected', () => {
    for (const id of ['e_A_elevA_L1__A_elevA_L2']) {
      const result = broken(({ get }) => {
        get(id).properties.conveying = 'forward';
        get(id).properties.bidirectional = false;
      });
      // Only the schema error: E11 joins stops by from / to even over a schema-invalid edge.
      expect(codes(result.errors)).toEqual([[E.schema, id]]);
    }
  });

  it('schema: forward / backward need bidirectional false, reversible needs true', () => {
    const forward = broken(({ get }) => { get('e_A_1_esc__A_2_esc_up').properties.bidirectional = true; });
    expect(codes(forward.errors)).toEqual([[E.schema, 'e_A_1_esc__A_2_esc_up']]);
    const reversibleOneWay = broken(({ get }) => { get('e_A_1_esc__A_2_esc_up').properties.conveying = 'reversible'; });
    expect(codes(reversibleOneWay.errors)).toEqual([[E.schema, 'e_A_1_esc__A_2_esc_up']]);
    const reversible = broken(({ get }) => {
      get('e_A_1_esc__A_2_esc_up').properties.conveying = 'reversible';
      get('e_A_1_esc__A_2_esc_up').properties.bidirectional = true;
    });
    expect(reversible.errors).toEqual([]);
  });

  it('schema: an unknown conveying value is rejected', () => {
    const result = broken(({ get }) => { get('e_A_1_esc__A_2_esc_up').properties.conveying = 'sideways'; });
    expect(codes(result.errors)).toEqual([[E.schema, 'e_A_1_esc__A_2_esc_up']]);
  });

  it('W13: a measurement of an existing edge or elevator is fine, an unknown one warns', () => {
    const ok = broken(({ campus }) => {
      campus.observations = [
        { file: 'observations/a.jsonl', line: 1, record: obs('edge:e_A_1_esc__A_2_esc_up') },
        { file: 'observations/a.jsonl', line: 2, record: obs('elevator:A_elevA') },
      ];
    });
    expect(ok).toEqual({ errors: [], warnings: [] });

    const bad = broken(({ campus }) => {
      campus.observations = [
        { file: 'observations/a.jsonl', line: 1, record: obs('edge:e_nope') },
        { file: 'observations/a.jsonl', line: 2, record: obs('elevator:nope') },
      ];
    });
    expect(bad.errors).toEqual([]);
    expect(bad.warnings.map((w) => w.code)).toEqual([W.observationUnknownTarget, W.observationUnknownTarget]);
  });

  it('an observation line breaks the schema when it has an unknown field, a bad time or no source', () => {
    const cases: object[] = [
      obs('edge:e_A_1_esc__A_2_esc_up', { user_id: 'u1' }),
      obs('edge:e_A_1_esc__A_2_esc_up', { duration_sec: 0 }),
      obs('edge:e_A_1_esc__A_2_esc_up', { measured_at: 'yesterday' }),
      obs('edge:e_A_1_esc__A_2_esc_up', { source: 'friend' }),
      obs('stairs:x'),
      { target: 'edge:e_A_1_esc__A_2_esc_up', duration_sec: 20, measured_at: '2026-11-12T09:10:00+09:00' },
    ];
    for (const record of cases) {
      const result = broken(({ campus }) => {
        campus.observations = [{ file: 'observations/a.jsonl', line: 7, record }];
      });
      expect(codes(result.errors)).toEqual([[E.schema, null]]);
      expect(result.errors[0]!.file).toBe('observations/a.jsonl:7');
    }
  });

  it('a calibration.json that breaks the schema is an error', () => {
    const good = { 'edge:e_A_1_esc__A_2_esc_up': { prior_sec: 19, median_sec: 22, n: 5, estimate_sec: 20.9, updated_at: '2026-11-12' } };
    expect(broken(({ campus }) => { campus.calibration = good; }).errors).toEqual([]);
    for (const bad of [
      { 'edge:x': { ...good['edge:e_A_1_esc__A_2_esc_up'], n: 0 } },
      { 'edge:x': { prior_sec: 19 } },
      { 'nonsense': good['edge:e_A_1_esc__A_2_esc_up'] },
      [],
    ]) {
      const result = broken(({ campus }) => { campus.calibration = bad; });
      expect(codes(result.errors)).toEqual([[E.schema, null]]);
    }
  });

  it('parseCampus reads observations/*.jsonl line by line and reports a broken line with its number', () => {
    const line = JSON.stringify(obs('edge:e_A_1_esc__A_2_esc_up'));
    const campus = parseCampus([
      { path: 'observations/a.jsonl', text: `${line}\n\nnot json\n${line}\n` },
      { path: 'calibration.json', text: '{}' },
    ]);
    expect(campus.observations?.map((o) => [o.file, o.line])).toEqual([['observations/a.jsonl', 1], ['observations/a.jsonl', 4]]);
    expect(campus.fileErrors.map((e) => e.file)).toEqual(['observations/a.jsonl:3']);
    expect(campus.calibration).toEqual({});
  });
});
