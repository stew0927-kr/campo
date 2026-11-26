import type { CampusGraph } from '@campo/core';
import type { CampusPlace, CampusRouteView, RoutePoint } from '../../contracts.ts';
import type { MarkerEntry, MarkerGroup, PhotoSpot } from '../../photos/roadviewModel.ts';

/** Thumbnail speech bubble over a roadview point (Naver-style preview). */
export interface RoadviewPreview {
  key: string;
  lngLat: [number, number];
  thumbUrl: string | null;
  title: string;
  subtitle: string;
  /** Route steps at this point. More than one (a round trip passing twice) shows a "가는 길 / 오는 길" choice. */
  entries: MarkerEntry[];
}

export interface MapProps {
  center: RoutePoint;
  label: string;
  route: CampusRouteView | null;
  from: CampusPlace | null;
  to: CampusPlace | null;
  places: readonly CampusPlace[];
  graph: CampusGraph | null;
  buildingId: string | null;
  level: number | null;
  position: RoutePoint | null;
  flow: 'enter' | 'queue' | 'exit' | null;
  onPoint: (point: RoutePoint) => void;
  onPlace: (place: CampusPlace) => void;
  /** Move the camera to this point whenever `key` changes (search result, my location). */
  focus?: { lat: number; lng: number; key: number; zoom?: number } | null;
  /** A place picked from search or the map, shown before it becomes a start or end. */
  selected?: CampusPlace | null;
  /** Screen space covered by floating overlays, so fitted routes stay visible. */
  fitPadding?: { top: number; bottom: number; left: number; right: number };
  /** Points with roadview photos (shown without a route too). */
  photoSpots?: readonly PhotoSpot[];
  onPhotoSpot?: (spot: PhotoSpot) => void;
  /** Route steps with photos, grouped by coordinate so a point passed twice keeps both steps. */
  stepGroups?: readonly MarkerGroup[];
  onStepGroup?: (group: MarkerGroup) => void;
  /** Bubble shown over the map; tapping it (or one of its entries) opens the split roadview. */
  preview?: RoadviewPreview | null;
  /** entry: index into the route's roadview frames, or null for a stand-alone photo point. */
  onOpenPreview?: (entry: number | null) => void;
  /** 실내 매핑 건물을 은은하게 구분하고 누를 수 있게 한다(기본 지도). 위치 고르기·위치 안내 중에는 끈다. */
  highlightBuildings?: boolean;
  /** 실내 매핑 데이터가 있어 들어갈 수 있는 건물 id(장소가 1곳 이상). */
  mappedBuildingIds?: readonly string[];
  /** 강조된 건물을 눌렀을 때(장소 점·경로 탭과 겹치지 않게 전파를 멈춘다). */
  onBuildingPress?: (buildingId: string) => void;
  /** 지금 층 선택이 열린 건물: 테두리를 진하고 굵게 강조한다. */
  pickedBuildingId?: string | null;
  /** 검색에서 골라 카메라를 옮긴 건물: 은은한 점선 테두리로 문맥을 남긴다. */
  markedBuildingId?: string | null;
  /** 경로의 한 구간(급경사 카드)을 주황 선으로 강조한다. `key`가 바뀌면 카메라가 그 구간으로 맞춰 이동한다. */
  highlight?: { key: string; coordinates: [number, number][] } | null;
  /**
   * 위치 안내의 지금 단계 구간. 진하게 그리고, `key`가 바뀌면 카메라가 그 구간으로 부드럽게 이동한다(실내 층 맞춤보다 나중에
   * 적용된다). `bearingDeg`가 있으면 그 방위가 화면 위쪽이 되게 돌리고 기울인다(없으면 정북·평면으로 구간 맞춤).
   * 사용자가 손으로 지도를 돌리면 다음 단계로 넘어갈 때까지 그 방위를 지킨다.
   */
  stepFocus?: { key: string; coordinates: [number, number][]; bearingDeg?: number | null } | null;
  /**
   * 3D 보기(층별 수직 분리): 건물 층을 fill-extrusion으로 세우고 카메라를 기울인다. 고른 건물만 층·엘리베이터·계단 기둥,
   * 다른 건물은 외곽선만.
   */
  threeD?: boolean;
  /** 지도를 길게 눌렀을 때 그 좌표. 화면이 핀을 띄우고 출발/도착을 고르게 한다. */
  onLongPress?: (point: RoutePoint) => void;
  /** 길게 눌러 띄운 핀(없으면 null). */
  pressPin?: RoutePoint | null;
  /** 지도 가운데 핀으로 위치 고르기: 카메라가 멈출 때마다(그리고 처음 한 번) 화면 가운데 좌표를 알린다. */
  onCenter?: (point: RoutePoint) => void;
}
