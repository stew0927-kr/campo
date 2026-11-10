import { describe, expect, it } from 'vitest';
import { isValidFeature, parseCampus, validateCampus, type Position } from '@campo/core';
import { addBuilding, buildingAt, parseLevels } from '../src/model/building.ts';
import { defaultMeta, type CampusDoc } from '../src/model/document.ts';
import { docToFiles } from '../src/model/files.ts';
import { addElevator, addIndoorNode, addStairs, connectNodes } from '../src/model/indoor.ts';
import { addOutdoorPath } from '../src/model/outdoor-path.ts';
import { inScope, type Scope } from '../src/model/scope.ts';

const empty = (): CampusDoc => ({ campusId: 't', meta: defaultMeta('t'), features: new Map(), passthrough: [] });
const RING: Position[] = [[127.0004, 37.0003], [127.0009, 37.0003], [127.0009, 37.0007], [127.0004, 37.0007]];

/** Unwrap a model result, failing the test with its Korean message. */
function ok<T extends object>(r: T | { error: string }): T {
  if ('error' in r) throw new Error(r.error);
  return r;
}

function withA(levels = [1, 2, 3, 4], groundLevels = [1, 4]): CampusDoc {
  return ok(addBuilding(empty(), { ring: RING, name: 'A동', code: 'A', levels, groundLevels })).doc;
}

describe('parseLevels', () => {
  it('reads ranges and lists, skipping 0', () => {
    expect(parseLevels('1-4')).toEqual({ levels: [1, 2, 3, 4] });
    expect(parseLevels('-2~2')).toEqual({ levels: [-2, -1, 1, 2] });
    expect(parseLevels('4, 1')).toEqual({ levels: [1, 4] });
  });
  it('refuses 0 and junk with a Korean message', () => {
    expect(parseLevels('0')).toHaveProperty('error');
    expect(parseLevels('1층')).toHaveProperty('error');
    expect(parseLevels(' ')).toHaveProperty('error');
  });
});

describe('건물 도구', () => {
  it('creates a valid building feature with a closed ring', () => {
    const doc = withA();
    const b = doc.features.get('bldg_A')!;
    expect(isValidFeature(b)).toBe(true);
    expect(b.geometry.coordinates[0]).toHaveLength(5);
    expect(b.properties).toMatchObject({ name: 'A동', code: 'A', levels: [1, 2, 3, 4], ground_levels: [1, 4] });
  });
  it('refuses bad codes, duplicates and ground levels outside the level list', () => {
    expect(addBuilding(empty(), { ring: RING, name: 'A', code: 'A-1', levels: [1], groundLevels: [1] })).toHaveProperty('error');
    expect(addBuilding(withA(), { ring: RING, name: 'A', code: 'A', levels: [1], groundLevels: [1] })).toHaveProperty('error');
    expect(addBuilding(empty(), { ring: RING, name: 'A', code: 'A', levels: [1, 2], groundLevels: [3] })).toHaveProperty('error');
  });
  it('finds the building under a click', () => {
    const doc = withA();
    expect(buildingAt(doc, [127.0006, 37.0005])?.id).toBe('bldg_A');
    expect(buildingAt(doc, [127.0, 37.0])).toBeUndefined();
  });
});

