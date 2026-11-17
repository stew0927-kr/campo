// useGpsMatcher: 센서 표본(1초 1개)을 넣으면 지도 위 현재 위치·모드·층과 안내 문구를 돌려준다.
// 매칭 상태는 세션 하나(useRef)에만 두고, 화면 상태로는 스냅숏만 옮긴다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MatchNetwork, SensorFix } from '@campo/core';
import { EMPTY_GPS_SNAPSHOT, type GpsMatcherApi, type GpsMatcherOptions, type GpsMatcherSnapshot } from '../contracts.ts';
import { createGpsMatcherSession, routeKeyOf, type GpsMatcherSession } from '../matching/matcherSession.ts';

/**
 * @param network useCampusData().network (캠퍼스 데이터를 읽기 전에는 null)
 * @param options routeNodeIds를 주면 그 경로에서 벗어났는지도 판정한다
 */
export function useGpsMatcher(network: MatchNetwork | null, options: GpsMatcherOptions = {}): GpsMatcherApi {
  const sessionRef = useRef<GpsMatcherSession | null>(null);
  const [snapshot, setSnapshot] = useState<GpsMatcherSnapshot>(EMPTY_GPS_SNAPSHOT);
  const routeNodeIds = options.routeNodeIds ?? null;
  // 배열은 매 렌더 새 객체일 수 있으므로 내용으로 같은지 본다.
  const routeKey = routeKeyOf(routeNodeIds);

  // 세션(추적 상태)은 캠퍼스 망이 바뀔 때만 새로 만든다. 경로가 바뀌어도 위치·모드·층 추적은 이어져야 한다.
  useEffect(() => {
    if (network === null) {
      sessionRef.current = null;
      setSnapshot(EMPTY_GPS_SNAPSHOT);
      return;
    }
    const session = createGpsMatcherSession(network, routeNodeIds !== null && routeNodeIds.length > 0 ? { routeNodeIds } : {});
    sessionRef.current = session;
    setSnapshot(session.snapshot());
    // 경로(routeKey)는 의존성이 아니다: 아래 effect가 세션을 그대로 두고 경로만 바꾼다.
  }, [network]);

  useEffect(() => {
    sessionRef.current?.setRoute(routeNodeIds);
    // routeKey는 routeNodeIds의 내용을 대표한다.
  }, [routeKey]);

  const pushFix = useCallback((fix: SensorFix): GpsMatcherSnapshot => {
    const session = sessionRef.current;
    if (session === null) return EMPTY_GPS_SNAPSHOT;
    const next = session.pushFix(fix);
    setSnapshot(next);
    return next;
  }, []);

  const setRoute = useCallback((nodeIds: readonly string[] | null) => {
    sessionRef.current?.setRoute(nodeIds);
  }, []);

  const reset = useCallback(() => {
    const session = sessionRef.current;
    if (session === null) return;
    session.reset();
    setSnapshot(session.snapshot());
  }, []);

  return useMemo(() => ({ ...snapshot, pushFix, setRoute, reset }), [snapshot, pushFix, setRoute, reset]);
}
