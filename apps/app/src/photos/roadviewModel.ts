// 캠퍼스 로드뷰(분할 화면: 위 사진 + 아래 미니 지도)가 그릴 값을 만든다. React를 import하지 않는 순수 모듈.
// 경로 단계의 사진 고르기는 routeStepPhotos(코어 choosePhotoForStep), 다른 방향 사진 순서는 otherPhotosAt(코어 photosForPoint),
// 화살표는 withPhoto(코어 arrowFor)를 그대로 쓴다.
import { DEFAULT_HFOV_DEG, normalizeDeg, type CampusGraph } from '@campo/core';
import type { CampusPlace, CampusRouteView, PhotoCatalog, RoutePhoto, RouteStepPhoto } from '../contracts.ts';
import { isEmptyCatalog } from './catalog.ts';
import { isValidLngLat, validLngLatTuple } from '../features/map/markerCoords.ts';
import { headingLabel } from './demoPhotoArt.ts';
import { otherPhotosAt } from './routePhotos.ts';
import { nodeLineIndex } from './routeAlongPhotos.ts';
import { straightRun, type StraightRun } from './turnGuide.ts';
import { photoViewerPages, withPhoto } from './viewerModel.ts';

// ---- 지점 정보 ----

export interface RoadviewPlaceInfo {
  name: string;
  indoor: boolean;
  level: number | null;
  buildingName: string | null;
}
export type RoadviewPlaceLookup = (nodeId: string) => RoadviewPlaceInfo | null;

const TYPE_NAME: Readonly<Record<string, string>> = {
  stair_landing: '계단', elevator_stop: '엘리베이터', corridor: '복도', entrance: '출입구', restroom: '화장실', door: '문', poi: '장소',
};
export const levelText = (level: number | null): string | null => (level === null ? null : level < 0 ? `지하 ${-level}층` : `${level}층`);

/** 그래프와 장소 목록으로 지점 이름·실내 여부·층을 찾는다. 이름 없는 계단·엘리베이터는 "건물 n층 계단"처럼 만든다. */
export function placeLookup(graph: CampusGraph | null, places: readonly CampusPlace[]): RoadviewPlaceLookup {
  const names = new Map(places.map((p) => [p.id, p.name]));
  return (nodeId) => {
    const node = graph?.nodes.get(nodeId);
    if (!node) return names.has(nodeId) ? { name: names.get(nodeId)!, indoor: false, level: null, buildingName: null } : null;
    const props = node.properties;
    const buildingId = props.building_id ?? null;
    const buildingName = buildingId ? graph!.buildings.get(buildingId)?.properties.name ?? null : null;
    const level = props.level ?? null;
    const named = names.get(nodeId) ?? (typeof props.name === 'string' && props.name !== '' ? props.name : null);
    const kind = TYPE_NAME[props.node_type] ?? '지점';
    const name = named ?? [buildingName, levelText(level), kind].filter(Boolean).join(' ');
    return { name, indoor: buildingId !== null, level, buildingName };
  };
}

/** "실외" / "가상 공학관 · 2층 · 실내". */
export function placeLine(info: RoadviewPlaceInfo): string {
  if (!info.indoor) return '실외';
  return [info.buildingName, levelText(info.level), '실내'].filter(Boolean).join(' · ');
}

/** "북쪽 0° 방향을 보고 있습니다." 방향 없는 사진이면 그렇다고 말한다. */
export function viewingText(photo: RoutePhoto | null): string {
  if (photo === null) return '이 지점은 아직 사진이 없습니다.';
  if (photo.heading_deg === null) return '사진의 방향 정보가 없습니다.';
  return `${headingLabel(photo.heading_deg)} 방향을 보고 있습니다.`;
}

// ---- 로드뷰 한 장면 ----

