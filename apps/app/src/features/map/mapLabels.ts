// 지도 위 이름표·시설 아이콘을 배율에 따라 얼마나 보일지 정하는 순수 모듈. React를 import하지 않는다.
// - 배율 → 표시 단계(넓게 / 중간 / 확대)
// - 그래프에서 시설 지점(문·엘리베이터·계단·화장실·출입구) 뽑기: 계단·엘리베이터는 이름이 없어 places에 없다.
// - 우선순위 순서로 화면(픽셀) 기준 겹침을 피해 배치(욕심쟁이 방식). 마커 목록마다 색인을 한 번 만들고, 이동 중에는
//   DeclutterScheduler가 다시 배치하는 빈도를 줄인다.
import type { CampusGraph, NodeType } from '@campo/core';
import type { CampusPlace } from '../../contracts.ts';

/** 이 배율부터 실내 이름표를 보인다(그 아래는 아이콘만). */
export const INDOOR_LABEL_MIN_ZOOM = 19.5;
/** 이 배율부터 '중간' 단계(아이콘을 촘촘하게). 그 아래는 '넓게' 단계. */
export const ICON_DETAIL_MIN_ZOOM = 18;
/** 실외 이름표는 장소가 드물어 조금 일찍 보인다. */
export const OUTDOOR_LABEL_MIN_ZOOM = 18;

/** 겹침 판정 간격(px). */
export const LABEL_GAP_PX = 10;
export const ICON_GAP_PX = 6;
/** 넓게 보는 단계에서는 아이콘끼리 더 띄운다(도면이 한눈에 보이게). */
export const OVERVIEW_ICON_GAP_PX = 12;
export const ICON_SIZE_PX = 22;
export const LABEL_HEIGHT_PX = 24;
export const LABEL_MAX_WIDTH_PX = 132;
/** 한 화면에 그리는 최대 개수(마커 뷰가 너무 많아지지 않게). */
export const MAX_ICONS = 48;
export const MAX_LABELS = 16;

export type ZoomStage = 'overview' | 'icons' | 'labels';

/** 배율 → 표시 단계. 실외는 이름표를 조금 일찍 보인다. */
export function zoomStage(zoom: number, indoor: boolean): ZoomStage {
  if (zoom >= (indoor ? INDOOR_LABEL_MIN_ZOOM : OUTDOOR_LABEL_MIN_ZOOM)) return 'labels';
  return zoom >= ICON_DETAIL_MIN_ZOOM ? 'icons' : 'overview';
}

/**
 * 위도 `lat`, 배율 `zoom`에서 화면 1px이 몇 m인가(MapLibre: 512px 타일, 웹 메르카토르).
 * 적도 둘레 40,075,016.686m / 512 = 78,271.517m.
 */
