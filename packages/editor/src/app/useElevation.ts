// 고도 in the editor screen (docs/ELEVATION_INTEGRATION.md 12장):
//  - every change of the state (perform, undo, redo, a drag) marks what the height solver must look at again
//    (markStateChange → markEditPatches); the status bar shows "고도 다시 계산 필요 N곳" until a recompute clears it.
//  - 고도 다시 계산: recomputeRequest + the campus as it would be saved → the dev server runs the solver → the derived
//    file goes back into the data as one history line (applyDerivedElevation = setEdgeElevation) → clearDirty.
//  - 불연속선: lines drawn on the map are kept in the elevation store (not the map data); drawing or removing one
//    dirties the campus points near it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditState, PointRouteResult, Position } from '@campo/core';
import {
  boxOf, clearDirty, dirtyCount, emptyDirty, isBreakline, isClean, markBreakline, markStateChange, recomputeRequest,
  type BreakLine, type ElevationDirty, type ElevationStore, type LngLatBox,
} from '@campo/core/elevation';
import { fetchElevation, requestRecompute, saveElevationStore } from '../api.ts';
import type { BreaklineShape } from '../map/layers.ts';
import {
  mergePhoneStore, nodesNearLine, parseStore, planRecomputeResult, slopeLines, storeText, withBreakline, withBreaklinePatch, withoutBreakline, type BreaklinePatch, type SlopeLine,
} from '../model/elevation.ts';
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
  /** The solver wrote new files (corrected_dem …): the 지형 3D grid of the screen is read again. */
  onSolved?: () => void;
}

/** The area a drawn line covers (null: no points). */
const lineBox = (line: BreakLine | undefined): LngLatBox | null => (line ? boxOf(line.coordinates) : null);

export function useElevation({ session, state, perform, info, fail, routes, shown, nearest, onSolved }: Env) {
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
      if (answer.mode === 'solved') onSolved?.();
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

  /** The store as last written (edits made in quick succession build on each other, not on a stale render). */
  const current = useRef<ElevationStore | null>(store);
  current.current = store ?? current.current;
  /**
   * Save the store and mark the change for the next recompute: the campus points near the line, and the line itself with the
   * areas it covered (so a recompute is due even where no campus point is near, and the solver knows where to look).
   */
  const writeStore = async (next: ElevationStore, done: string, near: string[], lineId: string, areas: (LngLatBox | null)[]): Promise<boolean> => {
    try {
      await saveElevationStore(session.campusId, storeText(next));
      current.current = next;
      setStore(next);
      setDirty((d) => markBreakline({ ...d, nodes: new Set([...d.nodes, ...near]) }, lineId, areas));
      info(done);
      return true;
    } catch (err) {
      fail((err as Error).message);
      return false;
    }
  };
  /** Draw a line; resolves to its id once saved (null: refused or not saved). */
  const addBreakline = async (coords: Position[]): Promise<string | null> => {
    const base = current.current ?? parseStore(null);
    const id = globalThis.crypto?.randomUUID?.() ?? `bl-${Date.now()}`;
    const next = withBreakline(base, coords, id, Date.now());
    if ('error' in next) {
      fail(next.error);
      return null;
    }
    const line = next.breaklines!.at(-1)!;
    const ok = await writeStore(next, `고도 단절선을 그렸습니다(꺾은점 ${line.coordinates.length}개). 지도에서 낮은 쪽 면을 눌러 정해 주세요.`, nodesNearLine(state, line), id, [lineBox(line)]);
    return ok ? id : null;
  };
  const removeBreakline = (id: string) => {
    const base = current.current;
    const line = base?.breaklines?.find((b) => b.id === id);
    if (!base || !line) return;
    void writeStore(withoutBreakline(base, id), '고도 단절선을 지웠습니다. 고도를 다시 계산하면 반영됩니다.', nodesNearLine(state, line), id, [lineBox(line)]);
  };
  /** Change a drawn line (low side, drop, points); `done` is the notice. The points near the old and the new line are dirtied. */
  const updateBreakline = (id: string, patch: BreaklinePatch, done: string) => {
    const base = current.current;
    const before = base?.breaklines?.find((b) => b.id === id);
    if (!base || !before) return fail('고도 단절선을 찾을 수 없습니다.');
    const next = withBreaklinePatch(base, id, patch);
    if ('error' in next) return fail(next.error);
    const after = next.breaklines!.find((b) => b.id === id)!;
    const near = patch.coordinates ? [...nodesNearLine(state, before), ...nodesNearLine(state, after)] : nodesNearLine(state, after);
    void writeStore(next, `${done} 고도를 다시 계산하면 반영됩니다.`, near, id, [lineBox(before), lineBox(after)]);
  };

  // ---- 현장 기록의 고도 측정 (elevation_store.json in the survey app's zip) ----

  /**
   * Merge a phone's elevation store into the campus's store (mergePhoneStore) and mark the height variables it changed for
   * the next recompute. The store is read from the dev server first (not the copy on screen), so nothing written
   * meanwhile is lost. Resolves to one line for the import's notice; `warn` when the measurements did not go in.
   */
  const importPhoneStore = async (text: string): Promise<{ line: string; warn: boolean }> => {
    const failed = (why: string) => ({ line: `고도 측정(elevation_store.json)을 넣지 못했습니다. ${why}`, warn: true });
    let base: ElevationStore;
    try {
      base = parseStore((await fetchElevation(session.campusId)).store);
    } catch (err) {
      return failed((err as Error).message);
    }
    const merged = mergePhoneStore(base, text);
    if ('error' in merged) return failed(merged.error);
    if (!merged.changed) return { line: '고도 측정은 이미 들어 있습니다.', warn: false };
    try {
      await saveElevationStore(session.campusId, storeText(merged.store));
    } catch (err) {
      return failed((err as Error).message);
    }
    current.current = merged.store;
    setStore(merged.store);
    setDirty((d) => ({ ...d, heightNodes: new Set([...d.heightNodes, ...merged.heightNodes]) }));
    fetchElevation(session.campusId).then((e) => setSolver(e.solver), () => {});
    const gone = merged.removed > 0 ? ` 휴대폰에서 지우거나 다시 잰 ${merged.removed}개는 뺐습니다.` : '';
    return { line: `고도 측정 Δh ${merged.added}개를 고도 저장소에 넣었습니다.${gone} 고도를 다시 계산하면 반영됩니다.`, warn: false };
  };

  /** Drawn break lines and the campus edges that act as one (outdoor steps, is_breakline), for the map. */
  const breaklineShapes = useMemo<BreaklineShape[]>(() => [
    ...(store?.breaklines ?? []).map((b): BreaklineShape => ({
      kind: 'drawn', id: b.id, coordinates: b.coordinates.map((c): Position => [c.lng, c.lat]),
      ...(b.lowSide ? { lowSide: b.lowSide } : {}), ...(b.dropM !== undefined ? { dropM: b.dropM } : {}),
    })),
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
    updateBreakline,
    importPhoneStore,
    breaklineShapes,
    slopes,
  };
}
