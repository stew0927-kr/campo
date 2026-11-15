// 고도 in the editor screen (docs/ELEVATION_INTEGRATION.md 12장):
//  - every change of the state (perform, undo, redo, a drag) marks what the height solver must look at again
//    (markStateChange → markEditPatches); the status bar shows "고도 다시 계산 필요 N곳" until a recompute clears it.
//  - 고도 다시 계산: recomputeRequest + the campus as it would be saved → the dev server runs the solver → the derived
//    file goes back into the data as one history line (applyDerivedElevation = setEdgeElevation) → clearDirty.
//  - 불연속선: lines drawn on the map are kept in the elevation store (not the map data); drawing or removing one
//    dirties the campus points near it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditState, PointRouteResult, Position } from '@campo/core';
import { clearDirty, dirtyCount, emptyDirty, isBreakline, isClean, markStateChange, recomputeRequest, type ElevationDirty, type ElevationStore } from '@campo/core/elevation';
import { fetchElevation, requestRecompute, saveElevationStore } from '../api.ts';
import type { BreaklineShape } from '../map/layers.ts';
import { nodesNearLine, parseStore, planRecomputeResult, slopeLines, storeText, withBreakline, withoutBreakline, type SlopeLine } from '../model/elevation.ts';
import type { PlanResult } from '../model/plan.ts';
import { stateToFiles, type Session } from '../model/session.ts';
import type { RouteKind } from '../ui/ui-state.ts';

interface Env {
  session: Session;
  state: EditState;
  perform: (plan: PlanResult) => string | undefined;
  info: (text: string) => void;
  fail: (text: string) => void;
  /** The routes drawn on the map (their slope parts are drawn over them). */
  routes: readonly { kind: RouteKind; result: PointRouteResult }[];
  shown: readonly RouteKind[];
  nearest: PointRouteResult | null;
}

export function useElevation({ session, state, perform, info, fail, routes, shown, nearest }: Env) {
  const [dirty, setDirty] = useState<ElevationDirty>(emptyDirty);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<ElevationStore | null>(null);
  const [solver, setSolver] = useState<{ ready: boolean; missing: string[] } | null>(null);

  // What changed since the last render's state: the same marks the edit's Immer patches would give.
  const prev = useRef(state);
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (before !== state) setDirty((d) => markStateChange(d, before, state));
  }, [state]);

  useEffect(() => {
    let alive = true;
    fetchElevation(session.campusId).then(
      (e) => {
        if (!alive) return;
        setSolver(e.solver);
        try {
          setStore(parseStore(e.store));
        } catch (err) {
          fail((err as Error).message);
        }
      },
      () => {}, // without the dev server's elevation API the rest of the editor works as before
    );
    return () => {
      alive = false;
    };
  }, [session.campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = dirtyCount(dirty);

  const recompute = async () => {
    if (busy) return;
    if (isClean(dirty)) return info('바뀐 곳이 없어 고도를 다시 계산하지 않아도 됩니다.');
    const req = recomputeRequest(dirty, state);
    setBusy(true);
    info(`고도를 다시 계산하는 중입니다 (구간 ${req.campusEdges.length}개)…`);
    try {
      const answer = await requestRecompute(session.campusId, req, stateToFiles(state, session.meta, session.passthrough));
      const plan = planRecomputeResult(state, req, answer.derived);
      // Only what the request covered is cleared; marks made while the solver ran stay.
      setDirty((d) => clearDirty(d, req));
      if ('error' in plan) {
        info(`${answer.mode === 'existing' ? '이전 계산 결과를 읽었습니다. ' : ''}${plan.error}`);
        return;
      }
      if (perform(plan) === undefined && answer.mode === 'existing') info(`고도 다시 계산: 이전 계산 결과를 반영했습니다. ${answer.log}`);
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- 불연속선 ----

  const writeStore = async (next: ElevationStore, done: string, near: string[]) => {
    try {
      await saveElevationStore(session.campusId, storeText(next));
      setStore(next);
      setDirty((d) => ({ ...d, nodes: new Set([...d.nodes, ...near]) }));
      info(done);
    } catch (err) {
      fail((err as Error).message);
    }
  };
  const addBreakline = (coords: Position[]) => {
    const base = store ?? parseStore(null);
    const id = globalThis.crypto?.randomUUID?.() ?? `bl-${Date.now()}`;
    const next = withBreakline(base, coords, id, Date.now());
    if ('error' in next) return fail(next.error);
    const line = next.breaklines!.at(-1)!;
    void writeStore(next, `고도 단절선을 그렸습니다(꺾은점 ${line.coordinates.length}개). 고도를 다시 계산하면 반영됩니다.`, nodesNearLine(state, line));
  };
  const removeBreakline = (id: string) => {
    const line = store?.breaklines?.find((b) => b.id === id);
    if (!store || !line) return;
    void writeStore(withoutBreakline(store, id), '고도 단절선을 지웠습니다. 고도를 다시 계산하면 반영됩니다.', nodesNearLine(state, line));
  };

  /** Drawn break lines and the campus edges that act as one (outdoor steps, is_breakline), for the map. */
  const breaklineShapes = useMemo<BreaklineShape[]>(() => [
    ...(store?.breaklines ?? []).map((b) => ({ kind: 'drawn' as const, id: b.id, coordinates: b.coordinates.map((c): Position => [c.lng, c.lat]) })),
    ...Object.values(state.edges).filter((e) => isBreakline(e.props)).flatMap((e) => {
      const a = state.nodes[e.props.from]?.coord;
      const b = state.nodes[e.props.to]?.coord;
      return a && b ? [{ kind: 'edge' as const, id: e.id, coordinates: [a, ...e.vertices, b] }] : [];
    }),
  ], [store, state]);

  /** Caution and steep parts of the routes on the map. */
  const slopes = useMemo<SlopeLine[]>(() => {
    const drawn = nearest ? [nearest] : routes.filter((r) => shown.includes(r.kind)).map((r) => r.result);
    return drawn.flatMap((r) => (r.found ? slopeLines(state, r.slopeSegments) : []));
  }, [routes, shown, nearest, state]);

  return {
    count,
    busy,
    recompute: () => void recompute(),
    solver,
    breaklines: store?.breaklines ?? [],
    /** The recompute's height estimates (measured floor planes give the 3D view its floor heights). */
    estimates: store?.estimates ?? [],
    addBreakline,
    removeBreakline,
    breaklineShapes,
    slopes,
  };
}
