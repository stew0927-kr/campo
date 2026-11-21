import type { BundledCampus } from '../../campus/types.ts';

// Deliberately fictional and opt-in. Never written into data/ or the production bundle.
const positions = [[127.044, 37.5568], [127.045, 37.5572], [127.046, 37.5575]] as const;
const nodes = positions.map((coordinates, i) => ({
  type: 'Feature', id: `demo_${i}`, geometry: { type: 'Point', coordinates },
  properties: { kind: 'node', node_type: 'poi', name: `가상 시험 지점 ${i + 1}`, building_id: null, level: null, source: 'estimate', rev: 1 },
}));
const edges = positions.slice(1).map((position, i) => ({
  type: 'Feature', id: `demo_edge_${i}`, geometry: { type: 'LineString', coordinates: [positions[i], position] },
  properties: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: `demo_${i}`, to: `demo_${i + 1}`, bidirectional: true, step_free: true, source: 'estimate', rev: 1 },
}));
export const DEMO_CAMPUS: BundledCampus = {
  campus: 'app-map-demo', files: [
    { path: 'campus.json', text: JSON.stringify({ id: 'app-map-demo', schema_version: '0.2', name: '가상 경로 시험용 데이터', center: [127.045, 37.5572], bbox: [127.0395, 37.553, 127.0505, 37.5615] }) },
    { path: 'outdoor.geojson', text: JSON.stringify({ type: 'FeatureCollection', features: [...nodes, ...edges] }) },
  ],
};
