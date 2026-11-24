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
  /** '건물에서 층 고르기' 토글이 켜졌을 때 실내 매핑 건물을 강조하고 누를 수 있게 한다. */
  highlightBuildings?: boolean;
  /** 실내 매핑 데이터가 있어 들어갈 수 있는 건물 id(장소가 1곳 이상). */
  mappedBuildingIds?: readonly string[];
  /** 강조된 건물을 눌렀을 때(장소 점·경로 탭과 겹치지 않게 전파를 멈춘다). */
  onBuildingPress?: (buildingId: string) => void;
  /** 검색에서 골라 카메라를 옮긴 건물: 은은한 점선 테두리로 문맥을 남긴다. */
  markedBuildingId?: string | null;
  /** 경로의 한 구간(급경사 카드)을 주황 선으로 강조한다. `key`가 바뀌면 카메라가 그 구간으로 맞춰 이동한다. */
  highlight?: { key: string; coordinates: [number, number][] } | null;
}