export interface RoadviewFrame {
  key: string;
  nodeId: string;
  lngLat: [number, number] | null;
  /** 경로 단계 위치(RouteStepPhoto 목록 안의 위치). 경로 없이 지점만 볼 때 null. */
  index: number | null;
  /** "3 / 7 · 장소" (경로일 때만). */
  counter: string | null;
  stepText: string;
  /** 왕복 경로에서 가는 길/오는 길. 아니면 null. */
  leg: 'out' | 'back' | null;
  /** 자동으로 고른 사진과 화살표. */
  step: RouteStepPhoto;
  /** 이 지점의 사진 전부(가야 할 방향에 가까운 것 먼저). */
  photos: RoutePhoto[];
  place: RoadviewPlaceInfo;
  /** 경로일 때 이 지점에서 앞으로 곧게 걷는 거리와 그 끝의 꺾임(turnGuide.straightRun). 경로 없이 지점만 볼 때·모르면 null. */
  run?: StraightRun | null;
}

const UNKNOWN_PLACE: RoadviewPlaceInfo = { name: '이름 없는 지점', indoor: false, level: null, buildingName: null };
export const SPOT_TEXT = '이 지점의 로드뷰 사진입니다. 다른 방향 사진을 눌러 둘러보세요.';

/** 가는 길 / 오는 길 이름. */
export const LEG_LABEL = { out: '가는 길', back: '오는 길' } as const;

const legOf = (stepIndex: number, backFrom: number | null | undefined): 'out' | 'back' | null =>
  backFrom === null || backFrom === undefined ? null : stepIndex < backFrom ? 'out' : 'back';

/** 경로의 단계마다 한 장면. photoViewerPages(뷰어 페이지)를 그대로 쓰고 지점 정보·사진 목록을 붙인다. */
export function roadviewFrames(
  route: CampusRouteView | null,
  stepPhotos: readonly RouteStepPhoto[],
  catalog: PhotoCatalog | null,
  lookup: RoadviewPlaceLookup,
  backFrom: number | null = null,
): RoadviewFrame[] {
  const pages = photoViewerPages(route, stepPhotos, catalog, (id) => lookup(id)?.name ?? null);
  let ranges: [number, number][] | undefined;
  return pages.map((page, index) => {
    const leg = legOf(page.stepIndex, backFrom);
    return {
      key: page.key,
      nodeId: page.step.nodeId,
      lngLat: page.step.lngLat,
      index,
      counter: leg ? `${LEG_LABEL[leg]} · ${page.counter}` : page.counter,
      stepText: page.stepText,
      leg,
      step: page.step,
      photos: [...(page.step.photo ? [page.step.photo] : []), ...page.others],
      place: lookup(page.step.nodeId) ?? UNKNOWN_PLACE,
      run: route ? stepRun(route, page.step, ranges ??= stepLineRanges(route)) : null,
    };
  });
}

/**
 * 단계마다 경로선 위 범위 [시작 점, 끝 점](routeAlongPhotos와 같은 커서 규칙). 마지막 칸(steps.length)은 도착 지점 범위.
 * 왕복처럼 같은 좌표가 두 번 나와도 단계 범위 안에서 찾으므로 그 단계가 지나는 쪽을 고른다.
 */
export function stepLineRanges(route: CampusRouteView): [number, number][] {
  const lineAt = nodeLineIndex(route);
  const out: [number, number][] = [];
  let cursor = 0, lastLine = 0;
  route.steps.forEach((step) => {
    let a = route.nodeIds.indexOf(step.fromNodeId, cursor);
    if (a < 0) a = route.nodeIds.indexOf(step.fromNodeId);
    const b = a < 0 ? -1 : route.nodeIds.indexOf(step.toNodeId, a);
    const la = a >= 0 && lineAt[a]! >= 0 ? lineAt[a]! : lastLine;
    const lb = b >= 0 && lineAt[b]! >= 0 ? lineAt[b]! : route.polyline.length - 1;
    out.push([la, Math.max(la, lb)]);
    if (b > a) cursor = b;
    lastLine = Math.max(la, lb);
  });
  out.push([lastLine, route.polyline.length - 1]);
  return out;
}

/** 사진 지점의 경로선 위 자리에서 straightRun. 자리를 찾지 못하면 null. */
export function stepRun(route: CampusRouteView, step: Pick<RouteStepPhoto, 'stepIndex' | 'lngLat'>, ranges: readonly [number, number][] = stepLineRanges(route)): StraightRun | null {
  if (!step.lngLat) return null;
  const [lo, hi] = ranges[Math.min(step.stepIndex, ranges.length - 1)] ?? [0, route.polyline.length - 1];
  const [lng, lat] = step.lngLat;
  for (let j = lo; j <= hi; j++) {
    const p = route.polyline[j];
    if (p && p.lng === lng && p.lat === lat) return straightRun(route.polyline.map((q) => [q.lng, q.lat]), j);
  }
  return null;
}

