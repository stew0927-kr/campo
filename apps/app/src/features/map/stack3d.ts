// "3D 보기": 건물을 층별로 세워 MapLibre fill-extrusion으로 그릴 재료. React를 import하지 않는 순수 모듈.
// 높이는 코어 buildingStack(측정 층고 → 건물 ext.floor_height_m → 3.9 m)을 그대로 쓴다. 화면 표시용이며 길찾기는 층 번호를 보지 않는다.
//
// MapLibre 네이티브의 선·점·아이콘(그리고 React Native Marker)은 고도를 줄 수 없어 항상 지면(0 m)에 그려진다. 그래서 건물·층을
// 고른 3D 보기에서는 고른 층을 지면에 두고(그 층의 도면 선·시설 아이콘이 그 층 위에 정확히 놓이게) 그 위층들을 실제 층고대로
// 쌓는다. 고른 층보다 아래층은 지면 아래라 세우지 않는다(fill-extrusion은 0 m 아래로 내려가지 않는다).
// - 고른 건물: 위층 슬래브(옅게, 층 사이 틈) + 엘리베이터 기둥(같은 elevator_id 정류장) + 계단 기둥(인접 층 같은 자리의 계단참).
// - 다른 건물: 슬래브 대신 외곽선만.
// - 아무 건물도 고르지 않았으면: 층이 둘 이상인 건물을 모두 1층을 지면에 두고 옅게 세운다(기둥 없음).
//
// 유리판처럼 보이게(편집기 deck3d의 wireframe 슬래브와 같은 인상): 슬래브는 아주 옅게 칠하고, 슬래브의 윗변·아랫변을 따라 가는 띠
// (rims, 폭 RIM_W_M·높이 RIM_H_M)를 진하게 세워 층판 경계를 읽게 한다. MapLibre의 선 레이어는 지면에만 그려지고 fill-extrusion-color의
// 알파는 무시되므로(레이어 opacity 하나만 쓴다) 경계는 띠로, 층별 농도는 tier(바로 위 층 0 / 그 위 1)별 레이어로 나눠 준다.
import { PICTOGRAM_COLORS, STACK_COLORS, buildingStack, type CampusGraph, type BuildingFeature, type EditBuilding, type Level } from '@campo/core';
import type { FeatureCollection, Polygon, Position } from 'geojson';

/** 층 슬래브 사이 틈(m): 층이 한 덩어리로 붙어 보이지 않게. */
export const SLAB_GAP_M = 0.6;
/** 계단참 두 개가 이 거리(m) 안이면 같은 계단(아래층 ↔ 위층)으로 본다. */
export const STAIR_PAIR_M = 6;
/** 기둥 한 변(m). */
export const ELEVATOR_PILLAR_M = 1.6;
export const STAIR_PILLAR_M = 1.1;
/** 유리판 경계 띠: 변을 가운데 두고 폭(m), 슬래브 위·아래 끝에서의 높이(m). */
export const RIM_W_M = 0.35;
export const RIM_H_M = 0.22;
/** 3D 보기에서 카메라 기울기(도). */
export const STACK_PITCH_DEG = 50;

export const STACK_FLOOR_COLOR = STACK_COLORS.floor;
export const STACK_EDGE_COLOR = STACK_COLORS.edge;
export const PILLAR_COLORS = { elevator: PICTOGRAM_COLORS.elevator, stairs: PICTOGRAM_COLORS.stairs } as const;