export function metersPerPixel(lat: number, zoom: number): number {
  return (78271.517 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LNG_EQUATOR = 111_320;

export interface MapView {
  /** 화면 가운데 좌표. */
  lng: number;
  lat: number;
  zoom: number;
  /** 지도 회전(도, 북쪽이 위면 0). */
  bearing?: number;
  /** 지도 화면 크기(px). */
  width: number;
  height: number;
}

/** 좌표 → 화면 가운데 기준 픽셀 오프셋(x 오른쪽 +, y 아래 +). 캠퍼스 범위라 평면 근사로 충분하다. */
export function toScreen(lng: number, lat: number, view: MapView): { x: number; y: number } {
  const mpp = metersPerPixel(view.lat, view.zoom);
  const east = (lng - view.lng) * METERS_PER_DEG_LNG_EQUATOR * Math.cos((view.lat * Math.PI) / 180);
  const north = (lat - view.lat) * METERS_PER_DEG_LAT;
  const b = ((view.bearing ?? 0) * Math.PI) / 180;
  // 지도가 bearing만큼 돌아가 있으면 화면 좌표는 반대로 돈다.
  const x = (east * Math.cos(b) - north * Math.sin(b)) / mpp;
  const y = -(east * Math.sin(b) + north * Math.cos(b)) / mpp;
  return { x, y };
}

/* ---------- 시설 종류 ---------- */

export type MarkerKind = 'door' | 'elevator' | 'stairs' | 'restroom' | 'entrance' | 'place';
/** 강조색: 출발 / 도착 / 지금 고른 장소 / 보통. */
export type MarkerTone = 'start' | 'end' | 'selected' | 'normal';

const KIND_BY_NODE: Partial<Record<NodeType | 'gps' | 'point', MarkerKind>> = {
  door: 'door', elevator_stop: 'elevator', stair_landing: 'stairs', restroom: 'restroom', entrance: 'entrance',
};
/** 아이콘으로 그리는 node_type. 복도·야외 점·POI는 아이콘이 없다. */
export const ICON_NODE_TYPES: readonly NodeType[] = ['door', 'elevator_stop', 'stair_landing', 'restroom', 'entrance'];

export const MARKER_KIND_LABEL: Record<MarkerKind, string> = {
  door: '강의실', elevator: '엘리베이터', stairs: '계단', restroom: '화장실', entrance: '출입구', place: '장소',
};

export function markerKind(nodeType: string): MarkerKind {
  return KIND_BY_NODE[nodeType as NodeType] ?? 'place';
}

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  lng: number;
  lat: number;
  /** 이름표 글자. 이름 없는 계단·엘리베이터는 null(아이콘만). */
  name: string | null;
  /** 작을수록 먼저 배치한다. */
  priority: number;
  tone: MarkerTone;
  /** 눌렀을 때 고를 수 있는 등록 장소(없으면 누를 수 없다). */
  place: CampusPlace | null;
}

/** 우선순위: 출발/도착 > 지금 고른 장소 > 경로가 지나는 지점 > 화장실/엘리베이터/계단/출입구 > 강의실·일반 지점. */
export const PRIORITY = { endpoint: 0, selected: 1, route: 2, facility: 3, room: 4, place: 5 } as const;

export interface FacilityNode { id: string; kind: MarkerKind; lng: number; lat: number; name: string | null }

// Same matching as `building_id === buildingId && level === level`: a missing level (undefined) is not null.
const facilityKey = (buildingId: string, level: unknown) => `${buildingId}\u0000${typeof level}:${String(level)}`;
/** 그래프마다 한 번만 모든 지점을 돌아 건물·층별 시설 목록을 만든다(그래프는 만든 뒤 바뀌지 않는다). */
const facilityIndexes = new WeakMap<CampusGraph, Map<string, FacilityNode[]>>();
function facilityIndex(graph: CampusGraph): Map<string, FacilityNode[]> {
  let index = facilityIndexes.get(graph);
  if (index) return index;
  index = new Map();
  for (const node of graph.nodes.values()) {
    const p = node.properties;
    if (typeof p.building_id !== 'string' || !ICON_NODE_TYPES.includes(p.node_type)) continue;
    const [lng, lat] = node.geometry.coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const key = facilityKey(p.building_id, p.level);
    let list = index.get(key);
    if (!list) index.set(key, (list = []));
    list.push({ id: node.id, kind: markerKind(p.node_type), lng, lat, name: p.name?.trim() || null });
  }
  facilityIndexes.set(graph, index);
  return index;
}

/**
 * 그래프에서 이 건물·층의 시설 지점(아이콘 대상)을 뽑는다. 이름 없는 계단·엘리베이터도 포함한다.
 * 그래프를 처음 볼 때 한 번 색인하고, 층을 바꿀 때는 그 층 목록만 복사한다(순서는 그래프 지점 순서 그대로).
 */
export function floorFacilityNodes(graph: CampusGraph | null, buildingId: string | null, level: number | null): FacilityNode[] {
  if (!graph || buildingId === null || Number.isNaN(level)) return [];
  return [...(facilityIndex(graph).get(facilityKey(buildingId, level)) ?? [])];
}

export interface MarkerInput {
  /** 이 보기의 등록 장소(이름 있음). */
  places: readonly CampusPlace[];
  /** 그래프에서 뽑은 시설 지점(floorFacilityNodes). */
  facilities?: readonly FacilityNode[];
  from?: CampusPlace | null;
  to?: CampusPlace | null;
  selected?: CampusPlace | null;
  /** 경로가 지나는 지점 id. */
  routeNodeIds?: readonly string[] | null;
}

/** 장소와 시설 지점을 하나의 마커 목록으로 합친다(같은 id는 하나). 출발·도착·선택은 목록에 없어도 넣는다. */
export function buildMarkers({ places, facilities = [], from = null, to = null, selected = null, routeNodeIds = null }: MarkerInput): MapMarker[] {
  const route = new Set(routeNodeIds ?? []);
  const byId = new Map<string, MapMarker>();
  const toneOf = (id: string): MarkerTone => (id === from?.id ? 'start' : id === to?.id ? 'end' : id === selected?.id ? 'selected' : 'normal');
  const priorityOf = (id: string, kind: MarkerKind): number => {
    const tone = toneOf(id);
    if (tone === 'start' || tone === 'end') return PRIORITY.endpoint;
    if (tone === 'selected') return PRIORITY.selected;
    if (route.has(id)) return PRIORITY.route;
    if (kind === 'door') return PRIORITY.room;
    return kind === 'place' ? PRIORITY.place : PRIORITY.facility;
  };
  for (const f of facilities) {
    byId.set(f.id, { id: f.id, kind: f.kind, lng: f.lng, lat: f.lat, name: f.name, priority: priorityOf(f.id, f.kind), tone: toneOf(f.id), place: null });
  }
  for (const place of [...places, from, to, selected]) {
    if (!place) continue;
    const kind = byId.get(place.id)?.kind ?? markerKind(place.nodeType);
    byId.set(place.id, { id: place.id, kind, lng: place.lng, lat: place.lat, name: place.name, priority: priorityOf(place.id, kind), tone: toneOf(place.id), place });
  }
  return [...byId.values()];
}

/* ---------- 화면 기준 겹침 방지 ---------- */

interface Box { left: number; top: number; right: number; bottom: number }
const overlaps = (a: Box, b: Box, gap: number) =>
  a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;

/** 이름표 폭(px) 추정: 한글 12px, 그 밖 6.8px + 왼쪽 점·여백. 최대 폭에서 자른다(말줄임). */
export function estimateLabelWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += /[ㄱ-힣一-鿿]/.test(ch) ? 12 : 6.8;
  return Math.min(LABEL_MAX_WIDTH_PX, Math.ceil(w + 6 + 5 + 16));
}

