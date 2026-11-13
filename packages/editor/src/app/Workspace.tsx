// The editor screen for one loaded campus. It keeps the screen state, turns clicks and keys into Plans (model/),
// and runs every Plan through `perform` as one history entry. It never changes the map data itself.
//
// Where things live:
//   ui/registry.ts      what tools, operations and tabs exist (names, keys, tooltips)
//   app/toolClicks.ts   what a map click does in each tool          (one entry per tool)
//   operations below    whether each operation can run now, and how (one entry per operation)
//   panels below        what each side-panel tab shows              (one entry per tab)
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildingById, type EditEdge, type EditNode, type EditState, type Override, type Position } from '@campo/core';
import { saveCampus } from '../api.ts';
import { MapView, type FocusRequest } from '../map/MapView.tsx';
import { NOT_CONNECTED_NOTICE, planAttachUnattached, planDrawnPath, unattachedNodes } from '../model/connect.ts';
import { copyBlocked, copySource, copyTargets, planCopyToFloors } from '../model/copy.ts';
import { doorPreview, planStrip, stripPreview, type StripInput } from '../model/doors.ts';
import { HandleDrag, NodeDrag, type DragResult } from '../model/drag.ts';
import { featureCenter, featureScope } from '../model/locate.ts';
import { makeObservation, type MeasureForm, type MeasureTarget } from '../model/measure.ts';
import { menuFields, planMenuEdit, selectionSummary, type MenuEdits } from '../model/menu.ts';
import { buildingsToDelete, planDelete, planFlip, planMerge, planSetProps, propsPatch, type CommonEdits } from '../model/ops.ts';
import { isError, planReason, runPlan, type PlanResult } from '../model/plan.ts';
import { OUTDOOR, defaultLevel, edgeInScope, levelStep, nodeInScope, nodeStrong, sameScope, scopeLabel, type Scope } from '../model/scope.ts';
import { propsOf, type Session } from '../model/session.ts';
import { edgeMidpoint, planSplit } from '../model/split.ts';
import type { PathVertex } from '../model/tools.ts';
import { levelRemoveBlocked, planRenameBuilding, planSetBuildingLevels, planSetBuildingName, renameBlocked } from '../model/buildingEdit.ts';
import { BuildingPanel } from '../ui/BuildingPanel.tsx';
import { ChecksPanel } from '../ui/ChecksPanel.tsx';
import { ContextMenu } from '../ui/ContextMenu.tsx';
import { CopyPanel } from '../ui/CopyPanel.tsx';
import { CrossPicker } from '../ui/CrossPicker.tsx';
import { FloorPicker } from '../ui/FloorPicker.tsx';
import { HelpDialog } from '../ui/HelpDialog.tsx';
import { MeasurePanel } from '../ui/MeasurePanel.tsx';
import { PropertiesPanel } from '../ui/PropertiesPanel.tsx';
import { OPERATIONS, TOOLS, parseKey, toolAvailable, toolDef, toolLabel, type OperationId, type PanelTab, type Tool } from '../ui/registry.ts';
import { ReportsPanel } from '../ui/ReportsPanel.tsx';
import { RoutePanel } from '../ui/RoutePanel.tsx';
import { SidePanel } from '../ui/SidePanel.tsx';
import { StatusBar } from '../ui/StatusBar.tsx';
import { StripForm } from '../ui/StripForm.tsx';
import { Toolbar, type OperationState } from '../ui/Toolbar.tsx';
import { TOOL_OPTIONS } from '../ui/ToolOptions.tsx';
import { followBuildingRename, initialStrip, initialUi, reconcileUi, stripStage, type StripState, type UiState } from '../ui/ui-state.ts';
import { AppDialogs, type Dialog } from './AppDialogs.tsx';
import { commitSave, prepareSave } from './persist.ts';
import { toolClicks } from './toolClicks.ts';
import { useInspection } from './useInspection.ts';
import { useReports } from './useReports.ts';
import { useShortcuts, type KeyBinding } from './useShortcuts.ts';

type Notice = { text: string; tone: 'info' | 'warn' | 'error' } | null;

