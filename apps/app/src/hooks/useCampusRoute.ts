// useCampusRoute: 출발·도착·모드가 정해지면 경로를 찾아 화면이 그릴 수 있는 모양으로 돌려준다.
// 경로 계산은 코어 호출이라 비용이 있으므로, 요청의 내용(출발·도착·모드)이 바뀔 때만 다시 계산한다.
// 화면이 매 렌더 새 요청 객체를 넘겨도(인라인 객체) 내용이 같으면 같은 결과 객체를 그대로 돌려준다.
import { useMemo } from 'react';
import type { CampusRuntime } from '../campus/types.ts';
import type { CampusRouteRequest, CampusRouteState } from '../contracts.ts';
import { computeRoute } from '../route/routeEngine.ts';
import { routeRequestKey } from './memoKeys.ts';

/**
 * @param runtime useCampusData().runtime이 준 캠퍼스(없으면 null)
 * @param request 출발·도착·모드. from이나 to가 null이면 idle을 돌려준다.
 */
export function useCampusRoute(runtime: CampusRuntime | null, request: CampusRouteRequest | null): CampusRouteState {
  const key = routeRequestKey(request);
  // 키가 바뀐 렌더의 request로 계산한다(그 렌더의 값이 곧 최신 값). request 객체 자체는 의존성이 아니다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computeRoute(runtime, request), [runtime, key]);
}
