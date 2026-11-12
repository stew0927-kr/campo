import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildGraph, buildingById, findFeature, findNearest, findRoute, validateCampus, type EditEdge, type EditNode, type EditState, type NearestResult, type Position, type RouteResult } from '@campo/core';
import { fetchCampusFiles, saveCampus } from './api.ts';
import type { RouteLine } from './map/layers.ts';
import { MapView, type FocusRequest, type MapClick } from './map/MapView.tsx';
import { planBridge } from './model/bridge.ts';
import { buildingAt, planAddBuilding } from './model/building.ts';
import { NOT_CONNECTED_NOTICE, planAttachUnattached, planDrawnPath, unattachedNodes } from './model/connect.ts';
import { HandleDrag, NodeDrag, type DragResult } from './model/drag.ts';
import {
  NEED_FLOOR, doorPreview, nextRefAfter, planDoor, planRestroom, planStrip, stripOptions, stripPreview, type RestroomForm, type StripInput,
} from './model/doors.ts';
import { copyBlocked, copySource, copyTargets, planCopyToFloors } from './model/copy.ts';
import { bridgeTargets, type CrossEnd } from './model/cross.ts';
import { planElevator, planElevatorEdit, stopsOf } from './model/elevator.ts';
import { planEscalator } from './model/escalator.ts';
import { featureCenter, featureScope } from './model/locate.ts';
import { menuFields, planMenuEdit, selectionSummary, type MenuEdits } from './model/menu.ts';
import { makeObservation, measureSummary, measureTargetOf, type Direction, type MeasureForm, type MeasureSummary, type MeasureTarget } from './model/measure.ts';
import {
  buildingsToDelete, nextSelection, planDelete, planFlip, planMerge, planSetProps, propsPatch, type CommonEdits,
} from './model/ops.ts';
import { isError, planReason, runPlan, type Plan, type PlanResult } from './model/plan.ts';
import { routeLine, routePlaces } from './model/places.ts';
import { OUTDOOR, defaultLevel, edgeInScope, levelStep, nodeInScope, nodeStrong, sameScope, scopeLabel, type Scope } from './model/scope.ts';
import {
  OBSERVATION_FILE, commitObservations, commitOverrides, createSession, extrasWithPending, pendingObservationsText, pendingOverrides, propsOf, stateToCampus, stateToFiles, type Session,
} from './model/session.ts';
import { edgeMidpoint, planSplit } from './model/split.ts';
import {
  planConnect, planIndoorNode, planOutdoorNode, planPortal, planStairs, type PathVertex,
} from './model/tools.ts';
import { ChecksPanel } from './ui/ChecksPanel.tsx';
import { ContextMenu } from './ui/ContextMenu.tsx';
import { CopyPanel } from './ui/CopyPanel.tsx';
import { HelpDialog } from './ui/HelpDialog.tsx';
import { CrossPicker } from './ui/CrossPicker.tsx';
import {
  AttachReportDialog, BuildingDialog, ClassroomDialog, DeleteBuildingDialog, ElevatorDialog, MeasureDialog, PoiDialog, RestroomDialog, StairsDialog,
  type AttachReportItem, type DeleteBuildingItem,
} from './ui/Dialogs.tsx';
import { FloorPicker } from './ui/FloorPicker.tsx';
import { MeasurePanel } from './ui/MeasurePanel.tsx';
import { PropertiesPanel } from './ui/PropertiesPanel.tsx';
import { RoutePanel } from './ui/RoutePanel.tsx';
import { SidePanel } from './ui/SidePanel.tsx';
import { StatusBar } from './ui/StatusBar.tsx';
import { StripForm } from './ui/StripForm.tsx';
import { Toolbar, type Operation } from './ui/Toolbar.tsx';
import { CROSS_TOOLS, OPERATION_KEYS, TOOL_HINTS, effectiveAddKind, initialStrip, initialUi, stripStage, toolAvailable, type StripState, type Tool, type UiState } from './ui/ui-state.ts';

// ?campus=<id> opens another campus folder (the e2e tests do); otherwise VITE_CAMPUS_ID, else hanyang-seoul.
const CAMPUS_ID = new URLSearchParams(window.location.search).get('campus')?.trim() || import.meta.env.VITE_CAMPUS_ID?.trim() || 'hanyang-seoul';

