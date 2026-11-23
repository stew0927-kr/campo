// 개발용 가상 로드뷰 캠퍼스: 실외(정문·갈림길·광장) ↔ 건물 출입구(포털) ↔ 실내(1층 로비·계단·엘리베이터·화장실, 2층 복도·강의실·화장실).
// 지점마다 2~4방향 가상 사진(PhotoRow)을 붙인다. 실제 한양대 길·건물·사진이 아니며 data/에 쓰지 않는다.
// React를 import하지 않는 순수 모듈이라 Node 테스트에서 그대로 읽는다.
import type { BundledCampus } from '../../campus/types.ts';
import type { PhotoCatalog, PhotoRow } from '../../contracts.ts';
import { photoCatalogFromRows } from '../../photos/catalog.ts';
import { demoPhotoUri, headingLabel, type DemoScene } from '../../photos/demoPhotoArt.ts';

const LNG0 = 127.045;
const LAT0 = 37.556;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT0 * Math.PI) / 180);
/** 정문 기준 동쪽 x m, 북쪽 y m → [경도, 위도]. */
const at = (x: number, y: number): [number, number] => [
  Math.round((LNG0 + x / M_PER_DEG_LNG) * 1e7) / 1e7,
  Math.round((LAT0 + y / M_PER_DEG_LAT) * 1e7) / 1e7,
];

const SOURCE = { source: 'estimate', rev: 1 } as const;
const BUILDING = 'bldg_rv_eng';

interface DemoNode {
  id: string;
  xy: [number, number];
  props: Record<string, unknown>;
  /** 이 지점에서 찍은 가상 사진 방향들. 없으면 사진 없음. */
  headings?: number[];
  scene?: DemoScene;
}

const outdoor = (id: string, x: number, y: number, name: string, headings: number[], scene: DemoScene, extra: Record<string, unknown> = {}): DemoNode => ({
  id, xy: [x, y], headings, scene, props: { node_type: 'poi', building_id: null, level: null, name, ...extra },
});
const indoor = (id: string, x: number, y: number, level: number, nodeType: string, name: string | null, headings: number[], scene: DemoScene, extra: Record<string, unknown> = {}): DemoNode => ({
  id, xy: [x, y], headings, scene, props: { node_type: nodeType, building_id: BUILDING, level, ...(name ? { name } : {}), ...extra },
});

/** 지점 id. 테스트와 화면 예시가 같은 이름을 쓴다. */
export const RV = {
  gate: 'rv_gate',
  fork: 'rv_fork',
  hall: 'rv_hall_front',
  plaza: 'rv_plaza',
  plazaWc: 'rv_plaza_wc',
  engFront: 'rv_eng_front',
  entrance: 'rv_e1_entrance',
  lobby: 'rv_e1_lobby',
  wc1: 'rv_e1_wc',
  stair1: 'rv_e1_stair',
  elev1: 'rv_e1_elev',
  stair2: 'rv_e2_stair',
  elev2: 'rv_e2_elev',
  hall2: 'rv_e2_hall',
  room201: 'rv_e2_201',
  wc2: 'rv_e2_wc',
} as const;

