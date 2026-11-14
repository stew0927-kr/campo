// The campus the e2e tests start from: one building "A동" (floors 1-4, ground floor 1) with an entrance joined to an outdoor point.
// Written to a temporary folder before each run; the tests save into it.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PORT = 5199;
export const E2E_DIR = join(tmpdir(), 'campo-e2e');
export const CAMPUS_IDS = ['e2e-floor', 'e2e-scope', 'e2e-escalator', 'e2e-copy', 'e2e-building', 'e2e-sync', 'e2e-osm'] as const;

/** The map centre and the building outline (lng, lat). */
export const CENTER: [number, number] = [127.0005, 37.0003];
export const BUILDING: [number, number][] = [[127, 37], [127.001, 37], [127.001, 37.0006], [127, 37.0006], [127, 37]];
export const ENTRANCE: [number, number] = [127.0005, 37.00005];
export const OUTDOOR_POINT: [number, number] = [127.0005, 36.9996];

const lines = (features: unknown[]) => `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;

const ELEV = 'A_elevA';
const node = (id: string, coord: [number, number], props: object) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: coord }, properties: { kind: 'node', source: 'estimate', rev: 1, ...props } });
const corridor = (id: string, from: string, a: [number, number], to: string, b: [number, number], extra: object = {}) => ({
  type: 'Feature', id, geometry: { type: 'LineString', coordinates: [a, b] },
  properties: { kind: 'edge', highway: 'corridor', edge_type: 'indoor', step_free: null, from, to, bidirectional: true, source: 'estimate', rev: 1, ...extra },
});

/** e2e-escalator: A동 1-2층, a corridor on each floor, a classroom door at each end of the trip, and one elevator. No escalator yet: the test draws it. */
const Y = 37.0003;
export const ESCALATOR = {
  lowerStart: [127.0001, Y] as [number, number],
  upperStart: [127.0003, Y] as [number, number],
  from: '101호 강의실 (A동 1층)',
  to: '201호 강의실 (A동 2층)',
};
function seedEscalatorCampus(dir: string): void {
  const c1a: [number, number] = ESCALATOR.lowerStart;
  const c1b: [number, number] = [127.0009, Y];
  const c2a: [number, number] = ESCALATOR.upperStart;
  const c2b: [number, number] = [127.0009, Y];
  const d1: [number, number] = [127.0001, Y + 0.00004];
  const d2: [number, number] = [127.00085, Y + 0.00004];
  const lift: [number, number] = [127.0009, Y + 0.00015];
  const floor = (level: number) => ({ building_id: 'bldg_A', level });
  const l1 = [
    node('n_A_1_c1a', c1a, { node_type: 'corridor', ...floor(1) }),
    node('n_A_1_c1b', c1b, { node_type: 'corridor', ...floor(1) }),
    node('n_A_1_door101', d1, { node_type: 'door', ...floor(1), ref: '101', space_name: '101호 강의실' }),
    node('n_A_elevA_L1', lift, { node_type: 'elevator_stop', ...floor(1), elevator_id: ELEV }),
    corridor('e_A_1_c1a__c1b', 'n_A_1_c1a', c1a, 'n_A_1_c1b', c1b),
    corridor('e_A_1_entrance__c1a', 'n_A_1_entrance_seed01', ENTRANCE, 'n_A_1_c1a', c1a),
    corridor('e_A_1_c1a__door101', 'n_A_1_c1a', c1a, 'n_A_1_door101', d1),
    corridor('e_A_1_c1b__elevA', 'n_A_1_c1b', c1b, 'n_A_elevA_L1', lift),
    {
      type: 'Feature', id: 'e_A_elevA_L1__L2', geometry: { type: 'LineString', coordinates: [lift, lift] },
      properties: { kind: 'edge', highway: 'elevator', edge_type: 'indoor', step_free: true, from: 'n_A_elevA_L1', to: 'n_A_elevA_L2', bidirectional: true, level_from: 1, level_to: 2, source: 'estimate', rev: 1 },
    },
  ];
  const l2 = [
    node('n_A_2_c2a', c2a, { node_type: 'corridor', ...floor(2) }),
    node('n_A_2_c2b', c2b, { node_type: 'corridor', ...floor(2) }),
    node('n_A_2_door201', d2, { node_type: 'door', ...floor(2), ref: '201', space_name: '201호 강의실' }),
    node('n_A_elevA_L2', lift, { node_type: 'elevator_stop', ...floor(2), elevator_id: ELEV }),
    corridor('e_A_2_c2a__c2b', 'n_A_2_c2a', c2a, 'n_A_2_c2b', c2b),
    corridor('e_A_2_c2b__door201', 'n_A_2_c2b', c2b, 'n_A_2_door201', d2),
    corridor('e_A_2_c2b__elevA', 'n_A_2_c2b', c2b, 'n_A_elevA_L2', lift),
  ];
  // L1 already holds the entrance (seedCampus): rewrite it with the rest of floor 1.
  const entrance = node('n_A_1_entrance_seed01', ENTRANCE, { node_type: 'entrance', ...floor(1) });
  writeFileSync(join(dir, 'buildings', 'A', 'L1.geojson'), lines([entrance, ...l1]));
  writeFileSync(join(dir, 'buildings', 'A', 'L2.geojson'), lines(l2));
}

/** e2e-copy: A동 1-4층. Only the 1st floor has anything: a straight corridor of 5 points and 4 edges (no entrance, nothing outdoors). */
const COPY_Y = 37.0003;
export const COPY_CORRIDOR: [number, number][] = [0, 1, 2, 3, 4].map((i) => [127.0002 + i * 0.00015, COPY_Y]);
function seedCopyCampus(dir: string): void {
  const ids = COPY_CORRIDOR.map((_, i) => `n_A_1_c${i + 1}`);
  const nodes = COPY_CORRIDOR.map((c, i) => node(ids[i]!, c, { node_type: 'corridor', building_id: 'bldg_A', level: 1 }));
  const edges = COPY_CORRIDOR.slice(1).map((c, i) => corridor(`e_A_1_c${i + 1}__c${i + 2}`, ids[i]!, COPY_CORRIDOR[i]!, ids[i + 1]!, c));
  writeFileSync(join(dir, 'buildings', 'A', 'L1.geojson'), lines([...nodes, ...edges]));
  writeFileSync(join(dir, 'outdoor.geojson'), lines([]));
  writeFileSync(join(dir, 'connections.geojson'), lines([]));
}

export function seedCampus(id: string): void {
  const dir = join(E2E_DIR, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'buildings', 'A'), { recursive: true });
  const meta = {
    id, schema_version: '0.2', name: 'e2e 캠퍼스', center: CENTER, bbox: [126.999, 36.999, 127.002, 37.001],
    map_limits: { bounds: [126.995, 36.995, 127.006, 37.005], min_zoom: 15, max_zoom: 22 },
  };
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
  if (id === 'e2e-escalator') seedEscalatorCampus(dir);
  if (id === 'e2e-copy' || id === 'e2e-sync') seedCopyCampus(dir);
}

// ---- 제보 e2e: the fixture campus under its own id, and the 8 sample reports, all in temporary folders ----
/** Folder the reports tab reads (CAMPO_REPORTS_DIR) and the one changesets are written to (CAMPO_CHANGESETS_DIR). */
export const REPORTS_DIR = join(E2E_DIR, 'reports');
export const CHANGESETS_DIR = join(E2E_DIR, 'changesets');
/** Folder imported field surveys are kept in (CAMPO_SURVEYS_DIR). */
export const SURVEYS_DIR = join(E2E_DIR, 'surveys');
/** Untouched copy of the seeded fixture campus: `npm run apply -- <changeset> --campuses-dir=<E2E_DIR>/pristine --dry-run` works on it, because the editor's save rewrites the copy in E2E_DIR. */
export const PRISTINE_DIR = join(E2E_DIR, 'pristine');
/** The sample reports name this campus id. */
export const REPORTS_CAMPUS = 'fixture-basic';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURE_CAMPUS = join(REPO, 'packages', 'core', 'test', 'fixtures', 'campus-basic');
export const SAMPLE_REPORTS = join(REPO, 'data', 'reports', 'sample');

/** A copy of core's campus-basic fixture as campus "fixture-basic" (twice: the one the tests edit and the pristine one), and the sample reports. data/ is only read. */
export function seedReports(): void {
  for (const dir of [REPORTS_DIR, CHANGESETS_DIR, PRISTINE_DIR, SURVEYS_DIR]) rmSync(dir, { recursive: true, force: true });
  rmSync(join(E2E_DIR, REPORTS_CAMPUS), { recursive: true, force: true });
  cpSync(FIXTURE_CAMPUS, join(E2E_DIR, REPORTS_CAMPUS), { recursive: true });
  cpSync(FIXTURE_CAMPUS, join(PRISTINE_DIR, REPORTS_CAMPUS), { recursive: true });
  cpSync(SAMPLE_REPORTS, REPORTS_DIR, { recursive: true });
  mkdirSync(CHANGESETS_DIR, { recursive: true });
}
