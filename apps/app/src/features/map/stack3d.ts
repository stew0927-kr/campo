// "3D 보기": 건물을 층별로 세워 MapLibre fill-extrusion으로 그릴 재료. React를 import하지 않는 순수 모듈.
// 높이는 코어 buildingStack(측정 층고 → 건물 ext.floor_height_m → 3.9 m)을 그대로 쓴다. 화면 표시용이며 길찾기는 층 번호를 보지 않는다.
//
// MapLibre 네이티브의 선·점·아이콘(그리고 React Native Marker)은 고도를 줄 수 없어 항상 지면(0 m)에 그려진다. 그래서 건물·층을
// 고른 3D 보기에서는 고른 층을 지면에 두고(그 층의 도면 선·시설 아이콘이 그 층 위에 정확히 놓이게) 그 위층들을 각 층 바닥에서
// 아주 얇게(SLAB_THICKNESS_M) 띄워 "유리 바닥판"으로만 그린다. 층 전체 높이를 블록으로 채우지 않기 때문에 판 사이의 실제 층고가
// 그대로 빈 공간으로 남아 층간 간격이 시원하게 읽힌다. 고른 층보다 아래층은 지면 아래라 세우지 않는다(fill-extrusion은 0 m
// 아래로 내려가지 않는다).
// - 고른 건물: 위층 얇은 바닥판(옅게, 각 판은 바닥 높이 기준 SLAB_THICKNESS_M만) + 엘리베이터·계단 세로 선분(links: 폭
//   LINK_W_M의 아주 가는 수직 기둥, 편집기 3D의 보라·주황 세로선과 같은 인상) + 정류장·계단참 자리의 작은 바닥 표식(foot).
// - 다른 건물: 슬래브 대신 외곽선만.
// - 아무 건물도 고르지 않았으면: 층이 둘 이상인 건물을 모두 1층을 지면에 두고 옅게 세운다(기둥 없음).
//
// 유리판처럼 보이게(편집기 deck3d의 wireframe 슬래브와 같은 인상): 판은 아주 옅게 칠하고, 판의 윗변·아랫변을 따라 가는 띠
// (rims, 폭 RIM_W_M·높이 RIM_H_M)를 진하게 세운다. 판 자체가 얇아(두 띠의 높이를 합치면 판 두께와 같거나 더 크다) 위·아래 띠가
// 거의 맞붙어 하나의 깔끔한 단일 테두리로 읽힌다(옛 "두꺼운 블록 + 양끝 띠"처럼 비스듬한 시선에서 여러 겹의 판·띠가 교차해
// 줄무늬로 보이던 문제가 사라진다). MapLibre의 선 레이어는 지면에만 그려지고 fill-extrusion-color의 알파는 무시되므로(레이어
// opacity 하나만 쓴다) 경계는 띠로, 층별 농도는 tier(바로 위 층 0 / 그 위 1)별 레이어로 나눠 준다.
import { PICTOGRAM_COLORS, STACK_COLORS, buildingStack, type CampusGraph, type BuildingFeature, type EditBuilding, type Level } from '@campo/core';
import type { FeatureCollection, Polygon, Position } from 'geojson';

/** 위층 바닥판의 두께(m, 바닥 높이 기준): 층 전체가 아니라 얇은 유리판 하나만 그린다. */
export const SLAB_THICKNESS_M = 0.3;
/** 계단참 두 개가 이 거리(m) 안이면 같은 계단(아래층 ↔ 위층)으로 본다. */
export const STAIR_PAIR_M = 6;
/**
 * 세로 선분의 한 변(m). MapLibre 네이티브 선 레이어는 고도를 줄 수 없어, 아주 가는 정사각 기둥을 fill-extrusion으로 세워 "선"처럼 보이게 한다.
 * 슬래브 경계 띠(RIM_W_M)보다 가늘다.
 */
export const LINK_W_M = 0.15;
/** 정류장·계단참 자리의 바닥 표식: 한 변(m), 높이(m). 선분보다 넓고 아주 낮은 판이라 "여기서 타고 내린다"만 읽힌다. */
export const LINK_FOOT_M = 0.7;
export const LINK_FOOT_H_M = 0.08;
/** 유리판 경계 띠: 변을 가운데 두고 폭(m), 슬래브 위·아래 끝에서의 높이(m). */
export const RIM_W_M = 0.35;
export const RIM_H_M = 0.22;
/** 3D 보기에서 카메라 기울기(도). */
export const STACK_PITCH_DEG = 50;