/** 표식 위로 이름표를 띄우는 높이(px). 출발·도착은 배지 위, 선택은 핀 위. */
export function labelLift(tone: MarkerTone): number {
  return tone === 'start' || tone === 'end' ? 56 : tone === 'selected' ? 36 : ICON_SIZE_PX / 2 + 4;
}
/** 지점 자리(아이콘·핀)가 차지하는 상자. */
function anchorBox(x: number, y: number, tone: MarkerTone): Box {
  if (tone === 'start' || tone === 'end') return { left: x - 22, top: y - 52, right: x + 22, bottom: y + 8 };
  if (tone === 'selected') return { left: x - 15, top: y - 30, right: x + 15, bottom: y };
  const r = ICON_SIZE_PX / 2;
  return { left: x - r, top: y - r, right: x + r, bottom: y + r };
}

export interface PlacedMarker {
  marker: MapMarker;
  /** 화면 가운데 기준 픽셀 위치. */
  x: number;
  y: number;
  /** 이름표를 그릴지. */
  label: boolean;
}

export interface DeclutterStats {
  /** 화면 좌표를 계산한 마커 수(뷰포트 사전 필터를 통과한 것만 센다). */
  projected: number;
  /** 상자 겹침 비교 횟수. */
  compared: number;
}

export interface DeclutterOptions {
  stage: ZoomStage;
  /** 화면 밖 여유(px). 살짝 밖의 표식은 미리 그려 둔다. */
  margin?: number;
  maxIcons?: number;
  maxLabels?: number;
  /** 넘기면 이번 계산의 작업량을 더한다(벤치마크·테스트용). */
  stats?: DeclutterStats;
}

/* ---------- 마커 색인: 마커 목록마다 한 번 ---------- */

/**
 * 마커 목록의 배치 순서(우선순위, 같으면 목록 순서)와 경위도 격자. 마커 목록 배열이 같으면 다시 만들지 않는다.
 * 지도를 움직일 때마다 전체 마커를 정렬하지 않고, 화면 근처 격자 칸의 마커만 그 순서대로 꺼낸다.
 */