/** 경로 없이 지도에서 고른 사진 지점 하나의 장면. 사진이 없으면 null. 처음 사진은 북쪽에 가까운 것. */
export function spotFrame(nodeId: string, lngLat: [number, number] | null, catalog: PhotoCatalog | null, lookup: RoadviewPlaceLookup): RoadviewFrame | null {
  if (isEmptyCatalog(catalog)) return null;
  const photos = otherPhotosAt(catalog!.byNodeId(nodeId), 0, null);
  if (photos.length === 0) return null;
  const photo = photos[0]!;
  return {
    key: `spot:${nodeId}`,
    nodeId,
    lngLat,
    index: null,
    counter: null,
    stepText: SPOT_TEXT,
    leg: null,
    step: { stepIndex: -1, nodeId, lngLat, pick: 'ahead', photo, deltaDeg: null, arrow: null, targetDeg: null, badge: null },
    photos,
    place: lookup(nodeId) ?? UNKNOWN_PLACE,
  };
}

/** 장면에서 다른 방향 사진을 골랐을 때 보일 값. 경로 단계면 화살표를 다시 잡고, 지점만 볼 때는 화살표·배지 없이. */
export function framePhoto(frame: RoadviewFrame, photo: RoutePhoto): RouteStepPhoto {
  if (frame.index === null) return { ...frame.step, photo };
  return withPhoto(frame.step, photo);
}

// ---- 미니 지도 시야각 ----

const M_PER_DEG_LAT = 111_320;

/**
 * 사진이 보는 방향의 부채꼴(시야각) 다각형. 꼭짓점은 지점, 가운데 방향 heading, 폭 hfov.
 * 방향이 없으면 null(부채꼴을 그리지 않는다).
 */
export function viewCone(
  lngLat: [number, number],
  headingDeg: number | null,
  hfovDeg: number = DEFAULT_HFOV_DEG,
  radiusM = 28,
  segments = 12,
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (headingDeg === null || !Number.isFinite(headingDeg)) return null;
  const [lng, lat] = lngLat;
  const mLng = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const half = (Number.isFinite(hfovDeg) && hfovDeg > 0 && hfovDeg < 180 ? hfovDeg : DEFAULT_HFOV_DEG) / 2;
  const ring: [number, number][] = [[lng, lat]];
  for (let i = 0; i <= segments; i++) {
    const deg = normalizeDeg(headingDeg) - half + (2 * half * i) / segments;
    const r = (deg * Math.PI) / 180;
    ring.push([lng + (Math.sin(r) * radiusM) / mLng, lat + (Math.cos(r) * radiusM) / M_PER_DEG_LAT]);
  }
  ring.push([lng, lat]);
  return { type: 'Feature', properties: { heading: normalizeDeg(headingDeg), hfov: half * 2 }, geometry: { type: 'Polygon', coordinates: [ring] } };
}

// ---- 지도 위 사진 지점과 단계 마커 ----

export interface MarkerEntry {
  /** RouteStepPhoto 목록 안의 위치(로드뷰 장면 위치와 같다). */
  index: number;
  /** "가는 길 · 2단계" / "3단계" / "도착". */
  label: string;
}
export interface MarkerGroup {
  key: string;
  lngLat: [number, number];
  nodeId: string;
  entries: MarkerEntry[];
}

const coordKey = ([lng, lat]: [number, number]) => `${lng.toFixed(7)},${lat.toFixed(7)}`;

/**
 * 사진이 있는 단계를 좌표별로 묶는다. 왕복처럼 같은 지점을 두 번 지나도 단계마다 항목이 따로 남아(덮어쓰지 않는다)
 * 같은 마커를 눌렀을 때 "가는 길 / 오는 길"을 고를 수 있다.
 */
