// useRoutePhotos: useCampusRoute가 준 경로에 단계별 사진(고른 사진·화살표·배지)을 붙인다.
// 경로나 카탈로그가 바뀔 때만 다시 계산한다. 경로가 없거나 카탈로그가 비면 [](사진 없이 문구·지도로 안내).
import { useMemo } from 'react';
import type { CampusRouteView, PhotoCatalog, RouteStepPhoto } from '../contracts.ts';
import { routeStepPhotos } from '../photos/routePhotos.ts';

/**
 * @param route useCampusRoute(...).route (없으면 null)
 * @param catalog 사진 공급자(조원 D: photoCatalogFromRows(rows)). 아직 없으면 null이나 EMPTY_PHOTO_CATALOG.
 * @returns 단계마다 하나 + 도착 지점 하나(stepIndex = steps.length). 카탈로그 객체는 바뀔 때만 새로 만들어 넘긴다.
 */
export function useRoutePhotos(route: CampusRouteView | null, catalog: PhotoCatalog | null): RouteStepPhoto[] {
  return useMemo(() => routeStepPhotos(route, catalog), [route, catalog]);
}
