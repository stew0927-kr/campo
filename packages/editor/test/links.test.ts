import { describe, expect, it } from 'vitest';
import { buildGraph, findRoute, isValidFeature, validateCampus, type Position } from '@campo/core';
import { addBuilding } from '../src/model/building.ts';
import { defaultMeta, type CampusDoc } from '../src/model/document.ts';
import { docToCampus } from '../src/model/files.ts';
import { addIndoorNode, addStairs, connectNodes } from '../src/model/indoor.ts';
import { addBridge, addOutdoorNode, addPortal, updateProperties } from '../src/model/links.ts';
import { featureCenter, featureScope } from '../src/model/locate.ts';
import { addOutdoorPath } from '../src/model/outdoor-path.ts';
import { routeLine, routePlaces } from '../src/model/places.ts';

function ok<T extends object>(r: T | { error: string }): T {
  if ('error' in r) throw new Error(r.error);
  return r;
}
const ring = (x: number): Position[] => [[x, 37.0003], [x + 0.0004, 37.0003], [x + 0.0004, 37.0007], [x, 37.0007]];

/** A (1–3층, 지면 1) and B (1–2층, 지면 1), each with a 1F entrance and stairs, plus one outdoor path. */
function twoBuildings(): CampusDoc {
  let doc: CampusDoc = { campusId: 't', meta: defaultMeta('t'), features: new Map(), passthrough: [] };
  const step = <T extends { doc: CampusDoc }>(r: T | { error: string }): T => {
    const v = ok(r);
    doc = v.doc;
    return v;
  };
  step(addBuilding(doc, { ring: ring(127.0004), name: 'A동', code: 'A', levels: [1, 2, 3], groundLevels: [1] }));
  step(addBuilding(doc, { ring: ring(127.0010), name: 'B동', code: 'B', levels: [1, 2], groundLevels: [1] }));
  for (const [code, x, top] of [['A', 127.0006, 3], ['B', 127.0012, 2]] as const) {
    step(addStairs(doc, { buildingId: `bldg_${code}`, position: [x + 0.0001, 37.0004], from: 1, to: top }));
    for (let level = 1; level <= top; level++) {
      step(addIndoorNode(doc, { buildingId: `bldg_${code}`, level, kind: 'corridor', position: [x, 37.0005] }));
      step(connectNodes(doc, `n_${code}_${level}_hall`, `n_${code}_${level}_stairA`));
    }
    step(addIndoorNode(doc, { buildingId: `bldg_${code}`, level: 1, kind: 'entrance', position: [x - 0.0002, 37.0004] }));
    step(connectNodes(doc, `n_${code}_1_entrance`, `n_${code}_1_hall`));
  }
  step(addOutdoorPath(doc, [{ position: [127.0001, 37.0004] }, { position: [127.0009, 37.0002] }], 'flat'));
  return doc;
}

describe('포탈 도구', () => {
  it('joins an entrance to an outdoor point as SPEC §4.2 portal, step_free unknown (null) by default', () => {
    const r = ok(addPortal(twoBuildings(), 'n_A_1_entrance', 'n_out_0001'));
    expect(r.id).toBe('e_portal_A_1_entrance');
    const edge = r.doc.features.get(r.id)!;
    expect(isValidFeature(edge)).toBe(true);
    expect(edge.properties).toMatchObject({ highway: 'footway', edge_type: 'portal', step_free: null, rev: 1, from: 'n_A_1_entrance', to: 'n_out_0001' });
  });
  it('refuses non-entrances, indoor targets and duplicates', () => {
    const doc = twoBuildings();
    expect(addPortal(doc, 'n_A_1_hall', 'n_out_0001')).toHaveProperty('error');
    expect(addPortal(doc, 'n_A_1_entrance', 'n_A_1_hall')).toHaveProperty('error');
    const once = ok(addPortal(doc, 'n_A_1_entrance', 'n_out_0001')).doc;
    expect(addPortal(once, 'n_A_1_entrance', 'n_out_0001')).toHaveProperty('error');
  });
});

describe('연결통로 도구', () => {
  it('joins two buildings with building_from/to and level_from/to', () => {
    const r = ok(addBridge(twoBuildings(), 'n_A_3_hall', 'n_B_2_hall'));
    const edge = r.doc.features.get(r.id)!;
    expect(isValidFeature(edge)).toBe(true);
    expect(edge.properties).toMatchObject({
      highway: 'corridor', edge_type: 'bridge', building_from: 'bldg_A', building_to: 'bldg_B', level_from: 3, level_to: 2,
    });
  });
  it('refuses the same building and outdoor points', () => {
    const doc = twoBuildings();
    expect(addBridge(doc, 'n_A_1_hall', 'n_A_2_hall')).toHaveProperty('error');
    expect(addBridge(doc, 'n_A_1_hall', 'n_out_0001')).toHaveProperty('error');
  });
});

