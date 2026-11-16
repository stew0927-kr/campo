// GPS 매칭 + 실내외 전환 세션. React 없이 도는 순수 엔진이라 Node에서 그대로 테스트한다
// (test/gpsMatcher.test.ts). useGpsMatcher가 이 세션 하나를 useRef에 들고 화면 상태로 옮긴다.
import {
  DEFAULT_MATCH_PARAMS,
  DEFAULT_NAV_PARAMS,
  buildNavRoute,
  createMatcherState,
  initialNavState,
  matchStep,
  navEventMessage,
  navStep,
  resetMatcher,
  scopeForNav,
  setMatchScope,
  type MatchNetwork,
  type MatchParams,
  type MatcherState,
  type NavParams,
  type NavRoute,
  type NavState,
  type SensorFix,
} from '@campo/core';
import { EMPTY_GPS_SNAPSHOT, type GpsMatcherSnapshot } from '../contracts.ts';

export interface GpsMatcherSessionOptions {
  /** 따라갈 경로의 캠퍼스 지점 id(없으면 경로 이탈을 판정하지 않는다). */
  routeNodeIds?: readonly string[] | null;
  matchParams?: Readonly<MatchParams>;
  navParams?: Readonly<NavParams>;
}

/** 경로의 내용을 대표하는 키. 배열이 매 렌더 새 객체여도 내용이 같으면 같은 키다(null·빈 배열은 둘 다 ''). */
export function routeKeyOf(nodeIds: readonly string[] | null | undefined): string {
  return nodeIds === null || nodeIds === undefined ? '' : nodeIds.join('>');
}

export interface GpsMatcherSession {
  pushFix: (fix: SensorFix) => GpsMatcherSnapshot;
  setRoute: (nodeIds: readonly string[] | null) => void;
  reset: () => void;
  snapshot: () => GpsMatcherSnapshot;
}

/**
 * 한 추적 세션. 망(network) 하나에 묶이므로 캠퍼스가 바뀌면 새로 만든다.
 * fix 하나당 한 번 pushFix를 부르고, 돌려주는 스냅숏을 화면에 그대로 쓰면 된다.
 */
export function createGpsMatcherSession(net: MatchNetwork, options: GpsMatcherSessionOptions = {}): GpsMatcherSession {
  const matchParams = options.matchParams ?? DEFAULT_MATCH_PARAMS;
  const navParams = options.navParams ?? DEFAULT_NAV_PARAMS;
  const matcher: MatcherState = createMatcherState(matchParams);

  const navRouteOf = (nodeIds: readonly string[] | null): NavRoute | null =>
    nodeIds !== null && nodeIds.length > 0 ? buildNavRoute(net, nodeIds) : null;

  let nav: NavState = initialNavState(0);
  let route: NavRoute | null = navRouteOf(options.routeNodeIds ?? null);
  let snapshot: GpsMatcherSnapshot = EMPTY_GPS_SNAPSHOT;

  const pushFix = (fix: SensorFix): GpsMatcherSnapshot => {
    // 실내에서는 그 층의 구간만 후보로 본다(층 번호는 후보 필터에만 쓰인다).
    setMatchScope(matcher, scopeForNav(nav));
    const result = matchStep(net, matcher, fix, matchParams);
    const step = navStep(nav, result, fix, { net, route }, navParams);
    nav = step.nav;

    const messages: string[] = [];
    for (const event of step.events) {
      const text = navEventMessage(event);
      if (text !== null) messages.push(text);
    }

    snapshot = {
      mode: nav.mode,
      buildingId: nav.buildingId,
      level: nav.level,
      position: {
        lat: result.lat,
        lng: result.lng,
        confidence: result.confidence,
        stationary: result.stationary,
        free: result.free,
        skipped: result.skipped,
      },
      events: step.events,
      messages,
      rerouteRequested: step.events.some((event) => event.type === 'REROUTE'),
      fixCount: matcher.steps,
    };
    return snapshot;
  };

  const setRoute = (nodeIds: readonly string[] | null): void => {
    route = navRouteOf(nodeIds);
  };

  const reset = (): void => {
    resetMatcher(matcher);
    const restartMs = Number.isFinite(matcher.lastTMs) ? matcher.lastTMs : 0;
    nav = initialNavState(restartMs);
    snapshot = EMPTY_GPS_SNAPSHOT;
  };

  return { pushFix, setRoute, reset, snapshot: () => snapshot };
}
