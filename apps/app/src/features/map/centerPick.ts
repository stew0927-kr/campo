// 지도 가운데 핀으로 출발·도착 고르기(네이버 지도 위치 지정 방식)에서 핀 아래 위치를 설명한다. React를 import하지 않는 순수 모듈.
import { getBuildingOutlineForLevel, plazaAt, type CampusGraph } from '@campo/core';
import type { CampusPlace, RoutePoint } from '../../contracts.ts';
import { distanceM, insideOutline } from './model.ts';

/** 핀이 등록된 실외 지점에서 이 거리(m) 안이면 그 지점으로 고른다(지점 이름·연결을 그대로 쓴다). */
export const PICK_SNAP_PLACE_M = 6;
/** 이 거리(m) 안의 지점은 "○○ 근처"로 위치를 설명한다. */
export const PICK_NEAR_PLACE_M = 40;

export interface CenterPickInfo {
  /** 하단에 크게 보일 위치 이름. */
  title: string;
  /** 한 줄 설명(평지 안·건물·가까운 지점까지 거리). */
  detail: string;
  /** 확인을 누르면 고를 등록 지점(핀이 지점 바로 위일 때), 아니면 null(지도 위 점으로 고른다). */
  place: CampusPlace | null;
}

/** 지점 이름에 쓸 건물 이름: 핀이 실내 매핑 건물 외곽선 안이면 그 건물. */
function buildingAt(graph: CampusGraph | null, point: RoutePoint): string | null {
  if (!graph) return null;
  for (const building of graph.buildings.values()) {
    const outline = getBuildingOutlineForLevel(building, null);
    if (outline && insideOutline(point, outline)) return building.properties.name ?? null;
  }
  return null;
}

/**
 * 핀 아래 위치 설명. 실외 지점만 견준다(지도에서 고르기는 실외 지도에서 한다).
 * `places`는 지금 보이는 장소(실외면 buildingId가 null인 장소).
 */
export function centerPickInfo(graph: CampusGraph | null, places: readonly CampusPlace[], point: RoutePoint): CenterPickInfo {
  let nearest: { place: CampusPlace; m: number } | null = null;
  for (const place of places) {
    if (place.buildingId !== null) continue;
    const m = distanceM([point.lng, point.lat], [place.lng, place.lat]);
    if (!nearest || m < nearest.m) nearest = { place, m };
  }
  if (nearest && nearest.m <= PICK_SNAP_PLACE_M) {
    return { title: nearest.place.name, detail: '등록된 지점입니다.', place: nearest.place };
  }
  const plaza = graph ? plazaAt(graph, [point.lng, point.lat]) : null;
  const inPlaza = plaza?.hit === 'solid';
  const plazaName = inPlaza && typeof plaza.plaza.properties.name === 'string' && plaza.plaza.properties.name !== '' ? plaza.plaza.properties.name : null;
  const building = buildingAt(graph, point);
  const near = nearest && nearest.m <= PICK_NEAR_PLACE_M ? `${nearest.place.name}에서 약 ${Math.round(nearest.m)}m` : null;
  const title = plazaName ?? (building ? `${building} 앞` : near ? `${nearest!.place.name} 근처` : '지도에서 선택한 위치');
  const detail = [inPlaza ? '평지(광장) 안 · 평지 안으로 걸어 안내합니다' : null, near].filter(Boolean).join(' · ') || '가장 가까운 걷는 길에 이어 안내합니다.';
  return { title, detail, place: null };
}

/** 길게 누른 핀이 가장 가까운 실외 지점에서 이보다 멀면(m) 경로를 못 찾을 수 있다고 미리 알린다. */
export const PRESS_FAR_M = 120;
export const PRESS_FAR_TEXT = '캠퍼스 걷는 길에서 멀어 경로를 찾지 못할 수 있습니다. 찾지 못하면 길 가까이를 다시 길게 눌러 주세요.';

/** 길게 누른 지점의 핀 설명: 가운데 핀 고르기와 같은 문구에, 걷는 길에서 멀면 안내를 붙인다. */
export function pressPinInfo(graph: CampusGraph | null, places: readonly CampusPlace[], point: RoutePoint): CenterPickInfo & { far: boolean } {
  const info = centerPickInfo(graph, places, point);
  let nearest = Number.POSITIVE_INFINITY;
  for (const node of graph?.nodes.values() ?? []) {
    if ((node.properties.building_id ?? null) !== null) continue;
    const [lng, lat] = node.geometry.coordinates;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    nearest = Math.min(nearest, distanceM([point.lng, point.lat], [lng, lat]));
  }
  const far = graph !== null && nearest > PRESS_FAR_M;
  return { ...info, detail: far ? PRESS_FAR_TEXT : info.detail, far };
}