export const STACK_FLOOR_COLOR = STACK_COLORS.floor;
export const STACK_EDGE_COLOR = STACK_COLORS.edge;
export const LINK_COLORS = { elevator: PICTOGRAM_COLORS.elevator, stairs: PICTOGRAM_COLORS.stairs } as const;

/** tier 0: 고른 층 바로 위 층(또는 건물을 고르지 않았을 때의 모든 층), 1: 그보다 위 층(더 옅게). */
export interface SlabProps { buildingId: string; level: Level; baseM: number; topM: number; picked: boolean; tier: 0 | 1 }
/** 슬래브 윗변·아랫변의 경계 띠 하나. */
export interface RimProps { buildingId: string; tier: 0 | 1; baseM: number; topM: number }
/** 세로 연결 한 조각: `line` = 층 사이를 잇는 가는 세로 선분, `foot` = 정류장·계단참 자리의 작은 바닥 표식. */
export interface LinkProps { buildingId: string; kind: 'elevator' | 'stairs'; part: 'line' | 'foot'; baseM: number; topM: number; color: string }
export interface Stack3D {
  slabs: FeatureCollection<Polygon, SlabProps>;
  /** 엘리베이터(보라)·계단(주황) 세로 선분과 바닥 표식. */
  links: FeatureCollection<Polygon, LinkProps>;
  /** 슬래브 경계 띠(유리판의 테두리). */
  rims: FeatureCollection<Polygon, RimProps>;
  /** 고른 건물이 있을 때 다른 건물의 외곽선. */
  outlines: FeatureCollection<Polygon, { buildingId: string }>;
}

/** 그래프의 건물 Feature → 코어 buildingStack이 받는 EditBuilding 모양(얇은 어댑터). */
export const asEditBuilding = (b: BuildingFeature): Pick<EditBuilding, 'id' | 'polygon' | 'props'> => ({ id: b.id, polygon: b.geometry.coordinates, props: b.properties });

/** 층이 둘 이상이라 세울 것이 있는 건물인가. */
export const isStackable = (b: BuildingFeature): boolean => new Set(b.properties.levels).size > 1;

const M_PER_DEG_LAT = 110_540, M_PER_DEG_LNG = 111_320;
/** 점 둘 사이 거리(m), 평면 근사. */
const metres = (a: Position, b: Position) => Math.hypot((b[0]! - a[0]!) * M_PER_DEG_LNG * Math.cos((a[1]! * Math.PI) / 180), (b[1]! - a[1]!) * M_PER_DEG_LAT);
/** `center` 둘레 한 변 `sideM`의 정사각형(닫힌 고리). */
export function squareAround(center: Position, sideM: number): Position[][] {
  const dx = sideM / 2 / (M_PER_DEG_LNG * Math.cos((center[1]! * Math.PI) / 180));
  const dy = sideM / 2 / M_PER_DEG_LAT;
  const [x, y] = [center[0]!, center[1]!];
  return [[[x - dx, y - dy], [x + dx, y - dy], [x + dx, y + dy], [x - dx, y + dy], [x - dx, y - dy]]];
}

/** 쌓을 층과 상대 높이: anchor 층의 바닥이 0 m. anchor보다 아래층은 뺀다. */
function relativeFloors(b: BuildingFeature, anchor: Level | null): { level: Level; baseM: number; topM: number; outline: Position[][] }[] {
  const stack = buildingStack(asEditBuilding(b));
  const at = stack.find((f) => f.level === anchor) ?? stack.find((f) => f.level === 1) ?? stack.find((f) => f.baseM >= 0) ?? stack[0];
  if (!at) return [];
  return stack.filter((f) => f.baseM >= at.baseM - 1e-6).map((f) => ({ level: f.level, baseM: f.baseM - at.baseM, topM: f.topM - at.baseM, outline: f.outline }));
}

/**
 * 3D 보기 재료. `buildingId`(실내로 들어간 건물, 없으면 층 선택이 열린 건물)와 `level`(지금 층, 없으면 1층 기준).
 * `pickedId`: 층 선택이 열린 건물(아무 건물도 들어가지 않았을 때 조금 진하게).
 */
