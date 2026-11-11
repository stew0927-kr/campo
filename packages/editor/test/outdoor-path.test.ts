import { describe, expect, it } from 'vitest';
import { isValidFeature, type CampoFeature, type NodeFeature } from '@campo/core';
import { defaultMeta, type CampusDoc } from '../src/model/document.ts';
import { addOutdoorPath, type PathVertex } from '../src/model/outdoor-path.ts';
import { nearestWithin } from '../src/model/snap.ts';

const empty = (): CampusDoc => ({ campusId: 'test', meta: defaultMeta('test'), features: new Map(), passthrough: [] });
const at = (lng: number, lat: number): PathVertex => ({ position: [lng, lat] });
const all = (doc: CampusDoc) => [...doc.features.values()];

describe('addOutdoorPath (바깥 길 도구)', () => {
  it('turns 4 clicks into 4 outdoor nodes and 3 edges in SPEC §4 format', () => {
    const { doc, nodeIds, edgeIds } = addOutdoorPath(empty(), [at(127.045, 37.557), at(127.0452, 37.557), at(127.0452, 37.5572), at(127.0455, 37.5573)], 'flat');
    expect(nodeIds).toEqual(['n_out_0001', 'n_out_0002', 'n_out_0003', 'n_out_0004']);
    expect(edgeIds).toEqual(['e_out_0001__out_0002', 'e_out_0002__out_0003', 'e_out_0003__out_0004']);
    for (const f of all(doc)) expect(isValidFeature(f), f.id).toBe(true);

    expect(doc.features.get('n_out_0001')).toEqual({
      type: 'Feature', id: 'n_out_0001', geometry: { type: 'Point', coordinates: [127.045, 37.557] },
      properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', rev: 1 },
    });
    expect(doc.features.get('e_out_0001__out_0002')).toEqual({
      type: 'Feature', id: 'e_out_0001__out_0002',
      geometry: { type: 'LineString', coordinates: [[127.045, 37.557], [127.0452, 37.557]] },
      properties: {
        kind: 'edge', highway: 'footway', step_free: null, edge_type: 'outdoor',
        from: 'n_out_0001', to: 'n_out_0002', bidirectional: true, source: 'estimate', rev: 1,
      },
    });
  });

  it('sets highway and the SPEC-v0.2 §2.1 step_free default from the chosen kind', () => {
    const kinds = { flat: ['footway', null], steps: ['steps', false], ramp: ['ramp', null] } as const;
    for (const [kind, [highway, stepFree]] of Object.entries(kinds)) {
      const { doc, edgeIds } = addOutdoorPath(empty(), [at(127, 37), at(127.001, 37)], kind as keyof typeof kinds);
      expect(doc.features.get(edgeIds[0]!)!.properties).toMatchObject({ highway, step_free: stepFree, edge_type: 'outdoor' });
    }
  });

  it('attaches to an existing node instead of creating one, and continues the numbering', () => {
    const first = addOutdoorPath(empty(), [at(127, 37), at(127.001, 37)], 'flat').doc;
    const { doc, nodeIds, edgeIds } = addOutdoorPath(first, [{ nodeId: 'n_out_0002' }, at(127.001, 37.001)], 'steps');
    expect(nodeIds).toEqual(['n_out_0002', 'n_out_0003']);
    expect(edgeIds).toEqual(['e_out_0002__out_0003']);
    const edge = doc.features.get('e_out_0002__out_0003')!;
    // The edge starts exactly on the existing node.
    expect((edge.geometry.coordinates as number[][])[0]).toEqual((first.features.get('n_out_0002') as NodeFeature).geometry.coordinates);
    expect(all(doc).filter((f) => f.properties.kind === 'node')).toHaveLength(3);
  });

  it('gives a second edge between the same two nodes its own id', () => {
    const first = addOutdoorPath(empty(), [at(127, 37), at(127.001, 37)], 'flat').doc;
    const { edgeIds } = addOutdoorPath(first, [{ nodeId: 'n_out_0001' }, { nodeId: 'n_out_0002' }], 'steps');
    expect(edgeIds).toEqual(['e_out_0001__out_0002_2']);
  });

  it('closes a loop onto the first new node and ignores repeated clicks', () => {
    const { nodeIds, edgeIds } = addOutdoorPath(empty(), [at(127, 37), at(127.001, 37), at(127.001, 37), at(127, 37.001), at(127, 37)], 'flat');
    expect(nodeIds).toEqual(['n_out_0001', 'n_out_0002', 'n_out_0003', 'n_out_0001']);
    expect(edgeIds).toHaveLength(3);
  });

  it('draws nothing and leaves the doc unchanged for a single click', () => {
    const before = empty();
    expect(addOutdoorPath(before, [at(127, 37)], 'flat').doc).toBe(before);
  });

  it('does not touch the input doc', () => {
    const before = empty();
    addOutdoorPath(before, [at(127, 37), at(127.001, 37)], 'flat');
    expect(before.features.size).toBe(0);
  });
});

describe('nearestWithin (5px 스냅)', () => {
  const c = (id: string, x: number, y: number) => ({ id, screen: { x, y } });
  it('picks the nearest candidate within 5px', () => {
    expect(nearestWithin([c('a', 104, 100), c('b', 102, 101)], { x: 100, y: 100 })?.id).toBe('b');
    expect(nearestWithin([c('a', 103, 104)], { x: 100, y: 100 })?.id).toBe('a'); // exactly 5px
    expect(nearestWithin([c('a', 104, 104)], { x: 100, y: 100 })).toBeUndefined(); // 5.7px
  });
});

// Keep the type import used even if the tests above change.
export type { CampoFeature };