export function stepMarkerGroups(stepPhotos: readonly RouteStepPhoto[], stepCount: number, backFrom: number | null = null): MarkerGroup[] {
  const groups = new Map<string, MarkerGroup>();
  stepPhotos.forEach((s, index) => {
    if (s.photo === null || s.lngLat === null || validLngLatTuple(s.lngLat) === null) return;
    const key = coordKey(s.lngLat);
    const leg = legOf(s.stepIndex, backFrom);
    const name = s.stepIndex >= stepCount ? '도착' : `${s.stepIndex + 1}단계`;
    const label = leg ? `${LEG_LABEL[leg]} · ${name}` : name;
    const group = groups.get(key);
    if (group) group.entries.push({ index, label });
    else groups.set(key, { key, lngLat: s.lngLat, nodeId: s.nodeId, entries: [{ index, label }] });
  });
  return [...groups.values()];
}

/** 사진 핀을 눌렀을 때 할 일: 항목이 하나면 그 사진이 첫 장면인 로드뷰를 바로 연다, 둘 이상(왕복)이면 말풍선에서 고른다. */
export type PinTap = { kind: 'open'; index: number } | { kind: 'choose' };

/** 핀 한 번 탭 → 로드뷰. `entries[].index`는 stepPhotos 위치이고 roadviewFrames도 같은 순서·개수라 그대로 장면 위치다. */
export function pinTapAction(group: Pick<MarkerGroup, 'entries'>): PinTap {
  if (group.entries.length === 1) return { kind: 'open', index: group.entries[0]!.index };
  return { kind: 'choose' };
}

export interface PhotoSpot {
  nodeId: string;
  lngLat: [number, number];
  count: number;
  thumbUrl: string;
}

/**
 * 지도에 보일 사진 지점(경로가 없어도 누르면 로드뷰를 연다). 실외 보기면 실외 지점, 건물·층 보기면 그 층 지점만.
 * 카탈로그가 비면 [].
 */
export function photoSpots(graph: CampusGraph | null, catalog: PhotoCatalog | null, buildingId: string | null, level: number | null): PhotoSpot[] {
  if (graph === null || isEmptyCatalog(catalog)) return [];
  const out: PhotoSpot[] = [];
  for (const node of graph.nodes.values()) {
    const props = node.properties;
    const inScope = buildingId === null ? (props.building_id ?? null) === null : props.building_id === buildingId && props.level === level;
    if (!inScope) continue;
    const photos = catalog!.byNodeId(node.id);
    if (photos.length === 0) continue;
    const [lng, lat] = node.geometry.coordinates as [number, number];
    if (!isValidLngLat(lng, lat)) continue;
    out.push({ nodeId: node.id, lngLat: [lng, lat], count: photos.length, thumbUrl: otherPhotosAt(photos, 0, null)[0]!.thumbUrl });
  }
  return out;
}

// ---- 왕복 경로 ----

/**
 * 가는 길(A → C)과 오는 길(C → A)을 한 경로로 잇는다. 둘 다 지점에서 시작·끝나야 한다(지도 임의 점이면 null).
 * backFrom: 오는 길이 시작하는 단계 위치(steps 안).
 */
export function combineRoundTrip(out: CampusRouteView | null, back: CampusRouteView | null): { route: CampusRouteView; backFrom: number } | null {
  if (!out || !back || out.steps.length === 0 || back.steps.length === 0) return null;
  if (out.snappedStartM !== undefined || out.snappedEndM !== undefined || back.snappedStartM !== undefined || back.snappedEndM !== undefined) return null;
  if (out.nodeIds.at(-1) !== back.nodeIds[0]) return null;
  return {
    backFrom: out.steps.length,
    route: {
      ...out,
      timeSec: out.timeSec + back.timeSec,
      distanceM: out.distanceM + back.distanceM,
      stairsCount: out.stairsCount + back.stairsCount,
      escalatorCount: out.escalatorCount + back.escalatorCount,
      steps: [...out.steps, ...back.steps],
      floorChanges: [...out.floorChanges, ...back.floorChanges],
      slopeWarnings: [...out.slopeWarnings, ...back.slopeWarnings],
      fallbackMessage: out.fallbackMessage ?? back.fallbackMessage,
      polyline: [...out.polyline, ...back.polyline.slice(1)],
      nodeIds: [...out.nodeIds, ...back.nodeIds.slice(1)],
    },
  };
}