export function stack3d(graph: CampusGraph | null, buildingId: string | null, level: Level | null, pickedId: string | null = null): Stack3D {
  const slabs: Stack3D['slabs']['features'] = [];
  const links: Stack3D['links']['features'] = [];
  const outlines: Stack3D['outlines']['features'] = [];
  const rims: Stack3D['rims']['features'] = [];
  const empty = (): Stack3D => ({ slabs: { type: 'FeatureCollection', features: slabs }, links: { type: 'FeatureCollection', features: links }, rims: { type: 'FeatureCollection', features: rims }, outlines: { type: 'FeatureCollection', features: outlines } });
  if (!graph) return empty();
  const selected = buildingId ? graph.buildings.get(buildingId) : undefined;
  for (const b of graph.buildings.values()) {
    if (selected && b.id !== selected.id) {
      outlines.push({ type: 'Feature', properties: { buildingId: b.id }, geometry: { type: 'Polygon', coordinates: b.geometry.coordinates } });
      continue;
    }
    if (!isStackable(b)) continue;
    const floors = relativeFloors(b, selected ? level : 1);
    let above = 0;
    for (const f of floors) {
      // 고른 층은 지면의 2D 도면(외곽선·선·아이콘)이 그대로 그 층이다: 슬래브를 겹치지 않는다.
      if (selected && f.baseM <= 1e-6) continue;
      // 바닥 높이 기준 얇은 유리판 하나만: 층 전체를 블록으로 채우지 않는다(짧은 층에서도 최소 0.2 m는 유지).
      const top = Math.max(f.baseM + 0.2, Math.min(f.baseM + SLAB_THICKNESS_M, f.topM - 0.05));
      const tier: 0 | 1 = selected && above++ > 0 ? 1 : 0;
      const baseM = round(f.baseM), topM = round(top);
      slabs.push({ type: 'Feature', properties: { buildingId: b.id, level: f.level, baseM, topM, picked: b.id === pickedId, tier }, geometry: { type: 'Polygon', coordinates: f.outline } });
      const band = Math.min(RIM_H_M, (topM - baseM) / 2);
      for (const quad of edgeBands(f.outline, RIM_W_M)) {
        rims.push({ type: 'Feature', properties: { buildingId: b.id, tier, baseM, topM: round(baseM + band) }, geometry: { type: 'Polygon', coordinates: [quad] } });
        rims.push({ type: 'Feature', properties: { buildingId: b.id, tier, baseM: round(topM - band), topM }, geometry: { type: 'Polygon', coordinates: [quad] } });
      }
    }
    if (selected) links.push(...verticalLinks(graph, b.id, floors));
  }
  return empty();
}

const round = (m: number) => Math.round(m * 100) / 100;

/**
 * 외곽선의 변마다 변을 가운데 둔 폭 `widthM`(m)의 가는 사각형(닫힌 고리). 3D 보기에서 이것을 슬래브 위·아래 끝 높이로 세우면
 * 유리판의 테두리처럼 보인다. 길이가 거의 없는 변(같은 점 반복)은 건너뛴다. 안쪽 고리(구멍)의 변도 같다.
 */
export function edgeBands(outline: readonly (readonly Position[])[], widthM: number): Position[][] {
  const out: Position[][] = [];
  for (const ring of outline) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i]!, b = ring[i + 1]!;
      const kx = M_PER_DEG_LNG * Math.cos((a[1]! * Math.PI) / 180), ky = M_PER_DEG_LAT;
      const dx = (b[0]! - a[0]!) * kx, dy = (b[1]! - a[1]!) * ky;
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      // 변에 수직인 단위 벡터(m) × 폭의 절반 → 도.
      const ox = (-dy / len) * (widthM / 2) / kx, oy = (dx / len) * (widthM / 2) / ky;
      out.push([[a[0]! + ox, a[1]! + oy], [b[0]! + ox, b[1]! + oy], [b[0]! - ox, b[1]! - oy], [a[0]! - ox, a[1]! - oy], [a[0]! + ox, a[1]! + oy]]);
    }
  }
  return out;
}

