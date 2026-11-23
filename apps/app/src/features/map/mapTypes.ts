import type { CampusGraph } from '@campo/core';
import type { CampusPlace, CampusRouteView, RoutePoint, RouteStepPhoto } from '../../contracts.ts';
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
  stepPhotos?: readonly RouteStepPhoto[];
  onOpenPhoto?: (index: number) => void;
  onPoint: (point: RoutePoint) => void;
  onPlace: (place: CampusPlace) => void;
  /** Move the camera to this point whenever `key` changes (search result, my location). */
  focus?: { lat: number; lng: number; key: number } | null;
  /** A place picked from search or the map, shown before it becomes a start or end. */
  selected?: CampusPlace | null;
  /** Screen space covered by floating overlays, so fitted routes stay visible. */
  fitPadding?: { top: number; bottom: number; left: number; right: number };
}