describe('출발·도착 후보, 속성, 위치', () => {
  it('adds a named poi and continues outdoor numbering', () => {
    const r = ok(addOutdoorNode(twoBuildings(), [127.0, 37.0], '정문'));
    expect(r.id).toBe('n_out_0003');
    expect(r.doc.features.get(r.id)!.properties).toMatchObject({ node_type: 'poi', name: '정문', building_id: null, level: null });
    expect(addOutdoorNode(twoBuildings(), [127, 37], '  ')).toHaveProperty('error');
  });

  it('edits step_free, needs_check and source without touching the original doc', () => {
    const doc = twoBuildings();
    const edited = updateProperties(doc, 'e_A_1_entrance__A_1_hall', { step_free: true, needs_check: true, source: 'field-survey-2026-11' });
    expect(edited.features.get('e_A_1_entrance__A_1_hall')!.properties).toMatchObject({ step_free: true, needs_check: true, source: 'field-survey-2026-11' });
    expect(doc.features.get('e_A_1_entrance__A_1_hall')!.properties).toMatchObject({ step_free: null });
    const cleared = updateProperties(edited, 'e_A_1_entrance__A_1_hall', { needs_check: false });
    expect(cleared.features.get('e_A_1_entrance__A_1_hall')!.properties).not.toHaveProperty('needs_check');
  });

  it('sets the climb time of an indoor flight within 0-30 s, and puts it back to the default (SPEC-v0.2 3.1)', () => {
    const doc = twoBuildings();
    const id = 'e_A_1_stairA__A_2_stairA';
    expect(doc.features.get(id)!.properties).toMatchObject({ highway: 'steps', edge_type: 'indoor' });
    const set = updateProperties(doc, id, { flight_sec: 25 });
    expect(set.features.get(id)!.properties).toMatchObject({ flight_sec: 25, rev: 2 });
    expect(updateProperties(set, id, { flight_sec: 99 }).features.get(id)!.properties).toMatchObject({ flight_sec: 30 });
    expect(updateProperties(set, id, { flight_sec: -5 }).features.get(id)!.properties).toMatchObject({ flight_sec: 0 });
    const reset = updateProperties(set, id, { flight_sec: null });
    expect(reset.features.get(id)!.properties).not.toHaveProperty('flight_sec');
    expect(isValidFeature(set.features.get(id))).toBe(true);
    // only indoor steps take it: a corridor ignores the edit
    const corridor = 'e_A_1_entrance__A_1_hall';
    expect(updateProperties(doc, corridor, { flight_sec: 25 })).toBe(doc);
  });

  it('adds 1 to rev on every real change, and none for an edit that changes nothing (SPEC-v0.2 §2.5)', () => {
    const id = 'e_A_1_entrance__A_1_hall';
    const doc = twoBuildings();
    expect(doc.features.get(id)!.properties.rev).toBe(1);
    const checked = updateProperties(doc, id, { step_free: true });
    expect(checked.features.get(id)!.properties.rev).toBe(2);
    expect(updateProperties(checked, id, { step_free: true })).toBe(checked); // same value: nothing changes
    const unknown = updateProperties(checked, id, { step_free: null });
    expect(unknown.features.get(id)!.properties).toMatchObject({ step_free: null, rev: 3 }); // back to "not known"
    expect(doc.features.get(id)!.properties.rev).toBe(1);
  });

  it('locates features on their floor (edges on the lower floor)', () => {
    const doc = twoBuildings();
    expect(featureScope(doc.features.get('e_A_2_stairA__A_3_stairA')!, doc)).toEqual({ kind: 'building', buildingId: 'bldg_A', level: 2 });
    expect(featureScope(doc.features.get('bldg_B')!, doc)).toEqual({ kind: 'outdoor' });
    expect(featureCenter(doc.features.get('n_A_1_hall')!)).toEqual([127.0006, 37.0005]);
  });
});

describe('editor data → core checks and routes', () => {
  it('portals clear the entrance errors, and routes come out of core findRoute', () => {
    let doc = twoBuildings();
    expect(validateCampus(docToCampus(doc)).errors.map((e) => e.code)).toEqual(['entrance-without-portal', 'entrance-without-portal']);

    doc = ok(addPortal(doc, 'n_A_1_entrance', 'n_out_0001')).doc;
    doc = ok(addPortal(doc, 'n_B_1_entrance', 'n_out_0002')).doc;
    doc = ok(addBridge(doc, 'n_A_3_hall', 'n_B_2_hall')).doc;
    doc = ok(addIndoorNode(doc, { buildingId: 'bldg_B', level: 2, kind: 'classroom', ref: '201', position: [127.0012, 37.0006] })).doc;
    doc = ok(connectNodes(doc, 'n_B_2_hall', 'n_B_2_201door')).doc;
    const gate = ok(addOutdoorNode(doc, [127.0, 37.0004], '정문'));
    doc = ok(connectNodes(gate.doc, gate.id, 'n_out_0001')).doc;
    expect(validateCampus(docToCampus(doc)).errors).toEqual([]);

    expect(routePlaces(doc).map((p) => p.label)).toEqual(['201호 강의실 (B동 2층)', '정문']);
    const graph = buildGraph(docToCampus(doc));
    const shortest = findRoute(graph, gate.id, 'n_B_2_201door', 'shortest');
    expect(shortest.found).toBe(true);
    if (shortest.found) expect(routeLine(shortest, doc).length).toBe(shortest.nodes.length);
    // The only way between floors here is stairs, so step_free falls back to the fewest-steps route and says
    // how many stairs it could not avoid (SPEC-v0.2 3.4). The drawn edges are step_free null, so they are
    // listed as unchecked and cost a penalty.
    const stepFree = findRoute(graph, gate.id, 'n_B_2_201door', 'step_free');
    expect(stepFree.found).toBe(true);
    if (stepFree.found) {
      expect(stepFree.fallback).toMatchObject({ profile: 'fewest_steps' });
      expect(stepFree.fallback!.stairsCount).toBeGreaterThan(0);
      expect(stepFree.uncertainSegments.length).toBeGreaterThan(0);
    }
  });
});