interface MarkerIndex {
  /** 배치 순서 → 원래 위치. */
  order: Int32Array;
  lng: Float64Array;
  lat: Float64Array;
  pinned: Uint8Array;
  /** 경위도 격자(배치 순서 번호를 오름차순으로 담는다). 좌표가 유한한 마커만 들어간다. */
  minLng: number; minLat: number; cellLng: number; cellLat: number; cols: number; rows: number;
  cells: Int32Array[];
  /** 좌표가 유한한 마커 수. */
  finite: number;
}
const EMPTY_CELL = new Int32Array(0);
const markerIndexes = new WeakMap<readonly MapMarker[], MarkerIndex>();
/** 한 칸에 평균 몇 개쯤 담을지. */
const MARKERS_PER_CELL = 4;
const MAX_GRID_SIDE = 128;

function indexMarkers(markers: readonly MapMarker[]): MarkerIndex {
  const cached = markerIndexes.get(markers);
  if (cached) return cached;
  const n = markers.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // 이전과 같은 순서: 우선순위 오름차순, 같으면 원래 순서(안정 정렬과 같다).
  order.sort((a, b) => markers[a]!.priority - markers[b]!.priority || a - b);
  const lng = new Float64Array(n), lat = new Float64Array(n), pinned = new Uint8Array(n);
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity, finite = 0;
  for (let r = 0; r < n; r++) {
    const m = markers[order[r]!]!;
    lng[r] = m.lng; lat[r] = m.lat; pinned[r] = m.tone !== 'normal' ? 1 : 0;
    if (Number.isFinite(m.lng) && Number.isFinite(m.lat)) {
      finite++;
      if (m.lng < minLng) minLng = m.lng; if (m.lng > maxLng) maxLng = m.lng;
      if (m.lat < minLat) minLat = m.lat; if (m.lat > maxLat) maxLat = m.lat;
    }
  }
  const spanLng = finite ? Math.max(maxLng - minLng, 1e-9) : 1e-9, spanLat = finite ? Math.max(maxLat - minLat, 1e-9) : 1e-9;
  const cellsWanted = Math.max(1, finite / MARKERS_PER_CELL);
  const cols = Math.max(1, Math.min(MAX_GRID_SIDE, Math.round(Math.sqrt(cellsWanted * (spanLng / spanLat)))));
  const rows = Math.max(1, Math.min(MAX_GRID_SIDE, Math.round(cellsWanted / cols)));
  const cellLng = spanLng / cols, cellLat = spanLat / rows;
  const counts = new Int32Array(cols * rows);
  const cellOf = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    const x = lng[r]!, y = lat[r]!;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const c = Math.min(cols - 1, Math.floor((x - minLng) / cellLng)), w = Math.min(rows - 1, Math.floor((y - minLat) / cellLat));
    counts[(cellOf[r] = w * cols + c)]!++;
  }
  const cells: Int32Array[] = Array.from(counts, (count) => (count ? new Int32Array(count) : EMPTY_CELL));
  const fill = new Int32Array(cols * rows);
  // 배치 순서대로 넣으므로 칸마다 이미 오름차순이다.
  for (let r = 0; r < n; r++) { const k = cellOf[r]!; if (k >= 0) cells[k]![fill[k]!++] = r; }
  const index: MarkerIndex = { order, lng, lat, pinned, minLng: finite ? minLng : 0, minLat: finite ? minLat : 0, cellLng, cellLat, cols, rows, cells, finite };
  markerIndexes.set(markers, index);
  return index;
}

/**
 * 화면(+여유)을 덮는 경위도 상자 안 격자 칸의 마커를 배치 순서대로 돌려준다. 실제 화면 안 판정은 호출한 쪽이 정확히 한다.
 * 지도가 돌아가 있으면 돌아간 화면 사각형을 감싸는 상자를 쓴다(항상 화면 안 마커를 모두 포함한다).
 */