type Notice = { text: string; tone: 'info' | 'warn' | 'error' } | null;
/** Open form, with where it was asked for. Screen state. */
type Dialog =
  | { kind: 'classroom' | 'stairs' | 'poi'; position: Position; scope: Scope }
  | { kind: 'restroom'; position: Position; scope: Scope }
  | { kind: 'elevator'; position: Position; buildingId: string }
  | { kind: 'elevator-edit'; elevatorId: string }
  | { kind: 'measure'; target: MeasureTarget; directions: Direction[] }
  | { kind: 'attach-report'; attached: number; failed: AttachReportItem[] }
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
  const [strip, setStrip] = useState<StripState>(initialStrip);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  /** Right-click menu (page coordinates), the 다른 층에 복사 window (the ids it was opened for, and its result), the shortcut list. Screen state. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [copyPanel, setCopyPanel] = useState<{ ids: string[]; result: string[] | null } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Bumped when the session's unsaved measurements or loaded observations change (they live in the session, outside the edit history). */
  const [obsRev, setObsRev] = useState(0);
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

  const pendingMeasures = session?.pendingObservations.length ?? 0;
  useEffect(() => {
    if (!dirty && pendingMeasures === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, pendingMeasures]);

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
  /** 가장 가까운 화장실: core's findNearest as it is. Wheelchair: the step_free profile, and only restrooms marked wheelchair=yes. */
  const nearest = useMemo<{ kind: 'any' | 'wheelchair'; result: NearestResult } | null>(() => {
    if (!graph || !ui.routeFrom || !ui.nearest) return null;
    const wheelchair = ui.nearest === 'wheelchair';
    const result = findNearest(
      graph,
      ui.routeFrom,
      (n) => n.properties.node_type === 'restroom' && (!wheelchair || n.properties.wheelchair === 'yes'),
      wheelchair ? 'step_free' : 'shortest',
    );
    return { kind: ui.nearest, result };
  }, [graph, ui.routeFrom, ui.nearest]);
  const routeLines = useMemo<RouteLine[]>(() => {
    if (!checkedState || ui.panelTab !== 'routes') return [];
    const found = nearest ? [nearest.result] : routeResults;
    return found.flatMap((r) => (r.found && (r.profile === 'shortest' || r.profile === 'step_free')
      ? [{ profile: r.profile, coordinates: routeLine(r, checkedState) }] : []));
  }, [routeResults, nearest, checkedState, ui.panelTab]);

  // ---- 측정: the selected edge or elevator, with core's predicted time (a graph built without calibration) ----
  const measureTarget = useMemo(() => (state && ui.selection.length === 1 ? measureTargetOf(state, ui.selection) : null), [state, ui.selection]);
  const measureGraph = useMemo(
    () => (campus && ui.panelTab === 'properties' && measureTarget && 'target' in measureTarget ? buildGraph(campus, { calibration: {} }) : null),
    [campus, ui.panelTab, measureTarget],
  );
  const measure = useMemo<MeasureSummary | { reason: string } | null>(() => {
    if (!measureTarget || !session) return null;
    if (!('target' in measureTarget)) return measureTarget;
    return measureGraph ? measureSummary(measureTarget, measureGraph, session.extras, session.pendingObservations) : { reason: '길찾기 데이터를 확인하는 중입니다.' };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureTarget, measureGraph, session, obsRev]);

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
    const notices = result.notices ?? [];
    setNotice({
      text: [`${result.annotation}: 완료했습니다.`, ...r.warnings, ...notices].join(' '),
      tone: r.warnings.length > 0 || notices.includes(NOT_CONNECTED_NOTICE) ? 'warn' : 'info',
    });
    return undefined;
  };

  const setTool = (tool: Tool) => {
    patchUi({ tool, pickFrom: null });
    setStrip(initialStrip);
    setNotice(null);
  };

  /** Placing something on another floor shows that floor from then on; the outdoors never takes the view away from a floor. */
  const followScope = (scope: Scope) => {
    if (scope.kind === 'building' && !sameScope(scope, ui.scope)) {
      setUi((u) => ({ ...u, scope, selectedBuildingId: scope.buildingId }));
    }
  };

  /** [ and ]: the floor below / above the one shown. */
  const stepFloor = (dir: -1 | 1) => {
    if (!state) return;
    const b = ui.scope.kind === 'building' ? buildingById(state, ui.scope.buildingId) : ui.selectedBuildingId ? buildingById(state, ui.selectedBuildingId) : undefined;
    if (!b) return info('건물 선택으로 건물을 고르면 [ ] 로 층을 옮길 수 있습니다.');
    const next = ui.scope.kind === 'building' ? levelStep(b, ui.scope.level, dir) : defaultLevel(b);
    if (next === null) return info(dir < 0 ? '더 내려갈 층이 없습니다.' : '더 올라갈 층이 없습니다.');
    showFloor({ kind: 'building', buildingId: b.id, level: next });
  };

  const showFloor = (scope: Scope, keepPick = false) => setUi((u) => ({
    ...u,
    scope,
    selectedBuildingId: scope.kind === 'building' ? scope.buildingId : null,
    // Picking a floor is usually followed by adding points; tools that span floors keep their first pick.
    tool: u.tool === 'select-building' || !toolAvailable(u.tool, scope) ? (scope.kind === 'building' ? 'add-node' : 'select') : u.tool,
    pickFrom: keepPick ? u.pickFrom : null,
  }));

  const onPathDrawn = useCallback((vertices: PathVertex[], scope: Scope) => {
    if (!session || !state) return;
    const plan = planDrawnPath(state, session.ctx, vertices, ui.outdoorKind, scope);
    if (plan) {
      if (perform(plan) === undefined) followScope(scope);
    } else setNotice(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, state, ui.outdoorKind, ui.scope]);

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

  /** Nodes the plan added, to remember the last door. */
  const addedNodes = (before: EditState) => Object.values(session!.history.current().nodes).filter((n) => !(n.id in before.nodes));

  const placeDoor = (position: Position, scope: Scope, back: boolean) => {
    if (!session || !state) return;
    const run = ui.doorRun;
    const ref = back ? run.lastRef ?? '' : run.nextRef;
    if (back && run.lastRef === null) return fail('뒷문은 앞문을 찍은 다음에 만들 수 있습니다. 먼저 앞문을 눌러 주세요.');
    const plan = planDoor(state, session.ctx, { position, scope, ref, back });
    if (perform(plan) !== undefined) return;
    followScope(scope);
    const door = addedNodes(state).find((n) => n.props.node_type === 'door');
    patchUi({
      doorRun: back
        ? { ...run, lastDoorId: door?.id ?? run.lastDoorId }
        : { ...run, lastRef: ref.trim(), nextRef: nextRefAfter(ref.trim(), run.step), lastDoorId: door?.id ?? null },
    });
  };

  const stripInput = (s: StripState): StripInput | null => (s.first && s.last ? {
    corridorEdgeIds: s.edgeIds, first: s.first, last: s.last, count: Math.floor(Number(s.count)), startRef: s.startRef, refStep: s.refStep, doorsPerRoom: s.doorsPerRoom,
  } : null);

  const onStripClick = (position: Position, edge: MapClick['edge']) => {
    if (!state) return;
    const stage = stripStage(strip);
    if (edge && (stage === 'corridor' || stage === 'first')) {
      if (edge.props.highway !== 'corridor' || edge.props.edge_type !== 'indoor') return fail('복도 구간(건물 안 복도)을 눌러 주세요.');
      setStrip((st) => ({ ...st, edgeIds: st.edgeIds.includes(edge.id) ? st.edgeIds.filter((id) => id !== edge.id) : [...st.edgeIds, edge.id] }));
      return setNotice(null);
    }
    if (stage === 'corridor') return info('먼저 복도 구간을 눌러 주세요.');
    if (stage === 'first') return setStrip((st) => ({ ...st, first: position }));
    if (stage === 'last') return setStrip((st) => ({ ...st, last: position }));
  };

  const runStrip = () => {
    if (!session || !state) return;
    const input = stripInput(strip);
    if (!input) return fail('첫 문과 마지막 문 자리를 먼저 눌러 주세요.');
    if (perform(planStrip(state, session.ctx, input)) === undefined) setStrip(initialStrip);
  };

  const onMapClick = ({ position, node, edge, building, shift, scope: clicked }: MapClick) => {
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
        // The kind is the user's choice; WHERE it goes (outdoors or which floor) comes from the clicked place (SPEC-v0.2 5.2).
        const kind = effectiveAddKind(ui);
        if (kind === 'outdoor' || kind === 'poi') {
          if (clicked.kind !== 'outdoor') return fail('바깥 지점은 건물 밖을 눌러 만드세요. (O 키를 누르고 있으면 건물 위라도 바깥으로 찍힙니다.)');
          if (kind === 'poi') return setDialog({ kind, position, scope: clicked });
          return perform(planOutdoorNode(state, ctx, position));
        }
        if (clicked.kind !== 'building') return fail(NEED_FLOOR);
        if (kind === 'classroom' || kind === 'stairs') return setDialog({ kind, position, scope: clicked });
        if (perform(planIndoorNode(state, ctx, { buildingId: clicked.buildingId, level: clicked.level, kind, position })) === undefined) followScope(clicked);
        return;
      }
      case 'door':
        return placeDoor(position, clicked, shift);
      case 'strip':
        return onStripClick(position, edge);
      case 'restroom':
        return clicked.kind === 'building' ? setDialog({ kind: 'restroom', position, scope: clicked }) : fail(NEED_FLOOR);
      case 'elevator': {
        const stop = node && node.props.node_type === 'elevator_stop' ? node : undefined;
        if (stop?.props.elevator_id) return setDialog({ kind: 'elevator-edit', elevatorId: stop.props.elevator_id });
        return clicked.kind === 'building' ? setDialog({ kind: 'elevator', position, buildingId: clicked.buildingId }) : fail(NEED_FLOOR);
      }
      case 'connect':
        return pickPair(node, (a, b) => planConnect(state, ctx, a, b), '이을 다른 지점을 눌러 주세요.');
      case 'portal':
        return pickPair(node, (a, b) => planPortal(state, ctx, a, b), '이어질 바깥 지점을 눌러 주세요(흐리게 보이는 바깥 지점).');
      case 'bridge':
      case 'escalator':
        return onCrossClick(ui.tool, { position, node, clicked });
      default:
    }
  };

  /**
   * 연결통로 and 에스컬레이터: the first click picks the start and opens the small window; the floor chosen there is shown;
   * the second click is a point on that floor, or an empty spot where a new point is made. One Plan, one Ctrl+Z.
   */
  const onCrossClick = (tool: 'bridge' | 'escalator', { position, node, clicked }: { position: Position; node: EditNode | undefined; clicked: Scope }) => {
    if (!session || !state) return;
    const ctx = session.ctx;
    if (!ui.pickFrom) {
      if (!node) return info(tool === 'bridge' ? '시작할 지점(건물 안의 지점)을 눌러 주세요.' : '시작할 지점(아래쪽 지점)을 눌러 주세요.');
      let first: Scope | null = null;
      if (tool === 'bridge') {
        if (node.props.building_id === null) return fail('연결통로는 건물 안의 지점에서 시작합니다.');
        const target = bridgeTargets(state, node.id)[0];
        if (!target) return fail('이어질 다른 건물이 없습니다.');
        first = { kind: 'building', buildingId: target.building.id, level: target.level };
      } else if (node.props.building_id !== null) {
        const b = buildingById(state, node.props.building_id);
        const next = b && node.props.level !== null ? levelStep(b, node.props.level, 1) ?? levelStep(b, node.props.level, -1) : null;
        if (!b || next === null) return fail('층이 하나뿐인 건물에서는 에스컬레이터를 만들 수 없습니다.');
        first = { kind: 'building', buildingId: b.id, level: next };
      }
      patchUi({ pickFrom: node.id });
      if (first) showFloor(first, true);
      const where = first ? `${scopeLabel(first, state)}을(를) 보여 드립니다. ` : '';
      return info(`${node.id}을(를) 골랐습니다. ${where}창에서 고른 뒤 이어질 지점이나 빈자리를 눌러 주세요.`);
    }
    const from = state.nodes[ui.pickFrom];
    if (!from) return patchUi({ pickFrom: null });
    let end: CrossEnd;
    if (node) end = { nodeId: node.id };
    else {
      // An empty spot: a new point on the floor being shown (or outdoors).
      if (!sameScope(clicked, ui.scope)) {
        return fail(ui.scope.kind === 'building' ? '새 지점은 지금 보이는 층의 건물 안쪽에 만들 수 있습니다. 건물 안쪽을 눌러 주세요.' : '바깥에 새 지점을 만들려면 건물 밖을 눌러 주세요.');
      }
      end = clicked.kind === 'building' ? { position, buildingId: clicked.buildingId, level: clicked.level } : { position, buildingId: null, level: null };
    }
    const plan = tool === 'bridge'
      ? planBridge(state, ctx, from.id, end, { covered: ui.crossPick.noRoof ? false : null })
      : planEscalator(state, ctx, from.id, end, ui.crossPick.mode);
    if (perform(plan) === undefined) patchUi({ pickFrom: null });
  };

  const onBoxSelect = (ids: string[]) => {
    patchUi({ selection: ids, ...(ids.length > 0 ? { panelTab: 'properties' as const } : {}) });
    info(ids.length > 0 && state ? `${selectionSummary(state, ids)}를 골랐습니다.` : '상자 안에 고를 수 있는 지점이나 건물이 없습니다.');
  };

  const beginDrag = (nodeId: string) => new NodeDrag(session!.history, session!.ctx, nodeId);
  const beginHandleDrag = (edgeId: string): HandleDrag | string => {
    const mid = state ? edgeMidpoint(state, edgeId) : undefined;
    return mid ? HandleDrag.create(session!.history, session!.ctx, edgeId, mid) : '구간을 찾을 수 없습니다.';
  };
  const onDragEnd = (result: DragResult | null) => {
    lastProp.current = null;
    sync();
    if (result === null) return info('끌기를 취소했습니다. 지점을 원래 자리로 되돌렸습니다.');
    if (!result.ok) return fail(`${result.reason} 지점을 원래 자리로 되돌렸습니다.`);
    const text = { move: '지점을 옮겼습니다.', merge: '지점을 합쳤습니다.', split: '구간 위에 지점을 이었습니다.', handle: '구간 가운데에 새 지점을 만들었습니다.' }[result.kind];
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
  const splitPlanR = useMemo(() => (session && state ? planSplit(state, session.ctx, ui.selection) : null), [session, state, ui.selection]);
  const splitBlocked = useMemo(() => reasonOf(splitPlanR), [splitPlanR, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => (state && ui.scope.kind === 'building'
    ? unattachedNodes(state).filter((n) => n.props.building_id === (ui.scope as { buildingId: string }).buildingId && n.props.level === (ui.scope as { level: number }).level)
    : []), [state, ui.scope]);
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
  const doSplit = () => {
    if (splitPlanR) perform(splitPlanR);
  };
  /** 연결 안 된 지점 잇기: every unattached point of this floor in one entry; the ones that cannot be attached are listed with why. */
  const doAttachAll = () => {
    if (!session || !state) return;
    const { plan, failed } = planAttachUnattached(state, session.ctx, ui.scope);
    const report = failed.map((f) => ({ label: f.label, reason: f.reason }));
    if (plan) {
      if (perform(plan) !== undefined) return;
      if (report.length > 0) setDialog({ kind: 'attach-report', attached: plan.steps.length, failed: report });
    } else if (report.length > 0) setDialog({ kind: 'attach-report', attached: 0, failed: report });
    else info('이 층에는 연결 안 된 지점이 없습니다.');
  };
  /** V on a selected elevator stop: edit its floors; otherwise the 엘리베이터 tool. */
  const startElevator = () => {
    const only = ui.selection.length === 1 ? state?.nodes[ui.selection[0]!] : undefined;
    if (only?.props.node_type === 'elevator_stop' && only.props.elevator_id) setDialog({ kind: 'elevator-edit', elevatorId: only.props.elevator_id });
    else setTool('elevator');
  };
  /** 측정 추가: the line waits in the session until the next save (not an edit of the map: no Ctrl+Z). */
  const addObservation = (target: MeasureTarget, form: MeasureForm): string | undefined => {
    if (!session) return undefined;
    const made = makeObservation(target, form, new Date());
    if ('error' in made) return made.error;
    session.pendingObservations.push(made.record);
    setObsRev((v) => v + 1);
    setDialog(null);
    info('측정을 넣었습니다. 저장하면 observations/editor.jsonl에 더해지고, 그다음 npm run calibrate로 보정값을 계산합니다.');
    return undefined;
  };
  const clearPendingMeasures = (target: MeasureTarget) => {
    if (!session) return;
    session.pendingObservations = session.pendingObservations.filter((o) => o.target !== target.target);
    setObsRev((v) => v + 1);
    info('저장 전 측정을 지웠습니다.');
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
  // ---- 우클릭 메뉴, 다른 층에 복사 (SPEC-v0.2 5.1 작업) ----
  /** The target joins the selection when it was not in it (only it is selected then); the menu opens at the pointer. */
  const onContextMenu = ({ node, edge, x, y }: { node: EditNode | undefined; edge: EditEdge | undefined; x: number; y: number }) => {
    const hit = node?.id ?? edge?.id;
    if (!hit) return setCtxMenu(null);
    if (!ui.selection.includes(hit)) patchUi({ selection: [hit], panelTab: 'properties' });
    setCtxMenu({ x, y });
  };
  const menuEdit = (edits: MenuEdits) => {
    if (!state) return;
    perform(planMenuEdit(state, ui.selection, edits));
    setCtxMenu(null);
  };
  const openCopy = () => {
    setCtxMenu(null);
    setCopyPanel({ ids: [...ui.selection], result: null });
  };
  const runCopy = (levels: number[]): string | undefined => {
    if (!session || !state || !copyPanel) return undefined;
    const plan = planCopyToFloors(state, session.ctx, copyPanel.ids, levels);
    const err = perform(plan);
    if (err === undefined && !isError(plan)) setCopyPanel({ ...copyPanel, result: [`${plan.annotation}: 완료했습니다.`, ...(plan.notices ?? [])] });
    return err;
  };
  // The window closes when what it was opened for is gone (undo, delete) before it ran.
  useEffect(() => {
    if (!state || !copyPanel || copyPanel.result !== null) return;
    const src = copySource(state, copyPanel.ids);
    if ('error' in src) {
      setCopyPanel(null);
      setNotice({ text: src.error, tone: 'error' });
    }
  }, [state, copyPanel]);

  const blockedOr = (reason: string | false, run: () => void) => () => (reason === false ? run() : fail(reason));

  const operations: Operation[] = [
    { id: 'delete', label: '삭제', shortcut: OPERATION_KEYS.delete, blocked: deleteBlocked, onClick: blockedOr(deleteBlocked, () => doDelete(false)) },
    { id: 'delete-heal', label: '이어 붙이며 삭제', shortcut: OPERATION_KEYS['delete-heal'], blocked: healBlocked, onClick: blockedOr(healBlocked, () => doDelete(true)) },
    { id: 'merge', label: '합치기', shortcut: OPERATION_KEYS.merge, blocked: mergeBlocked, onClick: blockedOr(mergeBlocked, doMerge) },
    { id: 'flip', label: '뒤집기', shortcut: OPERATION_KEYS.flip, blocked: flipBlocked, onClick: blockedOr(flipBlocked, doFlip) },
    { id: 'split', label: '나누기', shortcut: OPERATION_KEYS.split, blocked: splitBlocked, onClick: blockedOr(splitBlocked, doSplit) },
    {
      id: 'attach-unattached',
      label: waiting.length > 0 ? `연결 안 된 지점 잇기 (${waiting.length})` : '연결 안 된 지점 잇기',
      shortcut: '',
      blocked: ui.scope.kind !== 'building' ? '층을 먼저 보여 주세요(건물 선택). 이 층의 연결 안 된 지점을 한 번에 잇습니다.' : waiting.length === 0 ? '이 층에는 연결 안 된 지점이 없습니다.' : false,
      onClick: doAttachAll,
    },
    { id: 'undo', label: '되돌리기', shortcut: OPERATION_KEYS.undo, blocked: session?.history.canUndo() ? false : '되돌릴 변경이 없습니다.', onClick: doUndo },
    { id: 'redo', label: '다시 하기', shortcut: OPERATION_KEYS.redo, blocked: session?.history.canRedo() ? false : '다시 할 변경이 없습니다.', onClick: doRedo },
  ];

  const onSave = useCallback(async () => {
    if (!session || !state || saving) return;
    const files = stateToFiles(state, session.meta, session.passthrough);
    // A split or heal of a closed edge carries its overrides.json entries along.
    const pending = pendingOverrides(session);
    if (pending) files['overrides.json'] = pending.text;
    // Measurements typed since the last save are appended to observations/editor.jsonl (the other observation files stay as they are).
    const observations = pendingObservationsText(session);
    if (observations !== null) files[OBSERVATION_FILE] = observations;
    const extras = extrasWithPending(session, pending ? { path: 'overrides.json', text: pending.text } : undefined);
    // SPEC §8: check before saving, on exactly the files that will be written.
    const { errors } = validateCampus(stateToCampus(state, session.meta, session.passthrough, extras));
    if (errors.length > 0 && !window.confirm(`검사 오류가 ${errors.length}개 있습니다. 그래도 저장하시겠습니까?`)) return;

    setSaving(true);
    try {
      const { written, removed } = await saveCampus(session.campusId, files);
      session.history.markSaved();
      if (pending) commitOverrides(session, pending);
      commitObservations(session);
      setObsRev((v) => v + 1);
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
    } else if (!mod && !e.altKey && !e.shiftKey && ui.tool === 'select' && k === 'x') {
      e.preventDefault();
      blockedOr(splitBlocked, doSplit)();
    } else if (!mod && !e.altKey && e.key === '?') {
      e.preventDefault();
      setHelpOpen(true);
    } else if (!mod && !e.altKey && !e.shiftKey && (k === '[' || k === ']')) {
      e.preventDefault();
      stepFloor(k === '[' ? -1 : 1);
    } else if (!mod && !e.altKey && !e.shiftKey && k === 'd') {
      e.preventDefault();
      setTool('door');
    } else if (!mod && !e.altKey && !e.shiftKey && k === 'r') {
      e.preventDefault();
      setTool('strip');
    } else if (!mod && !e.altKey && !e.shiftKey && k === 't') {
      e.preventDefault();
      setTool('restroom');
    } else if (!mod && !e.altKey && !e.shiftKey && k === 'p') {
      e.preventDefault();
      setTool('path');
    } else if (!mod && !e.altKey && !e.shiftKey && k === 'e') {
      e.preventDefault();
      setTool('escalator');
    } else if (!mod && !e.altKey && !e.shiftKey && k === 'v') {
      e.preventDefault();
      startElevator();
    } else if (!mod && !e.altKey && ui.tool === 'door' && (e.key === '1' || e.key === '2')) {
      e.preventDefault();
      patchUi({ doorRun: { ...ui.doorRun, step: e.key === '2' ? 2 : 1 } });
    } else if (!mod && !e.altKey && !e.shiftKey && ui.tool === 'door' && k === 'f') {
      e.preventDefault();
      // The door just placed turns into the other one (front <-> back).
      const plan = state && ui.doorRun.lastDoorId ? planFlip(state, [ui.doorRun.lastDoorId]) : { error: '뒤집을 문이 없습니다. 먼저 문을 찍어 주세요.' };
      perform(plan);
    } else if (!mod && !e.altKey && !e.shiftKey && ui.tool === 'strip' && k === 'f') {
      e.preventDefault();
      setStrip((st) => ({ ...st, first: st.last, last: st.first }));
    } else if (e.key === 'Enter' && ui.tool === 'strip' && stripStage(strip) === 'numbers') {
      e.preventDefault();
      runStrip();
    } else if (e.key === 'Escape') {
      if (copyPanel) {
        setCopyPanel(null);
      } else if (ui.tool === 'strip' && strip.edgeIds.length > 0) {
        setStrip(initialStrip);
      } else if (ui.pickFrom) {
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

  const highlight = useMemo(() => new Set([ui.pickFrom, ...ui.selection, ...(ui.tool === 'strip' ? strip.edgeIds : [])].filter((id): id is string => !!id)), [ui.pickFrom, ui.selection, ui.tool, strip.edgeIds]);

  /** What stays on the map while 강의실 줄 is being set up: the two clicked places, then the doors the row would place (core's own layout). */
  const stripShown = useMemo(() => {
    if (ui.tool !== 'strip' || !state) return { shapes: null, status: null as string | null };
    const input = stripInput(strip);
    if (input) {
      const pv = stripPreview(state, { ...input, count: Number.isFinite(input.count) ? input.count : 0 });
      return { shapes: pv.shapes, status: pv.text };
    }
    const points = [strip.first, strip.last].filter((p): p is [number, number] => p !== null);
    return {
      shapes: { type: 'FeatureCollection' as const, features: points.map((p) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p }, properties: { role: 'door' } })) },
      status: null as string | null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.tool, state, strip]);

  /** Second click of 포탈 picks an outdoor point; everything else picks on the floor being shown. */
  const canPick = useCallback((n: EditNode) => (
    ui.tool === 'portal' && ui.pickFrom ? n.props.building_id === null : ui.tool === 'select' ? nodeStrong(n, ui.scope) : nodeInScope(n, ui.scope)
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
  const closeDialog = () => setDialog(null);
  /** The first click of 연결통로 / 에스컬레이터 while its small window is open. */
  const crossFrom = CROSS_TOOLS.includes(ui.tool) && ui.pickFrom ? state.nodes[ui.pickFrom] : undefined;
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
        toolForm={ui.tool === 'strip' ? (
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
        onChange={patchUi}
        onSave={() => void onSave()}
        onHelp={() => setHelpOpen(true)}
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
          hover={['door', 'restroom', 'elevator'].includes(ui.tool) ? (pos, sc) => doorPreview(state, pos, sc) : null}
          previewShapes={stripShown.shapes}
          onPathDrawn={onPathDrawn}
          onPolygonDrawn={(ring) => setDialog({ kind: 'building', ring })}
          onMapClick={onMapClick}
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
        {copyPanel && (() => {
          const src = copySource(state, copyPanel.ids);
          if ('error' in src) return copyPanel.result ? <CopyPanel buildingName="" fromLevel={0} levels={[]} summary="" result={copyPanel.result} onRun={() => undefined} onClose={() => setCopyPanel(null)} /> : null;
          return (
            <CopyPanel
              key={copyPanel.ids.join(',')}
              buildingName={buildingById(state, src.buildingId)?.props.name ?? ''}
              fromLevel={src.level}
              levels={copyTargets(state, src.buildingId, src.level)}
              summary={selectionSummary(state, copyPanel.ids)}
              result={copyPanel.result}
              onRun={runCopy}
              onClose={() => setCopyPanel(null)}
            />
          );
        })()}
        {selected && !crossFrom && (
          <FloorPicker
            building={selected}
            scope={ui.scope}
            onPick={(level) => showFloor({ kind: 'building', buildingId: selected.id, level }, CROSS_TOOLS.includes(ui.tool))}
            onOutdoor={() => showFloor(OUTDOOR)}
          />
        )}
      </div>
      <SidePanel tab={ui.panelTab} onTab={(panelTab) => patchUi({ panelTab })} badges={{ checks: checks.errors.length }}>
        {ui.panelTab === 'properties' && (
          <>
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
        )}
        {ui.panelTab === 'checks' && <ChecksPanel result={checks} onLocate={onLocate} />}
        {ui.panelTab === 'routes' && (
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
        )}
      </SidePanel>
      <StatusBar
        scopeLabel={scopeLabel(ui.scope, state)}
        nodes={counts.nodes}
        edges={counts.edges}
        dirty={dirty}
        notice={notice}
        hint={ui.tool === 'path' || ui.tool === 'add-node' || ui.tool === 'door' ? TOOL_HINTS[ui.tool] : null}
      />

      {ctxMenu && ui.selection.length > 0 && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          summary={selectionSummary(state, ui.selection)}
          fields={menuFields(state, ui.selection)}
          copyBlocked={copyBlocked(state, ui.selection)}
          deleteBlocked={deleteBlocked}
          onEdit={menuEdit}
          onCopy={openCopy}
          onDelete={() => {
            setCtxMenu(null);
            doDelete(false);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
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
      {dialog?.kind === 'classroom' && dialog.scope.kind === 'building' && (() => {
        const at = dialog.scope;
        return (
          <ClassroomDialog
            onCancel={closeDialog}
            onSubmit={({ ref, spaceName }) => {
              const err = perform(planIndoorNode(state, session.ctx, { buildingId: at.buildingId, level: at.level, kind: 'classroom', position: dialog.position, ref, spaceName }));
              if (err === undefined) followScope(at);
              return err;
            }}
          />
        );
      })()}
      {dialog?.kind === 'restroom' && (
        <RestroomDialog
          onCancel={closeDialog}
          onSubmit={(form: RestroomForm) => {
            const err = perform(planRestroom(state, session.ctx, { position: dialog.position, scope: dialog.scope, form }));
            if (err === undefined) followScope(dialog.scope);
            return err;
          }}
        />
      )}
      {dialog?.kind === 'elevator' && buildingById(state, dialog.buildingId) && (
        <ElevatorDialog
          building={buildingById(state, dialog.buildingId)!}
          onCancel={closeDialog}
          onSubmit={(levels) => perform(planElevator(state, session.ctx, { buildingId: dialog.buildingId, position: dialog.position, levels }))}
        />
      )}
      {dialog?.kind === 'elevator-edit' && (() => {
        const stops = stopsOf(state, dialog.elevatorId);
        const b = stops[0]?.props.building_id ? buildingById(state, stops[0].props.building_id) : undefined;
        if (!b) return null;
        return (
          <ElevatorDialog
            building={b}
            initial={stops.map((n) => n.props.level!)}
            onCancel={closeDialog}
            onSubmit={(levels) => perform(planElevatorEdit(state, session.ctx, dialog.elevatorId, levels))}
          />
        );
      })()}
      {dialog?.kind === 'stairs' && dialog.scope.kind === 'building' && buildingById(state, dialog.scope.buildingId) && (() => {
        const at = dialog.scope;
        return (
          <StairsDialog
            building={buildingById(state, at.buildingId)!}
            startLevel={at.level}
            onCancel={closeDialog}
            onSubmit={({ from, to }) => {
              const err = perform(planStairs(state, session.ctx, { buildingId: at.buildingId, position: dialog.position, from, to }));
              if (err === undefined) followScope(at);
              return err;
            }}
          />
        );
      })()}
      {dialog?.kind === 'measure' && (
        <MeasureDialog target={dialog.target} directions={dialog.directions} onCancel={closeDialog} onSubmit={(form) => addObservation(dialog.target, form)} />
      )}
      {dialog?.kind === 'attach-report' && <AttachReportDialog attached={dialog.attached} failed={dialog.failed} onClose={closeDialog} />}
    </div>
  );
}

