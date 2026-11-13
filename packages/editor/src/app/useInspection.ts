// What the panel tabs read from the map data: checks, routes, the nearest restroom and the measurement summary.
// Everything is core's own functions run on exactly what would be saved; nothing here changes the data.
import { useDeferredValue, useMemo } from 'react';
import { buildGraph, findNearest, findRoute, validateCampus, type EditState, type NearestResult, type RouteResult } from '@campo/core';
import type { RouteLine } from '../map/layers.ts';
import { measureSummary, measureTargetOf, type MeasureSummary } from '../model/measure.ts';
import { routeLine, routePlaces } from '../model/places.ts';
import { stateToCampus, type Session } from '../model/session.ts';
import type { UiState } from '../ui/ui-state.ts';

const ROUTE_PROFILES = ['shortest', 'step_free'] as const;

export function useInspection(
  session: Session,
  state: EditState,
  ui: Pick<UiState, 'panelTab' | 'routeFrom' | 'routeTo' | 'nearest' | 'selection'>,
  /** Changes when the session's measurements do (they live outside the edit history). */
  obsRev: number,
) {
  const checkedState = useDeferredValue(state);
  const campus = useMemo(() => stateToCampus(checkedState, session.meta, session.passthrough, session.extras), [session, checkedState]);
  const checks = useMemo(() => validateCampus(campus), [campus]);

  // ---- 경로 테스트: the graph is only built while its tab is open ----
  const routesOpen = ui.panelTab === 'routes';
  const graph = useMemo(() => (routesOpen ? buildGraph(campus) : null), [campus, routesOpen]);
  const places = useMemo(() => routePlaces(state), [state]);
  const { routeFrom, routeTo } = ui;
  const routeResults = useMemo<RouteResult[]>(
    () => (graph && routeFrom && routeTo ? ROUTE_PROFILES.map((p) => findRoute(graph, routeFrom, routeTo, p)) : []),
    [graph, routeFrom, routeTo],
  );
  /** 가장 가까운 화장실: core's findNearest as it is. Wheelchair: the step_free profile, and only restrooms marked wheelchair=yes. */
  const nearest = useMemo<{ kind: 'any' | 'wheelchair'; result: NearestResult } | null>(() => {
    if (!graph || !routeFrom || !ui.nearest) return null;
    const wheelchair = ui.nearest === 'wheelchair';
    const result = findNearest(
      graph,
      routeFrom,
      (n) => n.properties.node_type === 'restroom' && (!wheelchair || n.properties.wheelchair === 'yes'),
      wheelchair ? 'step_free' : 'shortest',
    );
    return { kind: ui.nearest, result };
  }, [graph, routeFrom, ui.nearest]);
  const routeLines = useMemo<RouteLine[]>(() => {
    if (!routesOpen) return [];
    const found = nearest ? [nearest.result] : routeResults;
    return found.flatMap((r) => (r.found && (r.profile === 'shortest' || r.profile === 'step_free')
      ? [{ profile: r.profile, coordinates: routeLine(r, checkedState) }] : []));
  }, [routeResults, nearest, checkedState, routesOpen]);

  // ---- 측정: the selected edge or elevator, with core's predicted time (a graph built without calibration) ----
  const measureTarget = useMemo(() => (ui.selection.length === 1 ? measureTargetOf(state, ui.selection) : null), [state, ui.selection]);
  const measurable = ui.panelTab === 'properties' && measureTarget !== null && 'target' in measureTarget;
  const measureGraph = useMemo(() => (measurable ? buildGraph(campus, { calibration: {} }) : null), [campus, measurable]);
  const measure = useMemo<MeasureSummary | { reason: string } | null>(() => {
    if (!measureTarget) return null;
    if (!('target' in measureTarget)) return measureTarget;
    return measureGraph ? measureSummary(measureTarget, measureGraph, session.extras, session.pendingObservations) : { reason: '길찾기 데이터를 확인하는 중입니다.' };
  // obsRev: the session's measurement lists are mutated in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureTarget, measureGraph, session, obsRev]);

  return { checks, graph, places, routeResults, nearest, routeLines, measureTarget, measure };
}