const DRAG_DONE: Record<Extract<DragResult, { ok: true }>['kind'], string> = {
  move: '지점을 옮겼습니다.',
  merge: '지점을 합쳤습니다.',
  split: '구간 위에 지점을 이었습니다.',
  handle: '구간 가운데에 새 지점을 만들었습니다.',
};

const stripInput = (s: StripState): StripInput | null => (s.first && s.last ? {
  corridorEdgeIds: s.edgeIds, first: s.first, last: s.last, count: Math.floor(Number(s.count)), startRef: s.startRef, refStep: s.refStep, doorsPerRoom: s.doorsPerRoom,
} : null);

/** `session` is the edit engine (history, id generator, what the engine left out on load). It is mutable; `state` mirrors its current state. */
export function Workspace({ session }: { session: Session }) {
  const { history, ctx } = session;
  const [state, setState] = useState<EditState>(() => history.current());
  /** The state as last loaded or saved, to tell whether there are unsaved changes. */
  const [savedState, setSavedState] = useState<EditState>(state);
  const [ui, setUi] = useState<UiState>(initialUi);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [strip, setStrip] = useState<StripState>(initialStrip);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [notice, setNotice] = useState<Notice>(() => (session.passthrough.length > 0
    ? { text: `스키마에 맞지 않거나 이어진 지점이 없는 Feature ${session.passthrough.length}개는 고치지 않고 그대로 저장합니다.`, tone: 'error' }
    : null));
  const [saving, setSaving] = useState(false);
  /** Right-click menu (page coordinates), the 다른 층에 복사 window (the ids it was opened for, and its result), the shortcut list. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [copyPanel, setCopyPanel] = useState<{ ids: string[]; result: string[] | null } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Bumped when the session's unsaved measurements or loaded observations change (they live in the session, outside the edit history). */
  const [obsRev, setObsRev] = useState(0);
  /** Key of the last property edit, so a slider drag becomes one history entry. */
  const lastProp = useRef<string | null>(null);

  const info = (text: string) => setNotice({ text, tone: 'info' });
  const fail = (text: string) => setNotice({ text, tone: 'error' });
  const patchUi = (patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)) => setUi((u) => ({ ...u, ...(typeof patch === 'function' ? patch(u) : patch) }));
  const sync = () => setState(history.current());

  const dirty = useMemo(() => state !== savedState && JSON.stringify(state) !== JSON.stringify(savedState), [state, savedState]);
  const pendingMeasures = session.pendingObservations.length;
  useEffect(() => {
    if (!dirty && pendingMeasures === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pendingMeasures]);

  // Whatever the screen points at can disappear (delete, merge, undo): selection, shown floor, picks. See reconcileUi.
  useEffect(() => {
    setUi((u) => reconcileUi(u, state));
  }, [state]);

  const { checks, graph, places, routeResults, nearest, routeLines, measureTarget, measure } = useInspection(session, state, ui, obsRev);

  // ---- Edits: every one is a Plan of core actions run as one history entry ----

  /** Run a plan. Returns the error (for a dialog to show) or undefined. `coalesce` folds repeated edits of one thing into one entry. */
  const perform = (result: PlanResult, coalesce?: string): string | undefined => {
    if (isError(result)) {
      fail(result.error);
      return result.error;
    }
    if (coalesce !== undefined && lastProp.current === coalesce && history.canUndo()) history.undo();
    const r = runPlan(history, result);
    lastProp.current = r.ok ? coalesce ?? null : null;
    sync();
    if (!r.ok) {
      fail(r.reason);
      return r.reason;
    }
    setDialog(null);
    const notices = result.notices ?? [];
    setNotice({
      text: [`${result.annotation}: 완료했습니다.`, ...r.warnings, ...notices].join(' '),
      tone: r.warnings.length > 0 || notices.includes(NOT_CONNECTED_NOTICE) ? 'warn' : 'info',
    });
    return undefined;
  };

  const stepHistory = (dir: 'undo' | 'redo') => {
    history[dir]();
    lastProp.current = null;
    sync();
    info(dir === 'undo' ? '되돌렸습니다.' : '다시 했습니다.');
  };

  // ---- What is shown: the tool, the floor, the place ----

  const setTool = (tool: Tool) => {
    patchUi({ tool, pickFrom: null });
    setStrip(initialStrip);
    setNotice(null);
  };

  /** Jump to `scope` (from a list, not the floor picker). A tool that cannot be used there gives way to 선택. */
  const showScope = (scope: Scope, patch: Partial<UiState>) => setUi((u) => ({
    ...u,
    scope,
    selectedBuildingId: scope.kind === 'building' ? scope.buildingId : null,
    pickFrom: null,
    tool: toolAvailable(u.tool, scope) ? u.tool : 'select',
    ...patch,
  }));
  const focusOn = (position: Position) => setFocus((prev) => ({ position, seq: (prev?.seq ?? 0) + 1 }));

  /** The floor picker and [ ]. Picking a floor is usually followed by adding points; tools that span floors keep their first pick. */
  const showFloor = (scope: Scope, keepPick = false) => setUi((u) => ({
    ...u,
    scope,
    selectedBuildingId: scope.kind === 'building' ? scope.buildingId : null,
    tool: u.tool === 'select-building' || !toolAvailable(u.tool, scope) ? (scope.kind === 'building' ? 'add-node' : 'select') : u.tool,
    pickFrom: keepPick ? u.pickFrom : null,
  }));

  /** Placing something on another floor shows that floor from then on; the outdoors never takes the view away from a floor. */
  const followScope = (scope: Scope) => {
    if (scope.kind === 'building' && !sameScope(scope, ui.scope)) patchUi({ scope, selectedBuildingId: scope.buildingId });
  };

  /** [ and ]: the floor below / above the one shown. */
  const stepFloor = (dir: -1 | 1) => {
    const buildingId = ui.scope.kind === 'building' ? ui.scope.buildingId : ui.selectedBuildingId;
    const b = buildingId ? buildingById(state, buildingId) : undefined;
    if (!b) return info(`${toolLabel('select-building')}으로 건물을 고르면 [ ] 로 층을 옮길 수 있습니다.`);
    const next = ui.scope.kind === 'building' ? levelStep(b, ui.scope.level, dir) : defaultLevel(b);
    if (next === null) return info(dir < 0 ? '더 내려갈 층이 없습니다.' : '더 올라갈 층이 없습니다.');
    showFloor({ kind: 'building', buildingId: b.id, level: next });
  };

  /** Show and select a Feature (검사 목록, 제보). `from`: the state to look it up in, when newer than the rendered one. */
  const locateFeature = (featureId: string, from: EditState = state) => {
    const scope = featureScope(from, featureId);
    showScope(scope, {
      selection: [featureId],
      // A building is outdoors, but its floor picker opens.
      ...(scope.kind === 'outdoor' && buildingById(from, featureId) ? { selectedBuildingId: featureId } : {}),
    });
    const center = featureCenter(from, featureId);
    if (center) focusOn(center);
  };
  const showPlace = (scope: Scope, position: Position) => {
    showScope(scope, { selection: [] });
    focusOn(position);
  };

  // ---- Map clicks: one handler per tool (toolClicks.ts). 길 그리기 and 건물 외곽선 그리기 draw with Terra Draw instead. ----
  const onToolClick = toolClicks({
    state, ctx, ui, strip, perform, patchUi, setStrip, followScope, showFloor, info, fail,
    currentState: () => history.current(),
    openDialog: setDialog,
    clearNotice: () => setNotice(null),
  });
  const runStrip = () => {
    const input = stripInput(strip);
    if (!input) return fail('첫 문과 마지막 문 자리를 먼저 눌러 주세요.');
    if (perform(planStrip(state, ctx, input)) === undefined) setStrip(initialStrip);
  };

  const onPathDrawn = useCallback((vertices: PathVertex[], scope: Scope) => {
    const plan = planDrawnPath(state, ctx, vertices, ui.outdoorKind, scope);
    if (!plan) return setNotice(null);
    if (perform(plan) === undefined) followScope(scope);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, state, ui.outdoorKind, ui.scope]);

  const onBoxSelect = (ids: string[]) => {
    patchUi({ selection: ids, ...(ids.length > 0 ? { panelTab: 'properties' as const } : {}) });
    info(ids.length > 0 ? `${selectionSummary(state, ids)}를 골랐습니다.` : '상자 안에 고를 수 있는 지점이나 건물이 없습니다.');
  };

  // ---- Dragging (the drag classes own the history side, SPEC-v0.2 5.1) ----
  const beginDrag = (nodeId: string) => new NodeDrag(history, ctx, nodeId);
  const beginHandleDrag = (edgeId: string): HandleDrag | string => {
    const mid = edgeMidpoint(state, edgeId);
    return mid ? HandleDrag.create(history, ctx, edgeId, mid) : '구간을 찾을 수 없습니다.';
  };
  const onDragEnd = (result: DragResult | null) => {
    lastProp.current = null;
    sync();
    if (result === null) return info('끌기를 취소했습니다. 지점을 원래 자리로 되돌렸습니다.');
    if (!result.ok) return fail(`${result.reason} 지점을 원래 자리로 되돌렸습니다.`);
    setNotice({ text: [DRAG_DONE[result.kind], ...result.warnings].join(' '), tone: result.warnings.length > 0 ? 'warn' : 'info' });
  };

  // ---- Operations (SPEC-v0.2 5.3): the plan each would run on the selection, and why it cannot run now ----
  const selectionOps = useMemo(() => {
    const plans = {
      delete: planDelete(state, ctx, ui.selection, false),
      merge: planMerge(state, ctx, ui.selection),
      flip: planFlip(state, ui.selection),
      split: planSplit(state, ctx, ui.selection),
    };
    const reason = (plan: PlanResult) => (isError(plan) ? plan.error : planReason(state, plan));
    return {
      plans,
      blocked: { delete: reason(plans.delete), merge: reason(plans.merge), flip: reason(plans.flip), split: reason(plans.split) },
    };
  }, [ctx, state, ui.selection]);
  /** Points of the floor being shown that are not joined to a corridor yet. */
  const waiting = useMemo(() => {
    const { scope } = ui;
    return scope.kind === 'building' ? unattachedNodes(state).filter((n) => n.props.building_id === scope.buildingId && n.props.level === scope.level) : [];
  }, [state, ui.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const doDelete = (heal: boolean) => {
    const plan = planDelete(state, ctx, ui.selection, heal);
    if (isError(plan)) return fail(plan.error);
    const reason = planReason(state, plan);
    if (reason !== false) return fail(reason);
    const doomed = buildingsToDelete(state, ui.selection);
    // A building takes everything in it along: show the counts first.
    if (doomed.length > 0) return setDialog({ kind: 'delete-building', plan, items: doomed.map((b) => ({ code: b.code, name: b.name, ...b.preview })) });
    perform(plan);
  };
  /** Every unattached point of this floor in one entry; the ones that cannot be attached are listed with why. */
  const doAttachAll = () => {
    const { plan, failed } = planAttachUnattached(state, ctx, ui.scope);
    if (plan && perform(plan) !== undefined) return;
    if (failed.length > 0) setDialog({ kind: 'attach-report', attached: plan?.steps.length ?? 0, failed: failed.map((f) => ({ label: f.label, reason: f.reason })) });
    else if (!plan) info('이 층에는 연결 안 된 지점이 없습니다.');
  };

  const { plans, blocked } = selectionOps;
  /** `soft`: being unable to run is not a mistake of the user's (nothing to undo), so the reason is shown as plain information. */
  const operations: Record<OperationId, OperationState & { run: () => void; soft?: true }> = {
    delete: { blocked: blocked.delete, run: () => doDelete(false) },
    'delete-heal': {
      blocked: ui.selection.some((id) => id in state.nodes) ? blocked.delete : '지점을 지우고 양쪽 구간을 이으려면 지점을 골라 주세요.',
      run: () => doDelete(true),
    },
    merge: { blocked: blocked.merge, run: () => perform(plans.merge) },
    flip: { blocked: blocked.flip, run: () => perform(plans.flip) },
    split: { blocked: blocked.split, run: () => perform(plans.split) },
    undo: { blocked: history.canUndo() ? false : '되돌릴 변경이 없습니다.', soft: true, run: () => stepHistory('undo') },
    redo: { blocked: history.canRedo() ? false : '다시 할 변경이 없습니다.', soft: true, run: () => stepHistory('redo') },
    'attach-unattached': {
      blocked: ui.scope.kind !== 'building'
        ? `층을 먼저 보여 주세요(${toolLabel('select-building')}). 이 층의 연결 안 된 지점을 한 번에 잇습니다.`
        : waiting.length === 0 ? '이 층에는 연결 안 된 지점이 없습니다.' : false,
      count: waiting.length,
      soft: true,
      run: doAttachAll,
    },
  };
  /** A toolbar button or its key: run the operation, or say why it cannot run. */
  const runOperation = (id: OperationId) => {
    const op = operations[id];
    if (op.blocked === false) op.run();
    else setNotice({ text: op.blocked, tone: op.soft ? 'info' : 'error' });
  };

  /** V on a selected elevator stop: edit its floors; otherwise the 엘리베이터 tool. */
  const startElevator = () => {
    const only = ui.selection.length === 1 ? state.nodes[ui.selection[0]!] : undefined;
    if (only?.props.node_type === 'elevator_stop' && only.props.elevator_id) setDialog({ kind: 'elevator-edit', elevatorId: only.props.elevator_id });
    else setTool('elevator');
  };

  // ---- 측정: lines wait in the session until the next save (not an edit of the map: no Ctrl+Z) ----
  const addObservation = (target: MeasureTarget, form: MeasureForm): string | undefined => {
    const made = makeObservation(target, form, new Date());
    if ('error' in made) return made.error;
    session.pendingObservations.push(made.record);
    setObsRev((v) => v + 1);
    setDialog(null);
    info('측정을 넣었습니다. 저장하면 observations/editor.jsonl에 더해지고, 그다음 npm run calibrate로 보정값을 계산합니다.');
    return undefined;
  };
  const clearPendingMeasures = (target: MeasureTarget) => {
    session.pendingObservations = session.pendingObservations.filter((o) => o.target !== target.target);
    setObsRev((v) => v + 1);
    info('저장 전 측정을 지웠습니다.');
  };

  // ---- 우클릭 메뉴, 다른 층에 복사 (SPEC-v0.2 5.1 작업) ----
  /** The target joins the selection when it was not in it (only it is selected then); the menu opens at the pointer. */
  const onContextMenu = ({ node, edge, x, y }: { node: EditNode | undefined; edge: EditEdge | undefined; x: number; y: number }) => {
    const hit = node?.id ?? edge?.id;
    if (!hit) return setCtxMenu(null);
    if (!ui.selection.includes(hit)) patchUi({ selection: [hit], panelTab: 'properties' });
    setCtxMenu({ x, y });
  };
  const menuEdit = (edits: MenuEdits) => {
    perform(planMenuEdit(state, ui.selection, edits));
    setCtxMenu(null);
  };
  const runCopy = (levels: number[]): string | undefined => {
    if (!copyPanel) return undefined;
    const plan = planCopyToFloors(state, ctx, copyPanel.ids, levels);
    const err = perform(plan);
    if (err === undefined && !isError(plan)) setCopyPanel({ ...copyPanel, result: [`${plan.annotation}: 완료했습니다.`, ...(plan.notices ?? [])] });
    return err;
  };
  const copyFrom = useMemo(() => (copyPanel ? copySource(state, copyPanel.ids) : null), [state, copyPanel]);
  // The window closes when what it was opened for is gone (undo, delete) before it ran.
  useEffect(() => {
    if (!copyPanel || copyPanel.result !== null || !copyFrom || !('error' in copyFrom)) return;
    setCopyPanel(null);
    setNotice({ text: copyFrom.error, tone: 'error' });
  }, [copyPanel, copyFrom]);

  // ---- Saving ----
  /** Write the campus folder. Returns what was written, or null when the person declined to save despite check errors. */
  const persistCampus = async (queued: readonly Override[]) => {
    const save = prepareSave(session, state, queued);
    if (save.errorCount > 0 && !window.confirm(`검사 오류가 ${save.errorCount}개 있습니다. 그래도 저장하시겠습니까?`)) return null;
    const result = await saveCampus(session.campusId, save.files);
    commitSave(session, save);
    setObsRev((v) => v + 1);
    setSavedState(state);
    return result;
  };
  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await persistCampus([]);
      if (result) {
        const removedText = result.removed.length > 0 ? `, 지운 파일 ${result.removed.length}개` : '';
        info(`저장했습니다. 쓴 파일 ${result.written.length}개${removedText}. 커밋은 Git에서 해 주세요.`);
      }
    } catch (err) {
      fail((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reports = useReports({ session, state, saving, setSaving, perform, persistCampus, locateFeature, showPlace, info, fail });

  // ---- Keys (SPEC-v0.2 5.3). Tool and operation keys come from the registry; the rest belong to one tool or to the screen. ----
  const onEscape = () => {
    if (copyPanel) setCopyPanel(null);
    else if (ui.tool === 'strip' && strip.edgeIds.length > 0) setStrip(initialStrip);
    else if (ui.pickFrom) {
      patchUi({ pickFrom: null });
      setNotice(null);
    } else if (ui.selection.length > 0) patchUi({ selection: [] });
    else if (ui.tool !== 'select') setTool('select');
  };
  const selecting = ui.tool === 'select';
  const inDoor = ui.tool === 'door';
  const inStrip = ui.tool === 'strip';
  useShortcuts([
    { key: 's', mod: true, run: () => void onSave() },
    ...OPERATIONS.flatMap((o) => [o.key, o.aliasKey].flatMap((k): KeyBinding[] => (
      k ? [{ ...parseKey(k), when: !o.onSelection || selecting, run: () => runOperation(o.id) }] : []
    ))),
    { key: '?', run: () => setHelpOpen(true) },
    { key: '[', shift: false, run: () => stepFloor(-1) },
    { key: ']', shift: false, run: () => stepFloor(1) },
    ...TOOLS.flatMap((t): KeyBinding[] => (
      t.key ? [{ key: t.key.toLowerCase(), shift: false, when: toolAvailable(t.id, ui.scope), run: () => (t.id === 'elevator' ? startElevator() : setTool(t.id)) }] : []
    )),
    { key: '1', when: inDoor, run: () => patchUi({ doorRun: { ...ui.doorRun, step: 1 } }) },
    { key: '2', when: inDoor, run: () => patchUi({ doorRun: { ...ui.doorRun, step: 2 } }) },
    {
      // The door just placed turns into the other one (front <-> back).
      key: 'f', shift: false, when: inDoor,
      run: () => perform(ui.doorRun.lastDoorId ? planFlip(state, [ui.doorRun.lastDoorId]) : { error: '뒤집을 문이 없습니다. 먼저 문을 찍어 주세요.' }),
    },
    { key: 'f', shift: false, when: inStrip, run: () => setStrip((st) => ({ ...st, first: st.last, last: st.first })) },
    { key: 'enter', mod: 'any', when: inStrip && stripStage(strip) === 'numbers', run: runStrip },
    { key: 'escape', mod: 'any', keepDefault: true, run: onEscape },
  ]);

  // ---- What the map shows ----
  const reportsOpen = ui.panelTab === 'reports';
  const highlight = useMemo(
    () => new Set([ui.pickFrom, ...ui.selection, ...(inStrip ? strip.edgeIds : []), ...(reportsOpen ? reports.highlight : [])].filter((id): id is string => !!id)),
    [ui.pickFrom, ui.selection, inStrip, strip.edgeIds, reportsOpen, reports.highlight],
  );

  /** What stays on the map while 강의실 자동 연결 is being set up: the two clicked places, then the doors the row would place (core's own layout). */
  const stripShown = useMemo(() => {
    if (!inStrip) return { shapes: null, status: null };
    const input = stripInput(strip);
    if (input) {
      const pv = stripPreview(state, { ...input, count: Number.isFinite(input.count) ? input.count : 0 });
      return { shapes: pv.shapes, status: pv.text };
    }
    const points = [strip.first, strip.last].filter((p): p is [number, number] => p !== null);
    return {
      shapes: { type: 'FeatureCollection' as const, features: points.map((p) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p }, properties: { role: 'door' } })) },
      status: null,
    };
  }, [inStrip, state, strip]);

  /** Second click of 출입구 연결 picks an outdoor point; everything else picks on the floor being shown. */
  const canPick = useCallback((n: EditNode) => {
    if (ui.tool === 'portal' && ui.pickFrom) return n.props.building_id === null;
    return ui.tool === 'select' ? nodeStrong(n, ui.scope) : nodeInScope(n, ui.scope);
  }, [ui.tool, ui.pickFrom, ui.scope]);

  const counts = useMemo(() => ({
    nodes: Object.values(state.nodes).filter((n) => nodeInScope(n, ui.scope)).length,
    edges: Object.values(state.edges).filter((e) => edgeInScope(state, e, ui.scope)).length,
  }), [state, ui.scope]);

  const floorBuilding = ui.selectedBuildingId ? buildingById(state, ui.selectedBuildingId) : undefined;
  /** The first click of 연결통로 / 에스컬레이터 while its small window is open. */
  const crossFrom = toolDef(ui.tool).cross && ui.pickFrom ? state.nodes[ui.pickFrom] : undefined;
  const one = ui.selection.length === 1 ? propsOf(state, ui.selection[0]!) : undefined;
  const editProps = (edits: CommonEdits) => {
    if (!one) return;
    const patch = propsPatch(one.props, edits);
    if (patch) perform(planSetProps(state, one.id, patch), 'flight_sec' in patch ? `${one.id}:flight_sec` : undefined);
  };

  /** The building outline selected: its name, code and floors. The selection and the shown floor follow a new code. */
  const selectedBuilding = one?.props.kind === 'building' ? buildingById(state, one.id) : undefined;
  const renameSelected = (newCode: string) => {
    if (!selectedBuilding) return undefined;
    const { id, props } = selectedBuilding;
    const err = perform(planRenameBuilding(ctx, props.code, newCode));
    if (err === undefined) setUi((u) => followBuildingRename(u, id, `bldg_${newCode.trim()}`));
    return err;
  };

  /** What each tab of the side panel shows. */
  const panels: Record<PanelTab, () => ReactNode> = {
    properties: () => (
      <>
        {selectedBuilding && (
          <BuildingPanel
            building={selectedBuilding}
            onName={(name) => perform(planSetBuildingName(state, selectedBuilding.props.code, name))}
            onRename={renameSelected}
            onLevels={(levels) => perform(planSetBuildingLevels(selectedBuilding.props.code, levels))}
            renameBlocked={(newCode) => renameBlocked(state, ctx, selectedBuilding.props.code, newCode)}
            removeBlocked={(level) => levelRemoveBlocked(state, selectedBuilding.props.code, level)}
          />
        )}
        <PropertiesPanel feature={one} selectedCount={ui.selection.length} onEdit={editProps} />
        {measure && measureTarget && (
          <MeasurePanel
            summary={measure}
            pending={'target' in measureTarget ? session.pendingObservations.filter((o) => o.target === measureTarget.target).length : 0}
            onAdd={() => 'target' in measure && setDialog({ kind: 'measure', target: measure.target, directions: measure.directions.map((d) => d.direction) })}
            onClearPending={() => 'target' in measureTarget && clearPendingMeasures(measureTarget)}
          />
        )}
      </>
    ),
    checks: () => <ChecksPanel result={checks} onLocate={locateFeature} />,
    routes: () => (
      <RoutePanel
        places={places}
        fromId={ui.routeFrom}
        toId={ui.routeTo}
        results={routeResults}
        nearest={nearest}
        warnings={graph?.warnings ?? []}
        onPick={(end, id) => patchUi(end === 'from' ? { routeFrom: id } : { routeTo: id, nearest: null })}
        onNearest={(kind) => patchUi({ nearest: kind })}
      />
    ),
    reports: () => <ReportsPanel state={state} {...reports.panel} />,
  };

  return (
    <div className="app">
      <Toolbar
        ui={ui}
        operations={operations}
        toolForm={inStrip ? (
          <StripForm
            strip={strip}
            status={stripShown.status}
            onChange={(patch) => setStrip((st) => ({ ...st, ...patch }))}
            onRun={runStrip}
            onReset={() => setStrip(initialStrip)}
          />
        ) : undefined}
        campusName={session.meta.name}
        canSave={dirty || pendingMeasures > 0}
        saving={saving}
        onTool={setTool}
        onOperation={runOperation}
        onChange={patchUi}
        onSave={() => void onSave()}
        onHelp={() => setHelpOpen(true)}
      />
      <div className="map-area">
        <MapView
          state={state}
          center={session.meta.center}
          limits={session.meta.map_limits}
          tool={ui.tool}
          outdoorKind={ui.outdoorKind}
          basemap={ui.basemap}
          scope={ui.scope}
          highlight={highlight}
          canPick={canPick}
          routes={routeLines}
          focus={focus}
          hover={toolDef(ui.tool).attachPreview ? (pos, sc) => doorPreview(state, pos, sc) : null}
          previewShapes={stripShown.shapes}
          onPathDrawn={onPathDrawn}
          onPolygonDrawn={(ring) => setDialog({ kind: 'building', ring })}
          onMapClick={(click) => onToolClick[ui.tool]?.(click)}
          onContextMenu={onContextMenu}
          onBoxSelect={onBoxSelect}
          beginDrag={beginDrag}
          beginHandleDrag={beginHandleDrag}
          onHandleRefused={fail}
          onDragEnd={onDragEnd}
        />
        {crossFrom && (
          <CrossPicker
            tool={ui.tool as 'bridge' | 'escalator'}
            state={state}
            fromId={crossFrom.id}
            scope={ui.scope}
            pick={ui.crossPick}
            onPick={(patch) => patchUi({ crossPick: { ...ui.crossPick, ...patch } })}
            onShow={(scope) => showFloor(scope, true)}
            onCancel={() => patchUi({ pickFrom: null })}
          />
        )}
        {copyPanel && copyFrom && ('error' in copyFrom
          // What was copied may be gone again (undo): the result stays readable until the window is closed.
          ? copyPanel.result && <CopyPanel buildingName="" fromLevel={0} levels={[]} summary="" result={copyPanel.result} onRun={() => undefined} onClose={() => setCopyPanel(null)} />
          : (
            <CopyPanel
              key={copyPanel.ids.join(',')}
              buildingName={buildingById(state, copyFrom.buildingId)?.props.name ?? ''}
              fromLevel={copyFrom.level}
              levels={copyTargets(state, copyFrom.buildingId, copyFrom.level)}
              summary={selectionSummary(state, copyPanel.ids)}
              result={copyPanel.result}
              onRun={runCopy}
              onClose={() => setCopyPanel(null)}
            />
          ))}
        {floorBuilding && !crossFrom && (
          <FloorPicker
            building={floorBuilding}
            scope={ui.scope}
            onPick={(level) => showFloor({ kind: 'building', buildingId: floorBuilding.id, level }, toolDef(ui.tool).cross)}
            onOutdoor={() => showFloor(OUTDOOR)}
          />
        )}
      </div>
      <SidePanel tab={ui.panelTab} onTab={(panelTab) => patchUi({ panelTab })} badges={{ checks: checks.errors.length, reports: reports.badge }}>
        {panels[ui.panelTab]()}
      </SidePanel>
      <StatusBar
        scopeLabel={scopeLabel(ui.scope, state)}
        nodes={counts.nodes}
        edges={counts.edges}
        dirty={dirty}
        notice={notice}
        hint={ui.tool in TOOL_OPTIONS ? toolDef(ui.tool).hint : null}
      />

      {ctxMenu && ui.selection.length > 0 && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          summary={selectionSummary(state, ui.selection)}
          fields={menuFields(state, ui.selection)}
          copyBlocked={copyBlocked(state, ui.selection)}
          deleteBlocked={blocked.delete}
          onEdit={menuEdit}
          onCopy={() => {
            setCtxMenu(null);
            setCopyPanel({ ids: [...ui.selection], result: null });
          }}
          onDelete={() => {
            setCtxMenu(null);
            doDelete(false);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {dialog && (
        <AppDialogs
          dialog={dialog}
          state={state}
          ctx={ctx}
          perform={perform}
          followScope={followScope}
          addObservation={addObservation}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
