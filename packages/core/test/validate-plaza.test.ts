// Checks on plazas (평지) that join points: a point standing on a plaza that meets the network is neither an unused point
// (W1) nor a cut-off piece (W2), and a plaza step-free walk counts for W4. A plaza that meets nothing joins nothing.
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { WARNING_CODES as W, validateCampus, type LoadedCampus, type Position } from '../src/index.ts';
import { loadCampus } from '../src/node/index.ts';
import { F, P, rect } from './plaza/helpers.ts';

let fixture: LoadedCampus;
beforeAll(async () => {
  fixture = await loadCampus(fileURLToPath(new URL('./fixtures/campus-plaza', import.meta.url)));
});

const node = (id: string, at: Position, extra: Record<string, unknown> = {}) => ({
  type: 'Feature', id, geometry: { type: 'Point', coordinates: at },
  properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', rev: 1, ...extra },
});
const edge = (id: string, from: Position, to: Position, ids: [string, string], extra: Record<string, unknown> = {}) => ({
  type: 'Feature', id, geometry: { type: 'LineString', coordinates: [from, to] },
  properties: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: ids[0], to: ids[1], bidirectional: true, step_free: true, source: 'estimate', rev: 1, ...extra },
});
const plaza = (id: string, ring: Position[]) => ({ type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [ring] }, properties: { kind: 'plaza', source: 'estimate', rev: 1 } });

function check(...features: unknown[]) {
  const campus = structuredClone(fixture);
  for (const feature of features) campus.features.push({ file: 'outdoor.geojson', feature: feature as never });
  return validateCampus(campus);
}
const warned = (r: ReturnType<typeof validateCampus>, code: string) => r.warnings.filter((w) => w.code === code).map((w) => w.featureId);

describe('validate with plazas joining points', () => {
  const east = F.toXY([127.000450428, 37])[0];

  it('the fixture is clean of W1 / W2', () => {
    const r = check();
    expect(warned(r, W.isolatedNode)).toEqual([]);
    expect(warned(r, W.disconnectedComponent)).toEqual([]);
  });

  it('a point on 분수 광장 without an edge is not unused; a road meeting only the plaza is not cut off', () => {
    const r = check(
      node('n_on_plaza', P(10, 15)),
      node('n_e1', P(east, 25)), node('n_e2', P(east + 20, 25)), edge('e_east', P(east, 25), P(east + 20, 25), ['n_e1', 'n_e2']),
    );
    expect(warned(r, W.isolatedNode)).toEqual([]);
    expect(warned(r, W.disconnectedComponent)).toEqual([]);
  });

  it('a plaza that meets nothing joins nothing: its point is unused, its two points with a road are cut off', () => {
    const r = check(
      plaza('plaza_far', rect(200, 200, 220, 220)), node('n_far', P(210, 210)),
      node('n_r1', P(230, 205)), node('n_r2', P(215, 205)), edge('e_far', P(230, 205), P(215, 205), ['n_r1', 'n_r2']),
    );
    expect(warned(r, W.isolatedNode)).toEqual([]);
    expect(warned(r, W.disconnectedComponent)).toEqual(['n_far']);
    const lone = check(plaza('plaza_far', rect(200, 200, 220, 220)), node('n_far', P(210, 210)));
    expect(warned(lone, W.isolatedNode)).toEqual(['n_far']);
  });

  it('W4: a poi on the plaza reaches a classroom door step-free across it', () => {
    const r = check(
      node('n_poi', P(10, 5), { node_type: 'poi', name: '분수대' }),
      node('n_door', P(east + 20, 25), { node_type: 'door', building_id: 'bldg_X', level: 1, space_name: '101호' }),
      node('n_e1', P(east, 25)), edge('e_east', P(east, 25), P(east + 20, 25), ['n_e1', 'n_door']),
    );
    expect(warned(r, W.noStepFreeRoute)).toEqual([]);
  });
});
