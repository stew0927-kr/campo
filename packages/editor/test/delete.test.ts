import { describe, expect, it } from 'vitest';
import { validateCampus, type Position } from '@campo/core';
import { addBuilding } from '../src/model/building.ts';
import { countDeleted, deleteFeature } from '../src/model/delete.ts';
import { defaultMeta, type CampusDoc } from '../src/model/document.ts';
import { docToCampus } from '../src/model/files.ts';
import { addIndoorNode, addStairs, connectNodes } from '../src/model/indoor.ts';
import { addBridge, addPortal } from '../src/model/links.ts';
import { addOutdoorPath } from '../src/model/outdoor-path.ts';

function ok<T extends object>(r: T | { error: string }): T {
  if ('error' in r) throw new Error(r.error);
  return r;
}
const ring = (x: number): Position[] => [[x, 37.0003], [x + 0.0004, 37.0003], [x + 0.0004, 37.0007], [x, 37.0007]];

/** A (1–3층) and B (1–2층), an outdoor path, portals from both entrances and a bridge A↔B. */
function campus(): CampusDoc {
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
  step(addPortal(doc, 'n_A_1_entrance', 'n_out_0001'));
  step(addPortal(doc, 'n_B_1_entrance', 'n_out_0002'));
  step(addBridge(doc, 'n_A_3_hall', 'n_B_2_hall'));
  return doc;
}

/** No error that only appears because something was left pointing at a deleted feature. */
function refErrors(doc: CampusDoc): string[] {
  return validateCampus(docToCampus(doc)).errors
    .filter((e) => e.code === 'dangling-ref' || e.code === 'level-not-in-building')
    .map((e) => `${e.code}:${e.featureId}`);
}

describe('삭제', () => {
  it('deletes a node together with the edges that end at it', () => {
    const doc = campus();
    const { doc: next, deletedIds } = deleteFeature(doc, 'n_A_1_hall');

    expect(deletedIds[0]).toBe('n_A_1_hall');
    expect(deletedIds).toContain('e_A_1_entrance__A_1_hall');
    expect(deletedIds).toContain('e_A_1_hall__A_1_stairA');
    expect(next.features.has('n_A_1_hall')).toBe(false);
    for (const id of deletedIds) expect(next.features.has(id)).toBe(false);

    const edgeEnds = [...next.features.values()]
      .flatMap((f) => (f.properties.kind === 'edge' ? [f.properties.from, f.properties.to] : []));
    expect(edgeEnds).not.toContain('n_A_1_hall');
    // Unrelated pieces stay, and the original document is untouched.
    expect(next.features.has('n_A_2_hall')).toBe(true);
    expect(next.features.has('n_B_1_hall')).toBe(true);
    expect(doc.features.has('n_A_1_hall')).toBe(true);
    expect(refErrors(next)).toEqual([]);
  });

  it('deletes an edge alone', () => {
    const doc = campus();
    const { doc: next, deletedIds } = deleteFeature(doc, 'e_portal_A_1_entrance');

    expect(deletedIds).toEqual(['e_portal_A_1_entrance']);
    expect(next.features.has('e_portal_A_1_entrance')).toBe(false);
    expect(next.features.get('n_A_1_entrance')).toBeDefined();
    expect(next.features.get('n_out_0001')).toBeDefined();
    expect(next.features.size).toBe(doc.features.size - 1);
  });

  it('deletes a building with its nodes, its edges and the bridge to the other building', () => {
    const doc = campus();
    const before = doc.features.size;
    const { doc: next, deletedIds } = deleteFeature(doc, 'bldg_A');

    expect(next.features.has('bldg_A')).toBe(false);
    expect(next.features.has('n_A_1_hall')).toBe(false);
    expect(next.features.has('n_A_3_stairA')).toBe(false);
    expect(deletedIds).toContain('e_A_3_hall__B_2_hall');
    // B동 is untouched.
    expect(next.features.has('bldg_B')).toBe(true);
    expect(next.features.has('n_B_2_hall')).toBe(true);
    expect(deletedIds.length).toBe(before - next.features.size);
    expect(countDeleted(doc, deletedIds).buildings).toBe(1);
    expect(refErrors(next)).toEqual([]);
  });

  it('does nothing for an id the document does not have', () => {
    const doc = campus();
    const r = deleteFeature(doc, 'n_nowhere');
    expect(r.deletedIds).toEqual([]);
    expect(r.doc).toBe(doc);
  });
});
