import { describe, expect, it } from 'vitest';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { outdoorLines, outdoorPlazas } from '../src/features/map/outdoor.ts';
import { META, bundleFrom, edgeFeature, nodeFeature } from './helpers.ts';

const graphOf = (features: unknown[]) => loadBundledCampus(bundleFrom(META, features)).graph;
const A = nodeFeature('n_a', 127.0, 37.0);
const B = nodeFeature('n_b', 127.001, 37.0);
const C = nodeFeature('n_c', 127.002, 37.0);
const seg = (id: string, from: string, to: string, props: Record<string, unknown> = {}, x = 0) =>
  edgeFeature(id, from, to, [[127.0 + x, 37.0], [127.001 + x, 37.0]], props);
const indoor = (id: string, x: number) => nodeFeature(id, 127.0 + x, 37.0, { node_type: 'indoor', building_id: 'bldg_A', level: 1 });

describe('outdoorLines', () => {
  it('일반 실외 보행로는 walk, 폭 기본 2.0', () => {
    const lines = outdoorLines(graphOf([A, B, seg('e_1', 'n_a', 'n_b')]));
    expect(lines.features).toHaveLength(1);
    expect(lines.features[0]!.properties).toEqual({ id: 'e_1', kind: 'walk', width: 2 });
  });
  it('width_m를 반영한다', () => {
    const lines = outdoorLines(graphOf([A, B, seg('e_1', 'n_a', 'n_b', { width_m: 3.5 })]));
    expect(lines.features[0]!.properties!['width']).toBe(3.5);
  });
  it('steps는 stairs, ramp는 ramp', () => {
    const lines = outdoorLines(graphOf([A, B, C, seg('e_1', 'n_a', 'n_b', { highway: 'steps' }), seg('e_2', 'n_b', 'n_c', { highway: 'ramp' }, 0.001)]));
    expect(lines.features.map((f) => [f.properties!['id'], f.properties!['kind']])).toEqual([['e_1', 'stairs'], ['e_2', 'ramp']]);
  });
  it('실내 노드 사이 엣지는 제외', () => {
    const lines = outdoorLines(graphOf([indoor('n_i1', 0), indoor('n_i2', 0.001), seg('e_1', 'n_i1', 'n_i2', { edge_type: 'indoor', highway: 'corridor' })]));
    expect(lines.features).toHaveLength(0);
  });
  it('실내↔실외 연결 엣지는 제외', () => {
    const lines = outdoorLines(graphOf([A, indoor('n_i1', 0.001), seg('e_1', 'n_a', 'n_i1')]));
    expect(lines.features).toHaveLength(0);
  });
  it('portal 엣지는 제외', () => {
    const lines = outdoorLines(graphOf([A, B, seg('e_1', 'n_a', 'n_b', { edge_type: 'portal' })]));
    expect(lines.features).toHaveLength(0);
  });
  it('양방향 엣지는 한 번만, id 오름차순', () => {
    const lines = outdoorLines(graphOf([A, B, C, seg('e_2', 'n_b', 'n_c', {}, 0.001), seg('e_1', 'n_a', 'n_b')]));
    expect(lines.features.map((f) => f.properties!['id'])).toEqual(['e_1', 'e_2']);
  });
  it('graph가 null이면 빈 컬렉션', () => {
    expect(outdoorLines(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});

describe('outdoorPlazas', () => {
  const outer = [[127.0, 37.0], [127.01, 37.0], [127.01, 37.01], [127.0, 37.01], [127.0, 37.0]];
  const hole = [[127.003, 37.003], [127.003, 37.006], [127.006, 37.006], [127.006, 37.003], [127.003, 37.003]];
  const plaza = (id: string, rings: number[][][], name = '중앙 광장') => ({ type: 'Feature', id, geometry: { type: 'Polygon', coordinates: rings }, properties: { kind: 'plaza', name, source: 'estimate', rev: 1 } });

  it('평지 폴리곤을 구멍과 함께 돌려준다', () => {
    const areas = outdoorPlazas(graphOf([plaza('pl_1', [outer, hole])]));
    expect(areas.features).toHaveLength(1);
    expect(areas.features[0]!.geometry.type).toBe('Polygon');
    expect(areas.features[0]!.geometry.coordinates).toHaveLength(2);
    expect(areas.features[0]!.properties).toEqual({ id: 'pl_1', name: '중앙 광장', surface: null });
  });
  it('graph가 null이면 빈 컬렉션', () => {
    expect(outdoorPlazas(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