describe('엘리베이터·계단 도구', () => {
  it('elevator: one stop per checked level at one spot, edges between neighbouring stops', () => {
    const r = ok(addElevator(withA(), { buildingId: 'bldg_A', position: [127.0008, 37.0005], levels: [4, 1, 2, 3] }));
    expect(r.nodeIds).toEqual(['n_A_elevA_L1', 'n_A_elevA_L2', 'n_A_elevA_L3', 'n_A_elevA_L4']);
    expect(r.edgeIds).toEqual(['e_A_elevA_L1__A_elevA_L2', 'e_A_elevA_L2__A_elevA_L3', 'e_A_elevA_L3__A_elevA_L4']);
    expect(r.doc.features.get('e_A_elevA_L2__A_elevA_L3')!.properties).toMatchObject({ highway: 'elevator', edge_type: 'indoor', level_from: 2, level_to: 3 });
    expect(r.doc.features.get('n_A_elevA_L3')!.properties).toMatchObject({ node_type: 'elevator_stop', shaft_id: 'A_elevA', level: 3 });
  });

  it('elevator skipping a floor joins the stops it does serve', () => {
    const r = ok(addElevator(withA(), { buildingId: 'bldg_A', position: [127.0008, 37.0005], levels: [1, 3, 4] }));
    expect(r.edgeIds).toEqual(['e_A_elevA_L1__A_elevA_L3', 'e_A_elevA_L3__A_elevA_L4']);
  });

  it('a second elevator gets the next letter', () => {
    const one = ok(addElevator(withA(), { buildingId: 'bldg_A', position: [127.0008, 37.0005], levels: [1, 2] })).doc;
    expect(ok(addElevator(one, { buildingId: 'bldg_A', position: [127.0005, 37.0005], levels: [1, 2] })).nodeIds[0]).toBe('n_A_elevB_L1');
  });

  it('stairs: one steps edge per floor, in either direction, across a basement', () => {
    const doc = withA([-1, 1, 2], [1]);
    const r = ok(addStairs(doc, { buildingId: 'bldg_A', position: [127.0007, 37.0004], from: 2, to: -1 }));
    expect(r.nodeIds).toEqual(['n_A_-1_stairA', 'n_A_1_stairA', 'n_A_2_stairA']);
    expect(r.edgeIds).toHaveLength(2);
    expect(r.doc.features.get(r.edgeIds[0]!)!.properties).toMatchObject({ highway: 'steps', edge_type: 'indoor', level_from: -1, level_to: 1, step_free: false });
  });

  it('refuses one-stop elevators and same-floor stairs', () => {
    expect(addElevator(withA(), { buildingId: 'bldg_A', position: [0, 0], levels: [2] })).toHaveProperty('error');
    expect(addStairs(withA(), { buildingId: 'bldg_A', position: [0, 0], from: 2, to: 2 })).toHaveProperty('error');
  });
});

describe('지점 추가·잇기 도구', () => {
  it('names nodes by SPEC §4.4 and keeps them unique', () => {
    let doc = withA();
    const a = ok(addIndoorNode(doc, { buildingId: 'bldg_A', level: 3, kind: 'corridor', position: [127.0006, 37.0005] }));
    const b = ok(addIndoorNode(a.doc, { buildingId: 'bldg_A', level: 3, kind: 'corridor', position: [127.0007, 37.0005] }));
    const c = ok(addIndoorNode(b.doc, { buildingId: 'bldg_A', level: 4, kind: 'classroom', ref: '408', position: [127.0005, 37.0006] }));
    doc = c.doc;
    expect([a.id, b.id, c.id]).toEqual(['n_A_3_hall', 'n_A_3_hall2', 'n_A_4_408door']);
    expect(doc.features.get('n_A_4_408door')!.properties).toMatchObject({ node_type: 'door', ref: '408', space_name: '408호 강의실', level: 4 });
  });

  it('connects nodes on one floor with a corridor, and refuses to jump floors or leave the building', () => {
    let doc = withA();
    doc = ok(addIndoorNode(doc, { buildingId: 'bldg_A', level: 1, kind: 'corridor', position: [127.0006, 37.0005] })).doc;
    doc = ok(addIndoorNode(doc, { buildingId: 'bldg_A', level: 1, kind: 'entrance', position: [127.0004, 37.0004] })).doc;
    doc = ok(addIndoorNode(doc, { buildingId: 'bldg_A', level: 2, kind: 'corridor', position: [127.0006, 37.0005] })).doc;
    doc = addOutdoorPath(doc, [{ position: [127.0002, 37.0004] }, { position: [127.0001, 37.0004] }], 'flat').doc;

    const r = ok(connectNodes(doc, 'n_A_1_entrance', 'n_A_1_hall'));
    expect(r.id).toBe('e_A_1_entrance__A_1_hall');
    expect(r.doc.features.get(r.id)!.properties).toMatchObject({ highway: 'corridor', edge_type: 'indoor', step_free: false });
    expect(connectNodes(r.doc, 'n_A_1_hall', 'n_A_1_entrance')).toEqual({ error: '두 지점은 이미 이어져 있습니다.' });
    expect(connectNodes(doc, 'n_A_1_hall', 'n_A_2_hall')).toHaveProperty('error');
    expect(connectNodes(doc, 'n_A_1_entrance', 'n_out_0001')).toHaveProperty('error');
  });
});