const ALL4 = [0, 90, 180, 270];
const NODES: DemoNode[] = [
  outdoor(RV.gate, 0, 0, '가상 정문', ALL4, 'gate'),
  outdoor(RV.fork, 0, 40, '가상 본관 앞 갈림길', ALL4, 'path'),
  outdoor(RV.hall, 0, 90, '가상 본관 앞', [0, 180], 'building'),
  outdoor(RV.plaza, -35, 40, '가상 중앙 광장', ALL4, 'plaza'),
  { id: RV.plazaWc, xy: [-35, 50], headings: [0, 180], scene: 'restroom', props: { node_type: 'restroom', building_id: null, level: null, name: '가상 광장 야외 화장실', restroom_gender: 'unisex', wheelchair: 'no' } },
  outdoor(RV.engFront, 50, 40, '가상 공학관 앞', ALL4, 'building'),
  indoor(RV.entrance, 60, 40, 1, 'entrance', '가상 공학관 1층 출입구', [90, 270], 'lobby'),
  indoor(RV.lobby, 70, 40, 1, 'poi', '가상 공학관 1층 로비', ALL4, 'lobby'),
  indoor(RV.wc1, 70, 28, 1, 'restroom', '가상 공학관 1층 화장실', [0, 180], 'restroom', { restroom_gender: 'unisex', wheelchair: 'yes' }),
  indoor(RV.stair1, 70, 55, 1, 'stair_landing', null, [0, 180], 'stairs'),
  indoor(RV.elev1, 82, 40, 1, 'elevator_stop', null, [90, 270], 'elevator', { elevator_id: 'rv_elev' }),
  indoor(RV.stair2, 70, 55, 2, 'stair_landing', null, [90, 180], 'stairs'),
  indoor(RV.elev2, 82, 40, 2, 'elevator_stop', null, [0, 270], 'elevator', { elevator_id: 'rv_elev' }),
  indoor(RV.hall2, 82, 55, 2, 'poi', '가상 공학관 2층 복도', ALL4, 'corridor'),
  indoor(RV.room201, 94, 55, 2, 'door', null, [90, 270], 'classroom', { room_ref: '201', space_name: '가상 201호 강의실' }),
  indoor(RV.wc2, 82, 66, 2, 'restroom', '가상 공학관 2층 화장실', [0, 180], 'restroom', { restroom_gender: 'unisex', wheelchair: 'unknown' }),
];

/** 계단·엘리베이터처럼 이름이 없는 지점의 화면 이름(로드뷰 정보 카드용). */
const LABEL: Record<string, string> = {
  [RV.stair1]: '가상 공학관 1층 계단',
  [RV.elev1]: '가상 공학관 1층 엘리베이터',
  [RV.stair2]: '가상 공학관 2층 계단',
  [RV.elev2]: '가상 공학관 2층 엘리베이터',
  [RV.room201]: '가상 201호 강의실',
};

interface DemoEdge { from: string; to: string; props: Record<string, unknown> }
const edge = (from: string, to: string, props: Record<string, unknown>): DemoEdge => ({ from, to, props });
const footway = { highway: 'footway', edge_type: 'outdoor', step_free: true };
const corridor = { highway: 'corridor', edge_type: 'indoor', step_free: true };
// 정문→갈림길은 경사로(ramp)라서 갈림길에서 안내 단계가 새로 시작한다(같은 종류 구간은 한 단계로 합쳐지므로).
const EDGES: DemoEdge[] = [
  edge(RV.gate, RV.fork, { highway: 'ramp', edge_type: 'outdoor', step_free: true }),
  edge(RV.fork, RV.hall, footway),
  edge(RV.fork, RV.plaza, footway),
  edge(RV.plaza, RV.plazaWc, { highway: 'steps', edge_type: 'outdoor', step_free: false, step_count: 6 }),
  edge(RV.fork, RV.engFront, footway),
  edge(RV.engFront, RV.entrance, { highway: 'footway', edge_type: 'portal', step_free: true }),
  edge(RV.entrance, RV.lobby, { highway: 'ramp', edge_type: 'indoor', step_free: true }),
  edge(RV.lobby, RV.wc1, corridor),
  edge(RV.lobby, RV.stair1, corridor),
  edge(RV.lobby, RV.elev1, corridor),
  edge(RV.stair1, RV.stair2, { highway: 'steps', edge_type: 'indoor', step_free: false, level_from: 1, level_to: 2 }),
  edge(RV.elev1, RV.elev2, { highway: 'elevator', edge_type: 'indoor', step_free: true, level_from: 1, level_to: 2 }),
  edge(RV.stair2, RV.hall2, corridor),
  edge(RV.elev2, RV.hall2, corridor),
  edge(RV.hall2, RV.room201, corridor),
  edge(RV.hall2, RV.wc2, corridor),
];

const byId = new Map(NODES.map((n) => [n.id, n]));
const nodeFeature = (n: DemoNode) => ({ type: 'Feature', id: n.id, geometry: { type: 'Point', coordinates: at(...n.xy) }, properties: { kind: 'node', ...n.props, ...SOURCE } });
const edgeFeature = (e: DemoEdge) => ({
  type: 'Feature', id: `e_${e.from}__${e.to}`,
  geometry: { type: 'LineString', coordinates: [at(...byId.get(e.from)!.xy), at(...byId.get(e.to)!.xy)] },
  properties: { kind: 'edge', from: e.from, to: e.to, bidirectional: true, ...e.props, ...SOURCE },
});
const fc = (features: unknown[]) => JSON.stringify({ type: 'FeatureCollection', features });
const isIndoorNode = (n: DemoNode) => n.props['building_id'] === BUILDING;
const levelOfNode = (n: DemoNode) => n.props['level'] as number | null;
const edgeIndoorLevel = (e: DemoEdge): number | null => {
  const a = byId.get(e.from)!, b = byId.get(e.to)!;
  return isIndoorNode(a) && isIndoorNode(b) ? levelOfNode(a) : null;
};

