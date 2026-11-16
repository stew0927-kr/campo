// useCampusRoute: 출발·도착·모드가 정해지면 경로를 찾아 화면이 그릴 수 있는 모양으로 돌려준다.
// 경로 계산은 코어 호출이라 비용이 있으므로, 요청 객체가 바뀔 때만 다시 계산한다(같은 내용이면 useMemo로 감싸 넘긴다).
import { useMemo } from 'react';
import type { CampusRuntime } from '../campus/types.ts';
import type { CampusRouteRequest, CampusRouteState } from '../contracts.ts';
import { computeRoute } from '../route/routeEngine.ts';

/**
 * @param runtime useCampusData().graph가 준 캠퍼스(없으면 null)
 * @param request 출발·도착·모드. from이나 to가 null이면 idle을 돌려준다.
 */
export function useCampusRoute(runtime: CampusRuntime | null, request: CampusRouteRequest | null): CampusRouteState {
  return useMemo(() => computeRoute(runtime, request), [runtime, request]);
}
