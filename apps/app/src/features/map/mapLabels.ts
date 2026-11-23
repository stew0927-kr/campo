// 지도 위 이름표·시설 아이콘을 배율에 따라 얼마나 보일지 정하는 순수 모듈. React를 import하지 않는다.
// - 배율 → 표시 단계(넓게 / 중간 / 확대)
// - 그래프에서 시설 지점(문·엘리베이터·계단·화장실·출입구) 뽑기: 계단·엘리베이터는 이름이 없어 places에 없다.
// - 우선순위 순서로 화면(픽셀) 기준 겹침을 피해 배치(욕심쟁이 방식).
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

/** 그래프에서 이 건물·층의 시설 지점(아이콘 대상)을 뽑는다. 이름 없는 계단·엘리베이터도 포함한다. */
export function floorFacilityNodes(graph: CampusGraph | null, buildingId: string | null, level: number | null): { id: string; kind: MarkerKind; lng: number; lat: number; name: string | null }[] {
  if (!graph || buildingId === null) return [];
  const out: { id: string; kind: MarkerKind; lng: number; lat: number; name: string | null }[] = [];
  for (const node of graph.nodes.values()) {
    const p = node.properties;
    if (p.building_id !== buildingId || p.level !== level || !ICON_NODE_TYPES.includes(p.node_type)) continue;
    const [lng, lat] = node.geometry.coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    out.push({ id: node.id, kind: markerKind(p.node_type), lng, lat, name: p.name?.trim() || null });
  }
  return out;
}

export interface MarkerInput {
  /** 이 보기의 등록 장소(이름 있음). */
  places: readonly CampusPlace[];
  /** 그래프에서 뽑은 시설 지점(floorFacilityNodes). */
  facilities?: readonly { id: string; kind: MarkerKind; lng: number; lat: number; name: string | null }[];
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

export interface DeclutterOptions {
  stage: ZoomStage;
  /** 화면 밖 여유(px). 살짝 밖의 표식은 미리 그려 둔다. */
  margin?: number;
  maxIcons?: number;
  maxLabels?: number;
}

/**
 * 우선순위가 높은 것부터 화면 위치를 계산해 겹치지 않는 것만 남긴다.
 * - 출발·도착·선택(강조)은 항상 남고, 그 자리를 먼저 차지한다.
 * - 아이콘끼리는 ICON_GAP_PX(넓게 단계는 OVERVIEW_ICON_GAP_PX) 이상 떨어져야 한다.
 * - 이름표는 'labels' 단계에서만, 다른 이름표와 LABEL_GAP_PX, 아이콘과 ICON_GAP_PX 이상 떨어질 때만 붙인다.
 */
export function declutter(markers: readonly MapMarker[], view: MapView, { stage, margin = 40, maxIcons = MAX_ICONS, maxLabels = MAX_LABELS }: DeclutterOptions): PlacedMarker[] {
  const halfW = view.width / 2 + margin, halfH = view.height / 2 + margin;
  const iconGap = stage === 'overview' ? OVERVIEW_ICON_GAP_PX : ICON_GAP_PX;
  const sorted = markers
    .map((marker, order) => ({ marker, order, ...toScreen(marker.lng, marker.lat, view) }))
    .filter((m) => Math.abs(m.x) <= halfW && Math.abs(m.y) <= halfH)
    .sort((a, b) => a.marker.priority - b.marker.priority || a.order - b.order);
  const icons: Box[] = [];
  const labels: Box[] = [];
  const placed: PlacedMarker[] = [];
  let labelCount = 0;
  for (const { marker, x, y } of sorted) {
    const pinned = marker.tone !== 'normal';
    const box = anchorBox(x, y, marker.tone);
    if (!pinned && (icons.length >= maxIcons || icons.some((b) => overlaps(b, box, iconGap)) || labels.some((b) => overlaps(b, box, ICON_GAP_PX)))) continue;
    icons.push(box);
    let label = false;
    if (stage === 'labels' && marker.name && labelCount < maxLabels) {
      const w = estimateLabelWidth(marker.name);
      const bottom = y - labelLift(marker.tone);
      const lb: Box = { left: x - w / 2, top: bottom - LABEL_HEIGHT_PX, right: x + w / 2, bottom };
      const free = labels.every((b) => !overlaps(b, lb, LABEL_GAP_PX)) && icons.every((b) => b === box || !overlaps(b, lb, ICON_GAP_PX));
      if (free) { labels.push(lb); labelCount++; label = true; }
    }
    placed.push({ marker, x, y, label });
  }
  return placed;
}
