import type { RoutePoint } from '../../contracts.ts';
/** Mini map under the roadview photo: the point being viewed and the photo's field of view. */
export interface RoadviewMiniMapProps {
  lngLat: [number, number] | null;
  /** Direction the photo looks (degrees from north). null: no field-of-view cone. */
  headingDeg: number | null;
  hfovDeg?: number;
  /** Route drawn under the point, if any. */
  route?: readonly RoutePoint[] | null;
  /** Other roadview points on the route (dimmed). */
  stops?: readonly [number, number][];
  label: string;
}