/**
 * 고른 건물의 세로 연결(층 번호는 높이를 찾는 데만 쓴다).
 * - 엘리베이터: 같은 elevator_id 정류장들의 가운데에 가장 낮은 정류장 층 바닥 → 가장 높은 정류장 층 바닥까지 끊김 없는 선분 하나,
 *   정류장마다 그 층 바닥에 작은 표식.
 * - 계단: 인접 층 같은 자리(STAIR_PAIR_M 안)의 계단참 쌍마다 아래층 바닥 → 위층 바닥 선분. 위·아래 쌍이 같은 계단참을 공유하면
 *   같은 높이에서 만나 층을 건너 이어진다. 계단참마다 바닥 표식.
 */
export function verticalLinks(graph: CampusGraph, buildingId: string, floors: readonly { level: Level; baseM: number; topM: number }[]): Stack3D['links']['features'] {
  const byLevel = new Map(floors.map((f) => [f.level, f]));
  const order = floors.map((f) => f.level);
  const out: Stack3D['links']['features'] = [];
  const shafts = new Map<string, { level: Level; at: Position }[]>();
  const landings = new Map<Level, Position[]>();
  for (const n of graph.nodes.values()) {
    const p = n.properties;
    if (p.building_id !== buildingId || typeof p.level !== 'number' || !byLevel.has(p.level)) continue;
    const at = n.geometry.coordinates as Position;
    if (p.node_type === 'elevator_stop' && p.elevator_id) shafts.set(p.elevator_id, [...(shafts.get(p.elevator_id) ?? []), { level: p.level, at }]);
    else if (p.node_type === 'stair_landing') landings.set(p.level, [...(landings.get(p.level) ?? []), at]);
  }
  const line = (kind: LinkProps['kind'], at: Position, baseM: number, topM: number) => out.push({ type: 'Feature',
    properties: { buildingId, kind, part: 'line', baseM: round(baseM), topM: round(topM), color: LINK_COLORS[kind] }, geometry: { type: 'Polygon', coordinates: squareAround(at, LINK_W_M) } });
  const foot = (kind: LinkProps['kind'], at: Position, baseM: number) => out.push({ type: 'Feature',
    properties: { buildingId, kind, part: 'foot', baseM: round(baseM), topM: round(baseM + LINK_FOOT_H_M), color: LINK_COLORS[kind] }, geometry: { type: 'Polygon', coordinates: squareAround(at, LINK_FOOT_M) } });
  for (const stops of shafts.values()) {
    const levels = [...new Set(stops.map((s) => s.level))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (levels.length < 2) continue;
    const low = byLevel.get(levels[0]!)!, high = byLevel.get(levels[levels.length - 1]!)!;
    const center: Position = [stops.reduce((s, x) => s + x.at[0]!, 0) / stops.length, stops.reduce((s, x) => s + x.at[1]!, 0) / stops.length];
    line('elevator', center, low.baseM, high.baseM + LINK_FOOT_H_M);
    for (const level of levels) foot('elevator', center, byLevel.get(level)!.baseM);
  }
  const footed = new Set<string>();
  const footOnce = (at: Position, level: Level) => {
    const key = `${level}:${at[0]}:${at[1]}`;
    if (footed.has(key)) return;
    footed.add(key);
    foot('stairs', at, byLevel.get(level)!.baseM);
  };
  for (let i = 0; i + 1 < order.length; i++) {
    const lower = landings.get(order[i]!) ?? [], upper = landings.get(order[i + 1]!) ?? [];
    const used = new Set<number>();
    for (const a of lower) {
      let best = -1, bestM = STAIR_PAIR_M;
      upper.forEach((b, j) => { const m = metres(a, b); if (!used.has(j) && m <= bestM) { best = j; bestM = m; } });
      if (best < 0) continue;
      used.add(best);
      const b = upper[best]!;
      // 선분은 위층 계단참 자리에 세운다: 그 위 쌍의 선분도 같은 자리(그 층의 아래 계단참)에서 시작하면 끊김 없이 이어진다.
      line('stairs', b, byLevel.get(order[i]!)!.baseM, byLevel.get(order[i + 1]!)!.baseM + LINK_FOOT_H_M);
      footOnce(a, order[i]!);
      footOnce(b, order[i + 1]!);
    }
  }
  return out;
}
