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
  focus?: { lat: number; lng: number; key: number } | null;
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
}
