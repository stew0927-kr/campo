import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph, findFeature, findRoute, validateCampus, type EditNode, type EditState, type Position, type RouteResult } from '@campo/core';
import { fetchCampusFiles, saveCampus } from './api.ts';
import type { RouteLine } from './map/layers.ts';
import { MapView, type FocusRequest, type MapClick } from './map/MapView.tsx';
import { buildingAt, planAddBuilding } from './model/building.ts';
import { NodeDrag, type DragResult } from './model/drag.ts';
import { featureCenter, featureScope } from './model/locate.ts';
import {
  buildingsToDelete, nextSelection, planDelete, planFlip, planMerge, planSetProps, propsPatch, type CommonEdits,
} from './model/ops.ts';
import { isError, planReason, runPlan, type Plan, type PlanResult } from './model/plan.ts';
import { routeLine, routePlaces } from './model/places.ts';
import { OUTDOOR, edgeInScope, nodeInScope, scopeLabel, type Scope } from './model/scope.ts';
import { commitOverrides, createSession, pendingOverrides, propsOf, stateToCampus, stateToFiles, type Session } from './model/session.ts';
import {
  planBridge, planConnect, planElevator, planIndoorNode, planOutdoorNode, planOutdoorPath, planPortal, planStairs, type PathVertex,
} from './model/tools.ts';
import { ChecksPanel } from './ui/ChecksPanel.tsx';
import { BuildingDialog, ClassroomDialog, DeleteBuildingDialog, ElevatorDialog, PoiDialog, StairsDialog, type DeleteBuildingItem } from './ui/Dialogs.tsx';
import { FloorPicker } from './ui/FloorPicker.tsx';
import { PropertiesPanel } from './ui/PropertiesPanel.tsx';
import { RoutePanel } from './ui/RoutePanel.tsx';
import { SidePanel } from './ui/SidePanel.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { Toolbar, type Operation } from './ui/Toolbar.tsx';
import { TOOL_HINTS, effectiveAddKind, initialUi, toolAvailable, type Tool, type UiState } from './ui/ui-state.ts';

const CAMPUS_ID = import.meta.env.VITE_CAMPUS_ID?.trim() || 'hanyang-seoul';

type Notice = { text: string; tone: 'info' | 'warn' | 'error' } | null;
/** Open form, with where it was asked for. Screen state. */
type Dialog =
  | { kind: 'classroom' | 'elevator' | 'stairs' | 'poi'; position: Position }
  | { kind: 'building'; ring: Position[] }
  | { kind: 'delete-building'; plan: Plan; items: DeleteBuildingItem[] }
  | null;

