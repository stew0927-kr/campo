// 지도 위 건물 윤곽·이름표·층 고르기에 쓰는 순수 함수. React를 import하지 않는다.
// 실내 매핑 데이터가 있어 들어갈 수 있는 건물(장소가 1곳 이상)만 강조하고, 그 모양·가운데·층 칩 문구를 만든다.
import { getBuildingOutlineForLevel, type CampusGraph } from '@campo/core';
import type { FeatureCollection, Polygon } from 'geojson';
import type { CampusBuilding, CampusPlace, RoutePoint } from '../../contracts.ts';
import type { BuildingLabel } from './mapLabels.ts';
import { OUTDOOR_GROUP, buildingGroups } from './placeTree.ts';

/** 실내 매핑 건물(buildingGroups 기준 장소 수 > 0), 장소가 많은 순. */
export function mappedBuildings(places: readonly CampusPlace[], buildings: readonly CampusBuilding[]): CampusBuilding[] {
  return buildingGroups(places, buildings)
    .filter((g) => g.id !== OUTDOOR_GROUP)
    .map((g) => buildings.find((b) => b.id === g.id))
    .filter((b): b is CampusBuilding => b !== undefined);
}

/** 강조할 건물 모양(feature 속성 id·name·current). 그래프에 없는 건물은 뺀다. */
export function buildingShapes(graph: CampusGraph | null, ids: readonly string[], currentId: string | null = null, pickedId: string | null = null): FeatureCollection<Polygon> {
  const features: FeatureCollection<Polygon>['features'] = [];
  for (const id of ids) {
    const building = graph?.buildings.get(id);
    if (!building) continue;
    features.push({ type: 'Feature', properties: { id, name: building.properties.name, current: id === currentId, picked: id === pickedId }, geometry: { type: 'Polygon', coordinates: getBuildingOutlineForLevel(building) } });
  }
  return { type: 'FeatureCollection', features };
}

/** 건물 가운데: 건물 외곽선 꼭짓점의 평균, 외곽선이 없으면 그 건물 장소들의 평균 좌표. 둘 다 없으면 null. */
export function buildingCenter(graph: CampusGraph | null, id: string, places: readonly CampusPlace[]): RoutePoint | null {
  const ring = graph?.buildings.get(id)?.geometry.coordinates[0];
  if (ring && ring.length > 1) {
    // 닫힌 고리의 마지막 점(첫 점과 같음)은 한 번만 센다.
    const corners = ring.slice(0, -1);
    const sum = corners.reduce((acc, [lng, lat]) => ({ lng: acc.lng + (lng ?? 0), lat: acc.lat + (lat ?? 0) }), { lng: 0, lat: 0 });
    return { lng: sum.lng / corners.length, lat: sum.lat / corners.length };
  }
  const own = places.filter((p) => p.buildingId === id);
  if (!own.length) return null;
  return { lng: own.reduce((s, p) => s + p.lng, 0) / own.length, lat: own.reduce((s, p) => s + p.lat, 0) / own.length };
}

const M_PER_DEG_LAT = 110_540, M_PER_DEG_LNG = 111_320;
/**
 * 지도에 얹을 건물 이름표 재료: 이름이 있는 건물마다 가운데(buildingCenter), 이름, 외곽선 긴 변(m).
 * `tappableIds`에 든 건물(실내 매핑 건물)은 이름을 눌러 층 선택을 열 수 있다. 그래프가 같으면 결과를 다시 쓸 수 있도록 호출 쪽이 memo한다.
 */
export function buildingLabels(graph: CampusGraph | null, tappableIds: readonly string[] = []): BuildingLabel[] {
  if (!graph) return [];
  const tappable = new Set(tappableIds);
  const out: BuildingLabel[] = [];
  for (const [id, building] of graph.buildings) {
    const name = building.properties.name?.trim();
    const center = buildingCenter(graph, id, []);
    const ring = building.geometry.coordinates[0];
    if (!name || !center || !ring) continue;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lng, lat] of ring) {
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
    const spanM = Math.max((maxLng - minLng) * M_PER_DEG_LNG * Math.cos((center.lat * Math.PI) / 180), (maxLat - minLat) * M_PER_DEG_LAT);
    out.push({ id, name, lng: center.lng, lat: center.lat, spanM: Number.isFinite(spanM) ? spanM : 0, tappable: tappable.has(id) });
  }
  return out;
}

/** 층 칩 글자: B1 / 1F. */
export const levelChip = (level: number) => (level < 0 ? `B${-level}` : `${level}F`);
/** 층 읽기 문구: 지하 1층 / 3층. */
export const levelName = (level: number) => (level < 0 ? `지하 ${-level}층` : `${level}층`);

/** 층 선택 결과: 층이 하나뿐이면 바로 들어가고, 여럿이면 고르게 한다. */
export function floorChoice(building: Pick<CampusBuilding, 'levels'>): { kind: 'enter'; level: number } | { kind: 'pick'; levels: number[] } | { kind: 'none' } {
  const levels = [...new Set(building.levels)].sort((a, b) => a - b);
  if (levels.length === 0) return { kind: 'none' };
  return levels.length === 1 ? { kind: 'enter', level: levels[0]! } : { kind: 'pick', levels };
}