function candidateRanks(index: MarkerIndex, view: MapView, halfW: number, halfH: number, mpp: number, cosLat: number, b: number): Int32Array | null {
  const kx = METERS_PER_DEG_LNG_EQUATOR * cosLat;
  if (!(kx > 1e-6) || !(mpp > 0) || !Number.isFinite(mpp)) return null;
  const cb = Math.abs(Math.cos(b)), sb = Math.abs(Math.sin(b));
  // 화면 반폭·반높이(px)를 동·북 방향 미터로 바꾼 뒤 각도로. 반올림 오차를 덮도록 살짝 넓힌다.
  const dLng = (((halfW * cb + halfH * sb) * mpp) / kx) * 1.001 + 1e-9;
  const dLat = (((halfW * sb + halfH * cb) * mpp) / METERS_PER_DEG_LAT) * 1.001 + 1e-9;
  const c0 = Math.max(0, Math.floor((view.lng - dLng - index.minLng) / index.cellLng));
  const c1 = Math.min(index.cols - 1, Math.floor((view.lng + dLng - index.minLng) / index.cellLng));
  const r0 = Math.max(0, Math.floor((view.lat - dLat - index.minLat) / index.cellLat));
  const r1 = Math.min(index.rows - 1, Math.floor((view.lat + dLat - index.minLat) / index.cellLat));
  if (!(c0 <= c1 && r0 <= r1)) return EMPTY_CELL;
  // 화면이 격자 대부분을 덮으면 전부를 순서대로 훑는 편이 싸다.
  if ((c1 - c0 + 1) * (r1 - r0 + 1) * 2 >= index.cols * index.rows) return null;
  let total = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) total += index.cells[r * index.cols + c]!.length;
  const out = new Int32Array(total);
  let k = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const cell = index.cells[r * index.cols + c]!; out.set(cell, k); k += cell.length; }
  return out.sort();
}

/* ---------- 놓인 상자: 화면 px 격자 ---------- */

/** 가장 큰 간격(겹침 판정 여유). 상자는 이만큼 넓혀 칸에 넣어 두고, 찾을 때는 넓히지 않는다. */
const MAX_GAP_PX = Math.max(LABEL_GAP_PX, ICON_GAP_PX, OVERVIEW_ICON_GAP_PX);
const BOX_CELL_PX = 64;
class BoxGrid {
  private cells = new Map<number, Box[]>();
  count = 0;
  private static key(cx: number, cy: number) { return (cx + 32768) * 65536 + (cy + 32768); }
  add(box: Box) {
    this.count++;
    const x0 = Math.floor((box.left - MAX_GAP_PX) / BOX_CELL_PX), x1 = Math.floor((box.right + MAX_GAP_PX) / BOX_CELL_PX);
    const y0 = Math.floor((box.top - MAX_GAP_PX) / BOX_CELL_PX), y1 = Math.floor((box.bottom + MAX_GAP_PX) / BOX_CELL_PX);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const key = BoxGrid.key(cx, cy);
      const list = this.cells.get(key);
      if (list) list.push(box); else this.cells.set(key, [box]);
    }
  }
  /** `box`와 `gap` 안으로 겹치는 상자(`except` 제외)가 있는가. */
  hits(box: Box, gap: number, stats: DeclutterStats | undefined, except: Box | null = null): boolean {
    if (this.count === 0) return false;
    const x0 = Math.floor(box.left / BOX_CELL_PX), x1 = Math.floor(box.right / BOX_CELL_PX);
    const y0 = Math.floor(box.top / BOX_CELL_PX), y1 = Math.floor(box.bottom / BOX_CELL_PX);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const list = this.cells.get(BoxGrid.key(cx, cy));
      if (!list) continue;
      for (const other of list) {
        if (other === except) continue;
        if (stats) stats.compared++;
        if (overlaps(other, box, gap)) return true;
      }
    }
    return false;
  }
}

/**
 * 우선순위가 높은 것부터 화면 위치를 계산해 겹치지 않는 것만 남긴다.
 * - 출발·도착·선택(강조)은 항상 남고, 그 자리를 먼저 차지한다.
 * - 아이콘끼리는 ICON_GAP_PX(넓게 단계는 OVERVIEW_ICON_GAP_PX) 이상 떨어져야 한다.
 * - 이름표는 'labels' 단계에서만, 다른 이름표와 LABEL_GAP_PX, 아이콘과 ICON_GAP_PX 이상 떨어질 때만 붙인다.
 *
 * 결과는 모든 마커를 투영·정렬해 앞에서부터 놓던 방식과 같다. 빠르게 하려고
 * (1) 배치 순서와 경위도 격자를 마커 목록마다 한 번만 만들고(같은 배열이면 재사용),
 * (2) 화면을 덮는 격자 칸의 마커만 투영하고,
 * (3) 아이콘이 MAX_ICONS에 차면 강조 표식이 아닌 나머지는 투영하지 않으며,
 * (4) 겹침은 화면 px 격자로 근처 상자끼리만 비교한다.
 */