/** tier 0: 고른 층 바로 위 층(또는 건물을 고르지 않았을 때의 모든 층), 1: 그보다 위 층(더 옅게). */
export interface SlabProps { buildingId: string; level: Level; baseM: number; topM: number; picked: boolean; tier: 0 | 1 }
/** 슬래브 윗변·아랫변의 경계 띠 하나. */
export interface RimProps { buildingId: string; tier: 0 | 1; baseM: number; topM: number }
export interface PillarProps { buildingId: string; kind: 'elevator' | 'stairs'; baseM: number; topM: number; color: string }
export interface Stack3D {
  slabs: FeatureCollection<Polygon, SlabProps>;
  pillars: FeatureCollection<Polygon, PillarProps>;
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
  const pillars: Stack3D['pillars']['features'] = [];
  const outlines: Stack3D['outlines']['features'] = [];
  const rims: Stack3D['rims']['features'] = [];
  const empty = (): Stack3D => ({ slabs: { type: 'FeatureCollection', features: slabs }, pillars: { type: 'FeatureCollection', features: pillars }, rims: { type: 'FeatureCollection', features: rims }, outlines: { type: 'FeatureCollection', features: outlines } });
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
      const top = Math.max(f.baseM + 0.2, f.topM - SLAB_GAP_M);
      const tier: 0 | 1 = selected && above++ > 0 ? 1 : 0;
      const baseM = round(f.baseM), topM = round(top);
      slabs.push({ type: 'Feature', properties: { buildingId: b.id, level: f.level, baseM, topM, picked: b.id === pickedId, tier }, geometry: { type: 'Polygon', coordinates: f.outline } });
      const band = Math.min(RIM_H_M, (topM - baseM) / 2);
      for (const quad of edgeBands(f.outline, RIM_W_M)) {
        rims.push({ type: 'Feature', properties: { buildingId: b.id, tier, baseM, topM: round(baseM + band) }, geometry: { type: 'Polygon', coordinates: [quad] } });
        rims.push({ type: 'Feature', properties: { buildingId: b.id, tier, baseM: round(topM - band), topM }, geometry: { type: 'Polygon', coordinates: [quad] } });
      }
    }
    if (selected) pillars.push(...verticalLinks(graph, b.id, floors));
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
 * 고른 건물의 세로 연결: 같은 elevator_id 정류장(쌓은 층 중 가장 낮은 층 바닥 → 가장 높은 층 천장), 인접 층 같은 자리(STAIR_PAIR_M
 * 안)의 계단참(아래층 바닥 → 위층 천장). 층 번호는 높이를 찾는 데만 쓴다.
 */
export function verticalLinks(graph: CampusGraph, buildingId: string, floors: readonly { level: Level; baseM: number; topM: number }[]): Stack3D['pillars']['features'] {
  const byLevel = new Map(floors.map((f) => [f.level, f]));
  const order = floors.map((f) => f.level);
  const out: Stack3D['pillars']['features'] = [];
  const shafts = new Map<string, { level: Level; at: Position }[]>();
  const landings = new Map<Level, Position[]>();
  for (const n of graph.nodes.values()) {
    const p = n.properties;
    if (p.building_id !== buildingId || typeof p.level !== 'number' || !byLevel.has(p.level)) continue;
    const at = n.geometry.coordinates as Position;
    if (p.node_type === 'elevator_stop' && p.elevator_id) shafts.set(p.elevator_id, [...(shafts.get(p.elevator_id) ?? []), { level: p.level, at }]);
    else if (p.node_type === 'stair_landing') landings.set(p.level, [...(landings.get(p.level) ?? []), at]);
  }
  for (const stops of shafts.values()) {
    const levels = [...new Set(stops.map((s) => s.level))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (levels.length < 2) continue;
    const low = byLevel.get(levels[0]!)!, high = byLevel.get(levels[levels.length - 1]!)!;
    const center: Position = [stops.reduce((s, x) => s + x.at[0]!, 0) / stops.length, stops.reduce((s, x) => s + x.at[1]!, 0) / stops.length];
    out.push({ type: 'Feature', properties: { buildingId, kind: 'elevator', baseM: round(low.baseM), topM: round(high.topM), color: PILLAR_COLORS.elevator }, geometry: { type: 'Polygon', coordinates: squareAround(center, ELEVATOR_PILLAR_M) } });
  }
  for (let i = 0; i + 1 < order.length; i++) {
    const lower = landings.get(order[i]!) ?? [], upper = landings.get(order[i + 1]!) ?? [];
    const used = new Set<number>();
    for (const a of lower) {
      let best = -1, bestM = STAIR_PAIR_M;
      upper.forEach((b, j) => { const m = metres(a, b); if (!used.has(j) && m <= bestM) { best = j; bestM = m; } });
      if (best < 0) continue;
      used.add(best);
      const b = upper[best]!;
      const center: Position = [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2];
      out.push({ type: 'Feature', properties: { buildingId, kind: 'stairs', baseM: round(byLevel.get(order[i]!)!.baseM), topM: round(byLevel.get(order[i + 1]!)!.topM), color: PILLAR_COLORS.stairs }, geometry: { type: 'Polygon', coordinates: squareAround(center, STAIR_PILLAR_M) } });
    }
  }
  return out;
}
