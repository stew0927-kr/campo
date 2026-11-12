// The campus the e2e tests start from: one building "A동" (floors 1-4, ground floor 1) with an entrance joined to an outdoor point.
// Written to a temporary folder before each run; the tests save into it.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PORT = 5199;
export const E2E_DIR = join(tmpdir(), 'campo-e2e');
export const CAMPUS_IDS = ['e2e-floor', 'e2e-scope'] as const;

/** The map centre and the building outline (lng, lat). */
export const CENTER: [number, number] = [127.0005, 37.0003];
export const BUILDING: [number, number][] = [[127, 37], [127.001, 37], [127.001, 37.0006], [127, 37.0006], [127, 37]];
export const ENTRANCE: [number, number] = [127.0005, 37.00005];
export const OUTDOOR_POINT: [number, number] = [127.0005, 36.9996];

const lines = (features: unknown[]) => `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;

export function seedCampus(id: string): void {
  const dir = join(E2E_DIR, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'buildings', 'A'), { recursive: true });
  const meta = { id, schema_version: '0.2', name: 'e2e 캠퍼스', center: CENTER, bbox: [126.999, 36.999, 127.002, 37.001] };
  writeFileSync(join(dir, 'campus.json'), JSON.stringify(meta, null, 2) + '\n');
  writeFileSync(join(dir, 'buildings', 'A', 'building.geojson'), lines([
    { type: 'Feature', id: 'bldg_A', geometry: { type: 'Polygon', coordinates: [BUILDING] }, properties: { kind: 'building', name: 'A동', code: 'A', levels: [1, 2, 3, 4], ground_levels: [1], source: 'estimate', rev: 1 } },
  ]));
  writeFileSync(join(dir, 'buildings', 'A', 'L1.geojson'), lines([
    { type: 'Feature', id: 'n_A_1_entrance_seed01', geometry: { type: 'Point', coordinates: ENTRANCE }, properties: { kind: 'node', node_type: 'entrance', building_id: 'bldg_A', level: 1, source: 'estimate', rev: 1 } },
  ]));
  writeFileSync(join(dir, 'outdoor.geojson'), lines([
    { type: 'Feature', id: 'n_out_seed01', geometry: { type: 'Point', coordinates: OUTDOOR_POINT }, properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', rev: 1 } },
  ]));
  writeFileSync(join(dir, 'connections.geojson'), lines([
    {
      type: 'Feature', id: 'e_conn_seed01', geometry: { type: 'LineString', coordinates: [ENTRANCE, OUTDOOR_POINT] },
      properties: { kind: 'edge', highway: 'footway', edge_type: 'portal', step_free: null, from: 'n_A_1_entrance_seed01', to: 'n_out_seed01', bidirectional: true, source: 'estimate', rev: 1 },
    },
  ]));
}