export function declutter(markers: readonly MapMarker[], view: MapView, { stage, margin = 40, maxIcons = MAX_ICONS, maxLabels = MAX_LABELS, stats }: DeclutterOptions): PlacedMarker[] {
  const halfW = view.width / 2 + margin, halfH = view.height / 2 + margin;
  const iconGap = stage === 'overview' ? OVERVIEW_ICON_GAP_PX : ICON_GAP_PX;
  const index = indexMarkers(markers);
  // toScreen과 같은 식·같은 계산 순서(결과 좌표가 비트 단위로 같다).
  const mpp = metersPerPixel(view.lat, view.zoom);
  const cosLat = Math.cos((view.lat * Math.PI) / 180);
  const b = ((view.bearing ?? 0) * Math.PI) / 180;
  const cosB = Math.cos(b), sinB = Math.sin(b);
  const ranks = candidateRanks(index, view, halfW, halfH, mpp, cosLat, b);
  const total = ranks ? ranks.length : markers.length;
  const icons = new BoxGrid();
  const labels = new BoxGrid();
  const placed: PlacedMarker[] = [];
  let iconCount = 0, labelCount = 0;
  for (let i = 0; i < total; i++) {
    const r = ranks ? ranks[i]! : i;
    const pinned = index.pinned[r] === 1;
    // 아이콘이 다 찼으면 강조 표식만 더 놓인다: 나머지는 투영할 필요도 없다.
    if (!pinned && iconCount >= maxIcons) continue;
    const east = (index.lng[r]! - view.lng) * METERS_PER_DEG_LNG_EQUATOR * cosLat;
    const north = (index.lat[r]! - view.lat) * METERS_PER_DEG_LAT;
    const x = (east * cosB - north * sinB) / mpp;
    const y = -(east * sinB + north * cosB) / mpp;
    if (stats) stats.projected++;
    if (!(Math.abs(x) <= halfW && Math.abs(y) <= halfH)) continue;
    const marker = markers[index.order[r]!]!;
    const box = anchorBox(x, y, marker.tone);
    if (!pinned && (icons.hits(box, iconGap, stats) || labels.hits(box, ICON_GAP_PX, stats))) continue;
    icons.add(box); iconCount++;
    let label = false;
    if (stage === 'labels' && marker.name && labelCount < maxLabels) {
      const w = estimateLabelWidth(marker.name);
      const bottom = y - labelLift(marker.tone);
      const lb: Box = { left: x - w / 2, top: bottom - LABEL_HEIGHT_PX, right: x + w / 2, bottom };
      const free = !labels.hits(lb, LABEL_GAP_PX, stats) && !icons.hits(lb, ICON_GAP_PX, stats, box);
      if (free) { labels.add(lb); labelCount++; label = true; }
    }
    placed.push({ marker, x, y, label });
  }
  return placed;
}

/** 배치가 같은가: 같은 마커가 같은 순서로, 같은 이름표 여부로 놓였는가(화면 좌표는 보지 않는다 — 마커는 경위도에 그린다). */
export function samePlacement(a: readonly PlacedMarker[], b: readonly PlacedMarker[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.marker !== b[i]!.marker || a[i]!.label !== b[i]!.label) return false;
  return true;
}

/* ---------- 지도 이동 중 다시 배치하는 빈도 ---------- */

export interface DeclutterSchedulerOptions {
  /** 이동 중에는 이 간격(ms)보다 자주 다시 배치하지 않는다. */
  throttleMs?: number;
  /** 이동 중 가운데가 이만큼(px) 움직이지 않고 배율·회전도 거의 그대로면 다시 배치하지 않는다. */
  minMovePx?: number;
  minZoomDelta?: number;
  minBearingDelta?: number;
}
export const DECLUTTER_THROTTLE_MS = 80;

