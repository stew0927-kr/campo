// What the panel tabs read from the map data: checks, routes, the nearest restroom and the measurement summary.
// Everything is core's own functions run on exactly what would be saved; nothing here changes the data.
import { useDeferredValue, useMemo } from 'react';
import {
  buildGraph, findNearestRestroomFrom, findRouteBetween, validateCampus,
  type EditState, type PointRouteResult, type RouteEnd, type RouteSnap,
} from '@campo/core';
import { HOLE_NOTICE, plazaWalks, pointEnd, routeStops } from '../model/plazaRoute.ts';
import type { RouteLine } from '../map/layers.ts';
import { measureSummary, measureTargetOf, type MeasureSummary } from '../model/measure.ts';
import { routePlaces } from '../model/places.ts';
import { routeFocusOf, type RouteFocus } from '../model/routeFocus.ts';
import { OUTDOOR } from '../model/scope.ts';
import type { RouteRef } from '../model/terrain3d.ts';
import { stateToCampus, type Session } from '../model/session.ts';
import type { RouteKind, RoutePoint, UiState } from '../ui/ui-state.ts';

/** The three routes 경로 테스트 works out every time, in the order they are listed. */
export const ROUTE_KINDS: readonly RouteKind[] = ['step_free', 'shortest', 'elevator_first'];

/** The fastest of the found routes (the one shown when nothing is toggled). */
export function fastestOf(results: readonly { kind: RouteKind; result: PointRouteResult }[]): RouteKind | null {
  let best: { kind: RouteKind; t: number } | null = null;
  for (const { kind, result } of results) if (result.found && (!best || result.timeSec < best.t)) best = { kind, t: result.timeSec };
  return best?.kind ?? null;
}

const OUTDOOR_REF: RouteRef = { scope: OUTDOOR };

export function useInspection(
  session: Session,
  state: EditState,
  ui: Pick<UiState, 'panelTab' | 'routeFrom' | 'routeTo' | 'routeFromPoint' | 'routeToPoint' | 'routeShown' | 'nearest' | 'selection' | 'scope'>,
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
    const end = (id: string | null, p: RoutePoint | null): { end: RouteEnd; snap: RouteSnap | null; inHole: boolean } | null => {
      if (p) return pointEnd(graph, checkedState, p);
      return id && graph.nodes.has(id) ? { end: { nodeId: id }, snap: null, inHole: false } : null;
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
    // A picked end and its foot stand on the floor (or the outdoors) they were picked in; the rest on their nodes.
    const fromRef: RouteRef = { scope: routeFromPoint?.scope ?? OUTDOOR };
    const toRef: RouteRef = { scope: routeToPoint?.scope ?? OUTDOOR };
    const draw = (profile: RouteLine['profile'], r: PointRouteResult) => {
      if (!r.found) return;
      // A plaza end walks straight across the plaza (around its holes) to where the route meets it, and a crossing in the
      // middle (길 A → 평지 → 길 B) walks across it between two nodes: drawn as part of the route, and dashed on top like the
      // foot of a perpendicular.
      lines.push({ profile, ...routeStops(r, (id) => checkedState.nodes[id]?.coord, fromRef, toRef) });
      for (const leg of plazaWalks(r)) {
        const ref = leg === r.startPlaza ? fromRef : leg === r.endPlaza ? toRef : OUTDOOR_REF;
        lines.push({ profile: 'snap', coordinates: leg.path, refs: leg.path.map(() => ref) });
      }
    };
    if (nearest) draw(nearest.kind === 'wheelchair' ? 'wheelchair' : 'shortest', nearest.result);
    else for (const { kind, result } of routeResults) if (shown.includes(kind)) draw(kind, result);
    // A 직접 선택 end is joined to the route by its perpendicular, dashed: 출발 pin → foot, foot → 도착 pin.
    if (ends.from?.snap) lines.push({ profile: 'snap', coordinates: [ends.from.snap.point, ends.from.snap.foot], refs: [fromRef, fromRef] });
    if (ends.to?.snap) lines.push({ profile: 'snap', coordinates: [ends.to.snap.foot, ends.to.snap.point], refs: [toRef, toRef] });
    // The 출발 / 도착 pins, whatever the end is: a picked point, a place, or the restroom found.
    const at = (id: string | null) => (id ? checkedState.nodes[id]?.coord : undefined);
    const start = routeFromPoint?.at ?? at(routeFrom);
    const endId = nearest ? (nearest.result.found && 'targetId' in nearest.result ? nearest.result.targetId as string : null) : routeTo;
    const end = nearest ? at(endId) : routeToPoint?.at ?? at(routeTo);
    const pinRef = (p: RoutePoint | null, id: string | null): RouteRef => (p ? { scope: p.scope } : id ? { node: id } : { scope: OUTDOOR });
    if (start) lines.push({ profile: 'start', coordinates: [start], refs: [pinRef(routeFromPoint, routeFrom)] });
    if (end) lines.push({ profile: 'end', coordinates: [end], refs: [pinRef(nearest ? null : routeToPoint, endId)] });
    return lines;
  }, [routeResults, nearest, shown, ends, checkedState, routesOpen, routeFrom, routeTo, routeFromPoint, routeToPoint]);

  /** Which parts of other buildings stay sharp for the routes shown (null: nothing special). */
  const routeFocus = useMemo<RouteFocus | null>(() => {
    const endBuilding = (id: string | null, p: RoutePoint | null) => (p ? (p.scope.kind === 'building' ? p.scope.buildingId : null) : id ? checkedState.nodes[id]?.props.building_id : null);
    return routeFocusOf(
      checkedState, ui.scope, routesOpen,
      routeResults.filter((r) => shown.includes(r.kind)).map((r) => r.result),
      [endBuilding(routeFrom, routeFromPoint), endBuilding(routeTo, routeToPoint)],
    );
  }, [checkedState, ui.scope, routesOpen, routeResults, shown, routeFrom, routeTo, routeFromPoint, routeToPoint]);

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

  /** A 직접 선택 point in a plaza's hole is snapped to the nearest edge as if it were outside the plaza: say so. */
  const routeNotices = useMemo(() => (routesOpen && (ends.from?.inHole || ends.to?.inHole) ? [HOLE_NOTICE] : []), [routesOpen, ends]);
  return { checks, graph, places, routeResults, routeShown: shown, nearest, routeLines, routeFocus, routeNotices, measureTarget, measure };
}