describe('fixture-shaped A동 built with the tools', () => {
  it('saves under buildings/A/ and only misses the portals (next task)', () => {
    let doc = withA();
    const step = <T extends { doc: CampusDoc }>(r: T | { error: string }): T => {
      const v = ok(r);
      doc = v.doc;
      return v;
    };
    step(addElevator(doc, { buildingId: 'bldg_A', position: [127.0008, 37.0005], levels: [1, 2, 3, 4] }));
    step(addStairs(doc, { buildingId: 'bldg_A', position: [127.0007, 37.0004], from: 1, to: 4 }));
    for (const level of [1, 2, 3, 4]) {
      step(addIndoorNode(doc, { buildingId: 'bldg_A', level, kind: 'corridor', position: [127.0006, 37.0005] }));
      step(connectNodes(doc, `n_A_${level}_hall`, `n_A_elevA_L${level}`));
      step(connectNodes(doc, `n_A_${level}_hall`, `n_A_${level}_stairA`));
    }
    step(addIndoorNode(doc, { buildingId: 'bldg_A', level: 1, kind: 'entrance', position: [127.0004, 37.0004] }));
    step(connectNodes(doc, 'n_A_1_entrance', 'n_A_1_hall'));
    step(addIndoorNode(doc, { buildingId: 'bldg_A', level: 4, kind: 'entrance', position: [127.0005, 37.0007] }));
    step(connectNodes(doc, 'n_A_4_entrance', 'n_A_4_hall'));
    step(addIndoorNode(doc, { buildingId: 'bldg_A', level: 4, kind: 'classroom', ref: '408', position: [127.0005, 37.0006] }));
    step(connectNodes(doc, 'n_A_4_hall', 'n_A_4_408door'));

    const files = docToFiles(doc);
    expect(Object.keys(files).sort()).toEqual([
      'buildings/A/L1.geojson', 'buildings/A/L2.geojson', 'buildings/A/L3.geojson', 'buildings/A/L4.geojson',
      'buildings/A/building.geojson', 'campus.json',
    ]);
    // Cross-floor edges live in the lower floor's file (SPEC §4.3).
    expect(files['buildings/A/L1.geojson']).toContain('"id":"e_A_elevA_L1__A_elevA_L2"');
    expect(files['buildings/A/L3.geojson']).toContain('"id":"e_A_3_stairA__A_4_stairA"');
    expect(files['buildings/A/L4.geojson']).not.toContain('"highway":"elevator"');

    const { errors, warnings } = validateCampus(parseCampus(Object.entries(files).map(([path, text]) => ({ path, text }))));
    expect(errors.map((e) => [e.code, e.featureId])).toEqual([
      ['entrance-without-portal', 'n_A_1_entrance'],
      ['entrance-without-portal', 'n_A_4_entrance'],
    ]);
    expect(warnings).toEqual([]);
  });
});

describe('scope (고른 층만 진하게)', () => {
  it('emphasises the chosen floor, including stairs and elevators that leave it', () => {
    let doc = withA();
    doc = ok(addElevator(doc, { buildingId: 'bldg_A', position: [127.0008, 37.0005], levels: [1, 2, 3] })).doc;
    const floor2: Scope = { kind: 'building', buildingId: 'bldg_A', level: 2 };
    const strong = [...doc.features.values()].filter((f) => inScope(f, floor2, doc)).map((f) => f.id).sort();
    expect(strong).toEqual(['bldg_A', 'e_A_elevA_L1__A_elevA_L2', 'e_A_elevA_L2__A_elevA_L3', 'n_A_elevA_L2']);
  });
});