/**
 * 지도 이동 이벤트마다 무엇을 다시 그릴지 정한다(React와 무관한 순수 객체, 화면은 결과 배열만 그린다).
 * - 이동 중(`moving`): DECLUTTER_THROTTLE_MS 간격과 이동 거리·배율 임계값을 넘을 때만 다시 배치한다.
 * - 멈춤(`settle`)·마커/단계 변경: 언제나 정확히 다시 배치한다.
 * - 배치가 이전과 같으면(samePlacement) 이전 배열을 그대로 돌려줘 마커를 다시 만들지 않는다.
 *   이때 x·y는 그 배치를 처음 계산한 때의 화면 좌표다(그리기는 경위도를 쓴다).
 */
export class DeclutterScheduler {
  private readonly throttleMs: number;
  private readonly minMovePx: number;
  private readonly minZoomDelta: number;
  private readonly minBearingDelta: number;
  private markers: readonly MapMarker[] = [];
  private indoor = false;
  private view: MapView | null = null;
  private computedView: MapView | null = null;
  private computedAt = -Infinity;
  private computedStage: ZoomStage | null = null;
  private dirty = false;
  /** 지금 그리는 배치. */
  placed: PlacedMarker[] = [];
  readonly stats = { computed: 0, skipped: 0, changed: 0, projected: 0, compared: 0 };

  constructor({ throttleMs = DECLUTTER_THROTTLE_MS, minMovePx = 2, minZoomDelta = 0.01, minBearingDelta = 0.5 }: DeclutterSchedulerOptions = {}) {
    this.throttleMs = throttleMs; this.minMovePx = minMovePx; this.minZoomDelta = minZoomDelta; this.minBearingDelta = minBearingDelta;
  }

  /** 마커 목록이나 실내/실외가 바뀌었다: 지금 화면으로 바로 다시 배치. */
  setMarkers(markers: readonly MapMarker[], indoor: boolean): PlacedMarker[] {
    if (markers === this.markers && indoor === this.indoor) return this.placed;
    this.markers = markers; this.indoor = indoor;
    return this.compute();
  }
  /** 지도가 움직이는 중(onRegionIsChanging). 다시 배치하지 않으면 지금 배치를 그대로 돌려준다. */
  moving(view: MapView, now: number): PlacedMarker[] {
    this.view = view;
    const last = this.computedView;
    const stage = zoomStage(view.zoom, this.indoor);
    if (!last || stage !== this.computedStage || last.width !== view.width || last.height !== view.height) return this.compute(now);
    if (now - this.computedAt < this.throttleMs || !this.movedEnough(last, view)) { this.dirty = true; this.stats.skipped++; return this.placed; }
    return this.compute(now);
  }
  /** 지도가 멈췄다(onRegionDidChange)·화면 크기가 바뀌었다: 정확히 다시 배치. */
  settle(view: MapView, now = 0): PlacedMarker[] {
    this.view = view;
    return this.compute(now);
  }
  /** 이동 중 미뤄 둔 배치가 있으면 지금 한다(멈춤 이벤트가 늦을 때의 뒤늦은 계산). */
  flush(now = 0): PlacedMarker[] { return this.dirty ? this.compute(now) : this.placed; }
  /** 미뤄 둔 배치가 있는가. */
  get pending(): boolean { return this.dirty; }

  private movedEnough(a: MapView, b: MapView): boolean {
    if (Math.abs(a.zoom - b.zoom) >= this.minZoomDelta || Math.abs((a.bearing ?? 0) - (b.bearing ?? 0)) >= this.minBearingDelta) return true;
    const { x, y } = toScreen(a.lng, a.lat, b);
    return Math.hypot(x, y) >= this.minMovePx;
  }
  private compute(now = 0): PlacedMarker[] {
    this.dirty = false;
    const view = this.view;
    if (!view || view.width <= 0) return this.replace([]);
    const stage = zoomStage(view.zoom, this.indoor);
    const work: DeclutterStats = { projected: 0, compared: 0 };
    const next = declutter(this.markers, view, { stage, stats: work });
    this.stats.computed++; this.stats.projected += work.projected; this.stats.compared += work.compared;
    this.computedView = view; this.computedAt = now; this.computedStage = stage;
    return this.replace(next);
  }
  private replace(next: PlacedMarker[]): PlacedMarker[] {
    if (samePlacement(this.placed, next)) return this.placed;
    this.stats.changed++;
    this.placed = next;
    return next;
  }
}
