// What the panel tabs read from the map data: checks, routes, the nearest restroom and the measurement summary.
// Everything is core's own functions run on exactly what would be saved; nothing here changes the data.
import { useDeferredValue, useMemo } from 'react';
import {
  buildGraph, findNearestRestroomFrom, findRouteBetween, snapToRoutes, validateCampus,
  type CampusGraph, type EditEdge, type EditState, type PointRouteResult, type RouteEnd, type RouteSnap,
} from '@campo/core';
import type { RouteLine } from '../map/layers.ts';
import { measureSummary, measureTargetOf, type MeasureSummary } from '../model/measure.ts';
import { routePlaces } from '../model/places.ts';
import { edgeInScope } from '../model/scope.ts';
import { stateToCampus, type Session } from '../model/session.ts';
import type { RouteKind, RoutePoint, UiState } from '../ui/ui-state.ts';

/** The three routes 경로 테스트 works out every time, in the order they are listed. */
export const ROUTE_KINDS: readonly RouteKind[] = ['step_free', 'shortest', 'elevator_first'];

/** The snap of a 직접 선택 point: the nearest edge on the floor (or outdoors) it was picked on. */
function snapOf(g: CampusGraph, state: EditState, p: RoutePoint): RouteSnap | null {
  return snapToRoutes(g, p.at, (e) => edgeInScope(state, { props: e.properties } as unknown as EditEdge, p.scope));
}

/** The fastest of the found routes (the one shown when nothing is toggled). */
export function fastestOf(results: readonly { kind: RouteKind; result: PointRouteResult }[]): RouteKind | null {
  let best: { kind: RouteKind; t: number } | null = null;
  for (const { kind, result } of results) if (result.found && (!best || result.timeSec < best.t)) best = { kind, t: result.timeSec };
  return best?.kind ?? null;
}

export function useInspection(
  session: Session,
  state: EditState,
  ui: Pick<UiState, 'panelTab' | 'routeFrom' | 'routeTo' | 'routeFromPoint' | 'routeToPoint' | 'routeShown' | 'nearest' | 'selection'>,
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
  const { routeFrom, routeTo, routeFromPoint, routeToPoint, routeShown } = ui;
  /** The two ends: a place, or a 직접 선택 point snapped to the nearest edge (with the snap, for the dashed foot line). */
  const ends = useMemo(() => {
    if (!graph) return { from: null, to: null };
    const end = (id: string | null, p: RoutePoint | null): { end: RouteEnd; snap: RouteSnap | null } | null => {
      if (p) {
        const snap = snapOf(graph, checkedState, p);
        return snap ? { end: { snap }, snap } : null;
      }
      return id && graph.nodes.has(id) ? { end: { nodeId: id }, snap: null } : null;
    };
    return { from: end(routeFrom, routeFromPoint), to: end(routeTo, routeToPoint) };
  }, [graph, checkedState, routeFrom, routeTo, routeFromPoint, routeToPoint]);
  const routeResults = useMemo<{ kind: RouteKind; result: PointRouteResult }[]>(
    () => (graph && ends.from && ends.to && !ui.nearest
      ? ROUTE_KINDS.map((kind) => ({ kind, result: findRouteBetween(graph, ends.from!.end, ends.to!.end, kind) }))
      : []),
    [graph, ends, ui.nearest],
  );
  /** 가장 가까운 화장실 (core findNearestRestroomFrom): any restroom by the shortest route; wheelchair restrooms by the wheelchair profile. */
  const nearest = useMemo<{ kind: 'any' | 'wheelchair'; result: PointRouteResult } | null>(() => {
    if (!graph || !ends.from || !ui.nearest) return null;
    return { kind: ui.nearest, result: findNearestRestroomFrom(graph, ends.from.end, ui.nearest) };
  }, [graph, ends, ui.nearest]);
  const shown = useMemo<RouteKind[]>(() => {
    if (routeShown) return routeShown;
    const fastest = fastestOf(routeResults);
    return fastest ? [fastest] : [];
  }, [routeShown, routeResults]);
  const routeLines = useMemo<RouteLine[]>(() => {
    if (!routesOpen) return [];
    const lines: RouteLine[] = [];
    const draw = (profile: RouteLine['profile'], r: PointRouteResult) => {
      if (!r.found) return;
      const coords = r.nodes.map((id) => checkedState.nodes[id]?.coord).filter((c): c is NonNullable<typeof c> => !!c);
      lines.push({ profile, coordinates: [...(r.startFoot ? [r.startFoot] : []), ...coords, ...(r.endFoot ? [r.endFoot] : [])] });
    };
    if (nearest) draw(nearest.kind === 'wheelchair' ? 'wheelchair' : 'shortest', nearest.result);
    else for (const { kind, result } of routeResults) if (shown.includes(kind)) draw(kind, result);
    // A 직접 선택 end is joined to the route by its perpendicular, dashed: 출발 pin → foot, foot → 도착 pin.
    if (ends.from?.snap) lines.push({ profile: 'snap', coordinates: [ends.from.snap.point, ends.from.snap.foot] });
    if (ends.to?.snap) lines.push({ profile: 'snap', coordinates: [ends.to.snap.foot, ends.to.snap.point] });
    // The 출발 / 도착 pins, whatever the end is: a picked point, a place, or the restroom found.
    const at = (id: string | null) => (id ? checkedState.nodes[id]?.coord : undefined);
    const start = routeFromPoint?.at ?? at(routeFrom);
    const end = nearest
      ? (nearest.result.found && 'targetId' in nearest.result ? at(nearest.result.targetId as string) : undefined)
      : routeToPoint?.at ?? at(routeTo);
    if (start) lines.push({ profile: 'start', coordinates: [start] });
    if (end) lines.push({ profile: 'end', coordinates: [end] });
    return lines;
  }, [routeResults, nearest, shown, ends, checkedState, routesOpen, routeFrom, routeTo, routeFromPoint, routeToPoint]);

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

  return { checks, graph, places, routeResults, routeShown: shown, nearest, routeLines, measureTarget, measure };
}
