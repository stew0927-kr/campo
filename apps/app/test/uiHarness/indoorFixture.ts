// Test-only indoor fixture switch. The app's MapScreen imports indoorFixture.json; the harness Vite plugin redirects that
// one import here. Without `?fixture=edge` the original fixture is returned unchanged. With it, the same fixture gets
// harness-only extras that the demo data lacks (never written into src/ or data/):
// - A동 4층: unisex / family / no gender / unknown gender restrooms (unisex is wheelchair-usable),
// - B동: one place whose floor is unknown (level missing),
// - D동: a building with places but no registered floors.
import original from '../../src/features/map/indoorFixture.json';

type File = { path: string; text: string };
const base = original as { campus: string; files: File[] };
const SRC = { source: 'field-survey-2026-11', rev: 1 };
const HALL: [number, number] = [127.0006, 37.0005];
const node = (id: string, coordinates: [number, number], props: Record<string, unknown>) =>
  ({ type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties: { kind: 'node', ...SRC, ...props } });
const edge = (id: string, from: string, to: string, a: [number, number], b: [number, number]) =>
  ({ type: 'Feature', id, geometry: { type: 'LineString', coordinates: [a, b] }, properties: { kind: 'edge', ...SRC, highway: 'corridor', edge_type: 'indoor', step_free: true, from, to, bidirectional: true } });

// Distances from the 4th-floor hall grow in this order: male (existing) < female (existing) < unisex < family < none < unknown.
const RESTROOMS: [string, [number, number], string, Record<string, unknown>][] = [
  ['n_A_4_wc_u', [127.00085, 37.00035], 'A동 4층 공용 화장실', { restroom_gender: 'unisex', wheelchair: 'yes' }],
  ['n_A_4_wc_fam', [127.00088, 37.00032], 'A동 4층 가족 화장실', { restroom_gender: 'family', wheelchair: 'no' }],
  ['n_A_4_wc_none', [127.0004, 37.0003], 'A동 4층 미지정 화장실', { wheelchair: 'no' }],
  ['n_A_4_wc_odd', [127.00038, 37.00028], 'A동 4층 기타 표기 화장실', { restroom_gender: 'gender_x', wheelchair: 'no' }],
];

function withExtras(files: File[]): File[] {
  const out = files.map((file) => ({ ...file }));
  const edit = (path: string, change: (features: unknown[]) => void) => {
    const file = out.find((f) => f.path === path);
    if (!file) throw Error(`harness fixture: ${path} is missing`);
    const json = JSON.parse(file.text) as { features: unknown[] };
    change(json.features);
    file.text = JSON.stringify(json);
  };
  edit('buildings/A/L4.geojson', (features) => {
    for (const [id, xy, name, extra] of RESTROOMS) {
      features.push(node(id, xy, { node_type: 'restroom', building_id: 'bldg_A', level: 4, name, ...extra }));
      features.push(edge(`e_A_4_hall__${id}`, 'n_A_4_hall', id, HALL, xy));
    }
  });
  edit('buildings/B/L2.geojson', (features) => {
    features.push(node('n_B_x_info', [127.00125, 37.00045], { node_type: 'poi', building_id: 'bldg_B', name: 'B동 안내데스크(층 미확인)' }));
    features.push(edge('e_B_2_hall__B_x_info', 'n_B_2_hall', 'n_B_x_info', [127.0012, 37.0005], [127.00125, 37.00045]));
  });
  out.push({ path: 'buildings/D/building.geojson', text: JSON.stringify({ type: 'FeatureCollection', features: [{
    type: 'Feature', id: 'bldg_D', geometry: { type: 'Polygon', coordinates: [[[127.0012, 36.9999], [127.0015, 36.9999], [127.0015, 37.0002], [127.0012, 37.0002], [127.0012, 36.9999]]] },
    properties: { kind: 'building', ...SRC, name: 'D동', code: 'D', levels: [], ground_levels: [] },
  }] }) });
  out.push({ path: 'buildings/D/L0.geojson', text: JSON.stringify({ type: 'FeatureCollection', features: [
    node('n_D_desk', [127.00135, 37.0001], { node_type: 'poi', building_id: 'bldg_D', name: 'D동 임시 안내소' }),
  ] }) });
  return out;
}

const edge_mode = new URLSearchParams(location.search).get('fixture') === 'edge';
export default edge_mode ? { campus: base.campus, files: withExtras(base.files) } : base;