const outline = [[at(60, 20), at(100, 20), at(100, 72), at(60, 72), at(60, 20)]];

/** 실내·실외·포털을 모두 가진 가상 캠퍼스 번들. */
export const ROADVIEW_DEMO_CAMPUS: BundledCampus = {
  campus: 'app-roadview-demo',
  files: [
    { path: 'campus.json', text: JSON.stringify({ id: 'app-roadview-demo', schema_version: '0.2', name: '가상 로드뷰 시험 캠퍼스', center: at(30, 40), bbox: [...at(-80, -30), ...at(140, 120)] }) },
    { path: 'outdoor.geojson', text: fc([...NODES.filter((n) => !isIndoorNode(n)).map(nodeFeature), ...EDGES.filter((e) => !isIndoorNode(byId.get(e.from)!) && !isIndoorNode(byId.get(e.to)!)).map(edgeFeature)]) },
    { path: 'connections.geojson', text: fc(EDGES.filter((e) => e.props['edge_type'] === 'portal').map(edgeFeature)) },
    { path: `buildings/${BUILDING}/building.geojson`, text: fc([{ type: 'Feature', id: BUILDING, geometry: { type: 'Polygon', coordinates: outline }, properties: { kind: 'building', name: '가상 공학관', code: 'RV', levels: [1, 2], ground_levels: [1], ...SOURCE } }]) },
    ...[1, 2].map((level) => ({
      path: `buildings/${BUILDING}/L${level}.geojson`,
      text: fc([
        ...NODES.filter((n) => isIndoorNode(n) && levelOfNode(n) === level).map(nodeFeature),
        ...EDGES.filter((e) => e.props['edge_type'] !== 'portal' && edgeIndoorLevel(e) === level).map(edgeFeature),
      ]),
    })),
  ],
};

/** 지점의 화면 이름과 실내/실외·층(로드뷰 정보 카드·사진 그림이 같은 값을 쓴다). */
export function roadviewDemoPlace(nodeId: string): { name: string; indoor: boolean; level: number | null; buildingName: string | null } | null {
  const n = byId.get(nodeId);
  if (!n) return null;
  return {
    name: (n.props['name'] as string | undefined) ?? LABEL[nodeId] ?? nodeId,
    indoor: isIndoorNode(n),
    level: levelOfNode(n),
    buildingName: isIndoorNode(n) ? '가상 공학관' : null,
  };
}

const levelText = (level: number | null) => (level === null ? null : level < 0 ? `지하 ${-level}층` : `${level}층`);

/** 지점별 다방향 가상 사진 행. id는 `rv_<지점>_<방위>`. */
export const ROADVIEW_DEMO_PHOTO_ROWS: readonly PhotoRow[] = Object.freeze(NODES.flatMap((n) => {
  const place = roadviewDemoPlace(n.id)!;
  return (n.headings ?? []).map((heading): PhotoRow => {
    const spec = { place: place.name, indoor: place.indoor, levelText: levelText(place.level), headingDeg: heading, scene: n.scene ?? 'path' };
    return {
      id: `${n.id}_${heading}`,
      node_id: n.id,
      heading_deg: heading,
      heading_source: 'dial',
      direction_hint: `${place.name} · ${headingLabel(heading)}을 보고 찍은 가상 사진`,
      hfov_deg: 65,
      thumb_url: demoPhotoUri(spec, 'thumb'),
      full_url: demoPhotoUri(spec, 'full'),
    };
  });
}));

/** 가상 로드뷰 사진 카탈로그(photoCatalogFromRows로 만든 그대로). */
export const ROADVIEW_DEMO_CATALOG: PhotoCatalog = photoCatalogFromRows(ROADVIEW_DEMO_PHOTO_ROWS);
