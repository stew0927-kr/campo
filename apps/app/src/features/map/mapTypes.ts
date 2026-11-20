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
}