export function App() {
  /** The edit engine: history, id generator, what the engine left out on load. Mutable; `state` mirrors its current state. */
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<EditState | null>(null);
  /** The state as last loaded or saved, to tell whether there are unsaved changes. */
  const [savedState, setSavedState] = useState<EditState | null>(null);
  /** Screen state. */
  const [ui, setUi] = useState<UiState>(initialUi);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Key of the last property edit, so a slider drag becomes one history entry. */
  const lastProp = useRef<string | null>(null);

  useEffect(() => {
    fetchCampusFiles(CAMPUS_ID).then(
      (files) => {
        const s = createSession(CAMPUS_ID, files);
        setSession(s);
        setState(s.history.current());
        setSavedState(s.history.current());
        if (s.passthrough.length > 0) {
          setNotice({ text: `스키마에 맞지 않거나 이어진 지점이 없는 Feature ${s.passthrough.length}개는 고치지 않고 그대로 저장합니다.`, tone: 'error' });
        }
      },
      (err: Error) => setLoadError(err.message),
    );
  }, []);

  const dirty = useMemo(
    () => state !== null && savedState !== null && state !== savedState && JSON.stringify(state) !== JSON.stringify(savedState),
    [state, savedState],
  );
  const info = (text: string) => setNotice({ text, tone: 'info' });
  const fail = (text: string) => setNotice({ text, tone: 'error' });
  const patchUi = (patch: Partial<UiState>) => setUi((u) => ({ ...u, ...patch }));
  const sync = () => session && setState(session.history.current());

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // A selected Feature can disappear (delete, merge, undo): drop it from the selection.
  useEffect(() => {
    if (!state) return;
    setUi((u) => (u.selection.every((id) => findFeature(state, id)) ? u : { ...u, selection: u.selection.filter((id) => findFeature(state, id)) }));
  }, [state]);

  // ---- Checks and routes: core's own functions, on exactly what would be saved ----
  const checkedState = useDeferredValue(state);
  const campus = useMemo(
    () => (session && checkedState ? stateToCampus(checkedState, session.meta, session.passthrough, session.extras) : null),
    [session, checkedState],
  );
  const checks = useMemo(() => (campus ? validateCampus(campus) : { errors: [], warnings: [] }), [campus]);
  const graph = useMemo(() => (campus && ui.panelTab === 'routes' ? buildGraph(campus) : null), [campus, ui.panelTab]);
  const places = useMemo(() => (state ? routePlaces(state) : []), [state]);
  const routeResults = useMemo<RouteResult[]>(() => {
    if (!graph || !ui.routeFrom || !ui.routeTo) return [];
    return (['shortest', 'step_free'] as const).map((p) => findRoute(graph, ui.routeFrom!, ui.routeTo!, p));
  }, [graph, ui.routeFrom, ui.routeTo]);
  const routeLines = useMemo<RouteLine[]>(() => {
    if (!checkedState || ui.panelTab !== 'routes') return [];
    return routeResults.flatMap((r) => (r.found && (r.profile === 'shortest' || r.profile === 'step_free')
      ? [{ profile: r.profile, coordinates: routeLine(r, checkedState) }] : []));
  }, [routeResults, checkedState, ui.panelTab]);

  // ---- Edits: every one is a Plan of core actions run as one history entry ----
  /** Run a plan. Returns the error (for a dialog to show) or undefined. `coalesce` folds repeated edits of one thing into one entry. */
  const perform = (result: PlanResult, coalesce?: string): string | undefined => {
    if (!session) return undefined;
    if (isError(result)) {
      fail(result.error);
      return result.error;
    }
    if (coalesce !== undefined && lastProp.current === coalesce && session.history.canUndo()) session.history.undo();
    const r = runPlan(session.history, result);
    lastProp.current = r.ok ? coalesce ?? null : null;
    sync();
    if (!r.ok) {
      fail(r.reason);
      return r.reason;
    }
    setDialog(null);
    setNotice({
      text: [`${result.annotation}: 완료했습니다.`, ...r.warnings].join(' '),
      tone: r.warnings.length > 0 ? 'warn' : 'info',
    });
    return undefined;
  };

  const setTool = (tool: Tool) => {
    patchUi({ tool, pickFrom: null });
    setNotice(null);
  };

  const showFloor = (scope: Scope, keepPick = false) => setUi((u) => ({
    ...u,
    scope,
    selectedBuildingId: scope.kind === 'building' ? scope.buildingId : null,
    // Picking a floor is usually followed by adding points; tools that span floors keep their first pick.
    tool: u.tool === 'select-building' || !toolAvailable(u.tool, scope) ? (scope.kind === 'building' ? 'add-node' : 'select') : u.tool,
    pickFrom: keepPick ? u.pickFrom : null,
  }));

  const onPathDrawn = useCallback((vertices: PathVertex[]) => {
    if (!session || !state) return;
    const plan = planOutdoorPath(state, session.ctx, vertices, ui.outdoorKind);
    if (plan) perform(plan);
    else setNotice(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, state, ui.outdoorKind]);

  /** Two-click tools: remember the first node, then build the edge on the second. */
  const pickPair = (node: EditNode | undefined, make: (a: string, b: string) => PlanResult, next: string) => {
    if (!node) return info(ui.pickFrom ? next : '지점 가까이를 눌러 주세요.');
    if (!ui.pickFrom) {
      patchUi({ pickFrom: node.id });
      return info(`${node.id}을(를) 골랐습니다. ${next}`);
    }
    const r = make(ui.pickFrom, node.id);
    patchUi({ pickFrom: null });
    perform(r);
  };

  const onMapClick = ({ position, node, edge, building, shift }: MapClick) => {
    if (!session || !state) return;
    const ctx = session.ctx;
    const scope = ui.scope;
    switch (ui.tool) {
      case 'select': {
        const hit = node?.id ?? edge?.id ?? building?.id ?? null;
        setUi((u) => ({ ...u, selection: nextSelection(u.selection, hit, shift), ...(hit ? { panelTab: 'properties' as const } : {}) }));
        setNotice(null);
        return;
      }
      case 'select-building': {
        const b = buildingAt(state, position);
        patchUi({ selectedBuildingId: b?.id ?? null });
        return b ? setNotice(null) : info('여기에는 건물이 없습니다. 건물 외곽선 안쪽을 눌러 주세요.');
      }
      case 'add-node': {
        const kind = effectiveAddKind(ui);
        if (kind === 'classroom' || kind === 'elevator' || kind === 'stairs' || kind === 'poi') return setDialog({ kind, position });
        if (kind === 'outdoor') return perform(planOutdoorNode(state, ctx, position));
        if (scope.kind !== 'building') return;
        return perform(planIndoorNode(state, ctx, { buildingId: scope.buildingId, level: scope.level, kind, position }));
      }
      case 'connect':
        return pickPair(node, (a, b) => planConnect(state, ctx, a, b), '이을 다른 지점을 눌러 주세요.');
      case 'portal':
        return pickPair(node, (a, b) => planPortal(state, ctx, a, b), '이어질 바깥 지점을 눌러 주세요(흐리게 보이는 바깥 지점).');
      case 'bridge':
        if (!node && ui.pickFrom) {
          // Clicking another building opens its floor picker without losing the first pick.
          const b = buildingAt(state, position);
          if (b) {
            patchUi({ selectedBuildingId: b.id });
            return info(`${b.props.name}의 층을 고른 다음 이어질 지점을 눌러 주세요.`);
          }
        }
        return pickPair(node, (a, b) => planBridge(state, ctx, a, b), '다른 건물을 눌러 층을 고른 다음, 이어질 지점을 눌러 주세요.');
      default:
    }
  };

  const onBoxSelect = (ids: string[]) => {
    patchUi({ selection: ids, ...(ids.length > 0 ? { panelTab: 'properties' as const } : {}) });
    info(ids.length > 0 ? `지점 ${ids.length}개를 골랐습니다.` : '상자 안에 고를 수 있는 지점이 없습니다.');
  };

  const beginDrag = (nodeId: string) => new NodeDrag(session!.history, session!.ctx, nodeId);
  const onDragEnd = (result: DragResult | null) => {
    lastProp.current = null;
    sync();
    if (result === null) return info('끌기를 취소했습니다. 지점을 원래 자리로 되돌렸습니다.');
    if (!result.ok) return fail(`${result.reason} 지점을 원래 자리로 되돌렸습니다.`);
    const text = { move: '지점을 옮겼습니다.', merge: '지점을 합쳤습니다.', split: '구간 위에 지점을 이었습니다.' }[result.kind];
    setNotice({ text: [text, ...result.warnings].join(' '), tone: result.warnings.length > 0 ? 'warn' : 'info' });
  };

  const onLocate = (featureId: string) => {
    if (!state) return;
    const scope = featureScope(state, featureId);
    const center = featureCenter(state, featureId);
    setUi((u) => ({
      ...u,
      scope,
      selectedBuildingId: scope.kind === 'building' ? scope.buildingId : state.buildings && Object.values(state.buildings).some((b) => b.id === featureId) ? featureId : null,
      selection: [featureId],
      tool: toolAvailable(u.tool, scope) ? u.tool : 'select',
      pickFrom: null,
    }));
    if (center) setFocus((prev) => ({ position: center, seq: (prev?.seq ?? 0) + 1 }));
  };

  // ---- Operations on the selection (SPEC-v0.2 5.3) ----
  const deletePlan = useMemo(() => (session && state ? planDelete(state, session.ctx, ui.selection, false) : null), [session, state, ui.selection]);
  const mergePlan = useMemo(() => (session && state ? planMerge(state, session.ctx, ui.selection) : null), [session, state, ui.selection]);
  const reasonOf = (plan: PlanResult | null): string | false => {
    if (!plan || !state) return '데이터를 불러오는 중입니다.';
    return isError(plan) ? plan.error : planReason(state, plan);
  };
  const deleteBlocked = useMemo(() => reasonOf(deletePlan), [deletePlan, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const healBlocked = useMemo(() => {
    if (!state) return '데이터를 불러오는 중입니다.';
    return ui.selection.some((id) => id in state.nodes) ? deleteBlocked : '이어 붙이며 지우려면 지점을 골라 주세요.';
  }, [state, ui.selection, deleteBlocked]);
  const mergeBlocked = useMemo(() => reasonOf(mergePlan), [mergePlan, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const flipPlan = useMemo(() => (state ? planFlip(state, ui.selection) : null), [state, ui.selection]);
  const flipBlocked = useMemo(() => reasonOf(flipPlan), [flipPlan, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const doDelete = (heal: boolean) => {
    if (!session || !state) return;
    const plan = planDelete(state, session.ctx, ui.selection, heal);
    if (isError(plan)) return fail(plan.error);
    const reason = planReason(state, plan);
    if (reason !== false) return fail(reason);
    const doomed = buildingsToDelete(state, ui.selection);
    if (doomed.length > 0) {
      // A building takes everything in it along: show the counts first.
      setDialog({ kind: 'delete-building', plan, items: doomed.map((b) => ({ code: b.code, name: b.name, ...b.preview })) });
      return;
    }
    perform(plan);
  };
  const doMerge = () => {
    if (!session || !state) return;
    if (mergePlan) perform(mergePlan);
  };
  const doFlip = () => {
    if (flipPlan) perform(flipPlan);
  };
  const doUndo = () => {
    if (!session) return;
    if (!session.history.canUndo()) return info('되돌릴 변경이 없습니다.');
    session.history.undo();
    lastProp.current = null;
    sync();
    info('되돌렸습니다.');
  };
  const doRedo = () => {
    if (!session) return;
    if (!session.history.canRedo()) return info('다시 할 변경이 없습니다.');
    session.history.redo();
    lastProp.current = null;
    sync();
    info('다시 했습니다.');
  };
  const blockedOr = (reason: string | false, run: () => void) => () => (reason === false ? run() : fail(reason));

  const operations: Operation[] = [
    { id: 'delete', label: '삭제', shortcut: 'Delete', blocked: deleteBlocked, onClick: blockedOr(deleteBlocked, () => doDelete(false)) },
    { id: 'delete-heal', label: '이어 붙이며 삭제', shortcut: 'Shift+Delete', blocked: healBlocked, onClick: blockedOr(healBlocked, () => doDelete(true)) },
    { id: 'merge', label: '합치기', shortcut: 'M', blocked: mergeBlocked, onClick: blockedOr(mergeBlocked, doMerge) },
    { id: 'flip', label: '뒤집기', shortcut: 'F', blocked: flipBlocked, onClick: blockedOr(flipBlocked, doFlip) },
    { id: 'undo', label: '되돌리기', shortcut: 'Ctrl+Z', blocked: session?.history.canUndo() ? false : '되돌릴 변경이 없습니다.', onClick: doUndo },
    { id: 'redo', label: '다시 하기', shortcut: 'Ctrl+Shift+Z', blocked: session?.history.canRedo() ? false : '다시 할 변경이 없습니다.', onClick: doRedo },
  ];

  const onSave = useCallback(async () => {
    if (!session || !state || saving) return;
    const files = stateToFiles(state, session.meta, session.passthrough);
    // A split or heal of a closed edge carries its overrides.json entries along.
    const pending = pendingOverrides(session);
    if (pending) files['overrides.json'] = pending.text;
    const extras = pending ? [...session.extras.filter((f) => f.path !== 'overrides.json'), { path: 'overrides.json', text: pending.text }] : session.extras;
    // SPEC §8: check before saving, on exactly the files that will be written.
    const { errors } = validateCampus(stateToCampus(state, session.meta, session.passthrough, extras));
    if (errors.length > 0 && !window.confirm(`검사 오류가 ${errors.length}개 있습니다. 그래도 저장하시겠습니까?`)) return;

    setSaving(true);
    try {
      const { written, removed } = await saveCampus(session.campusId, files);
      session.history.markSaved();
      if (pending) commitOverrides(session, pending);
      setSavedState(state);
      const removedText = removed.length > 0 ? `, 지운 파일 ${removed.length}개` : '';
      info(`저장했습니다. 쓴 파일 ${written.length}개${removedText}. 커밋은 Git에서 해 주세요.`);
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [session, state, saving]);

  // Keys (SPEC-v0.2 5.3). The handler is registered once and reads the latest functions through a ref.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') {
      e.preventDefault();
      void onSave();
    } else if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if (!mod && !e.altKey && ui.tool === 'select' && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (e.shiftKey) blockedOr(healBlocked, () => doDelete(true))();
      else blockedOr(deleteBlocked, () => doDelete(false))();
    } else if (!mod && !e.altKey && !e.shiftKey && ui.tool === 'select' && k === 'm') {
      e.preventDefault();
      blockedOr(mergeBlocked, doMerge)();
    } else if (!mod && !e.altKey && !e.shiftKey && ui.tool === 'select' && k === 'f') {
      e.preventDefault();
      blockedOr(flipBlocked, doFlip)();
    } else if (e.key === 'Escape') {
      if (ui.pickFrom) {
        patchUi({ pickFrom: null });
        setNotice(null);
      } else if (ui.selection.length > 0) {
        patchUi({ selection: [] });
      } else if (ui.tool !== 'select') {
        setTool('select');
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const highlight = useMemo(() => new Set([ui.pickFrom, ...ui.selection].filter((id): id is string => !!id)), [ui.pickFrom, ui.selection]);

  /** Second click of 포탈 picks an outdoor point; everything else picks on the floor being shown. */
  const canPick = useCallback((n: EditNode) => (
    ui.tool === 'portal' && ui.pickFrom ? n.props.building_id === null : nodeInScope(n, ui.scope)
  ), [ui.tool, ui.pickFrom, ui.scope]);

  const counts = useMemo(() => {
    let nodes = 0;
    let edges = 0;
    if (state) {
      for (const n of Object.values(state.nodes)) if (nodeInScope(n, ui.scope)) nodes++;
      for (const e of Object.values(state.edges)) if (edgeInScope(state, e, ui.scope)) edges++;
    }
    return { nodes, edges };
  }, [state, ui.scope]);

  if (loadError) {
    return <p className="load-message notice-error">캠퍼스 데이터를 불러오지 못했습니다. {loadError}</p>;
  }
  if (!session || !state) return <p className="load-message">캠퍼스 데이터를 불러오는 중입니다…</p>;

  const selected = ui.selectedBuildingId ? Object.values(state.buildings).find((b) => b.id === ui.selectedBuildingId) : undefined;
  const scopeBuilding = ui.scope.kind === 'building' ? Object.values(state.buildings).find((b) => b.id === (ui.scope as { buildingId: string }).buildingId) : undefined;
  const closeDialog = () => setDialog(null);
  const one = ui.selection.length === 1 ? propsOf(state, ui.selection[0]!) : undefined;
  const editProps = (edits: CommonEdits) => {
    if (!one) return;
    const patch = propsPatch(one.props, edits);
    if (patch) perform(planSetProps(state, one.id, patch), 'flight_sec' in patch ? `${one.id}:flight_sec` : undefined);
  };

  return (
    <div className="app">
      <Toolbar
        ui={ui}
        operations={operations}
        campusName={session.meta.name}
        canSave={dirty}
        saving={saving}
        onTool={setTool}
        onChange={patchUi}
        onSave={() => void onSave()}
      />
      <div className="map-area">
        <MapView
          state={state}
          center={session.meta.center}
          tool={ui.tool}
          outdoorKind={ui.outdoorKind}
          basemap={ui.basemap}
          scope={ui.scope}
          highlight={highlight}
          canPick={canPick}
          routes={routeLines}
          focus={focus}
          onPathDrawn={onPathDrawn}
          onPolygonDrawn={(ring) => setDialog({ kind: 'building', ring })}
          onMapClick={onMapClick}
          onBoxSelect={onBoxSelect}
          beginDrag={beginDrag}
          onDragEnd={onDragEnd}
        />
        {selected && (
          <FloorPicker
            building={selected}
            scope={ui.scope}
            onPick={(level) => showFloor({ kind: 'building', buildingId: selected.id, level }, ui.tool === 'bridge')}
            onOutdoor={() => showFloor(OUTDOOR)}
          />
        )}
      </div>
      <SidePanel tab={ui.panelTab} onTab={(panelTab) => patchUi({ panelTab })} badges={{ checks: checks.errors.length }}>
        {ui.panelTab === 'properties' && <PropertiesPanel feature={one} selectedCount={ui.selection.length} onEdit={editProps} />}
        {ui.panelTab === 'checks' && <ChecksPanel result={checks} onLocate={onLocate} />}
        {ui.panelTab === 'routes' && (
          <RoutePanel
            places={places}
            fromId={ui.routeFrom}
            toId={ui.routeTo}
            results={routeResults}
            onPick={(end, id) => patchUi(end === 'from' ? { routeFrom: id } : { routeTo: id })}
          />
        )}
      </SidePanel>
      <StatusBar
        scopeLabel={scopeLabel(ui.scope, state)}
        nodes={counts.nodes}
        edges={counts.edges}
        dirty={dirty}
        notice={notice}
        hint={ui.tool === 'outdoor-path' || ui.tool === 'add-node' ? TOOL_HINTS[ui.tool] : null}
      />

      {dialog?.kind === 'building' && (
        <BuildingDialog
          onCancel={closeDialog}
          onSubmit={(form) => perform(planAddBuilding(dialog.ring, form))}
        />
      )}
      {dialog?.kind === 'delete-building' && (
        <DeleteBuildingDialog items={dialog.items} onCancel={closeDialog} onConfirm={() => perform(dialog.plan)} />
      )}
      {dialog?.kind === 'poi' && (
        <PoiDialog onCancel={closeDialog} onSubmit={(name) => perform(planOutdoorNode(state, session.ctx, dialog.position, name))} />
      )}
      {dialog?.kind === 'classroom' && ui.scope.kind === 'building' && (() => {
        const scope = ui.scope;
        return (
          <ClassroomDialog
            onCancel={closeDialog}
            onSubmit={({ ref, spaceName }) => perform(planIndoorNode(state, session.ctx, {
              buildingId: scope.buildingId, level: scope.level, kind: 'classroom', position: dialog.position, ref, spaceName,
            }))}
          />
        );
      })()}
      {dialog?.kind === 'elevator' && scopeBuilding && (
        <ElevatorDialog
          building={scopeBuilding}
          onCancel={closeDialog}
          onSubmit={(levels) => perform(planElevator(state, session.ctx, { buildingId: scopeBuilding.id, position: dialog.position, levels }))}
        />
      )}
      {dialog?.kind === 'stairs' && scopeBuilding && ui.scope.kind === 'building' && (
        <StairsDialog
          building={scopeBuilding}
          startLevel={ui.scope.level}
          onCancel={closeDialog}
          onSubmit={({ from, to }) => perform(planStairs(state, session.ctx, { buildingId: scopeBuilding.id, position: dialog.position, from, to }))}
        />
      )}
    </div>
  );
}

