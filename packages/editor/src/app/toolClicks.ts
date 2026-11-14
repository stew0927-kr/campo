// What a click on the map does in each tool. One entry per tool of the registry (the Record type makes a new tool fill its own in).
// A handler reads the screen state, builds a Plan (model/) and hands it to `perform`, or opens a form; it never edits the data itself.
import type { Dispatch, SetStateAction } from 'react';
import { buildingById, type EditContext, type EditNode, type EditState, type Position } from '@campo/core';
import type { MapClick } from '../map/MapView.tsx';
import { planBridge } from '../model/bridge.ts';
import { buildingAt } from '../model/building.ts';
import { bridgeTargets, type CrossEnd } from '../model/cross.ts';
import { NEED_FLOOR, nextRefAfter, planDoor } from '../model/doors.ts';
import { planEscalator } from '../model/escalator.ts';
import { nextSelection } from '../model/ops.ts';
import type { PlanResult } from '../model/plan.ts';
import { levelStep, sameScope, scopeLabel, type Scope } from '../model/scope.ts';
import { withSyncMirror } from '../model/sync.ts';
import { planConnect, planIndoorNode, planOutdoorNode, planPortal } from '../model/tools.ts';
import type { Tool } from '../ui/registry.ts';
import { effectiveAddKind, stripStage, type StripState, type UiState } from '../ui/ui-state.ts';
import type { Dialog } from './AppDialogs.tsx';

/** What the handlers may read and do. Everything that changes the map goes through `perform`. */
export interface ToolEnv {
  state: EditState;
  ctx: EditContext;
  ui: UiState;
  strip: StripState;
  /** The engine's state right now (after a `perform` in the same handler, when `state` is still the rendered one). */
  currentState: () => EditState;
  /** Run a plan as one history entry; returns the error, or undefined when it ran. */
  perform: (plan: PlanResult) => string | undefined;
  /** A patch, or a function of the latest screen state (for updates that build on what is there). */
  patchUi: (patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)) => void;
  setStrip: Dispatch<SetStateAction<StripState>>;
  openDialog: (dialog: Dialog) => void;
  /** Something was placed on this floor: show it from now on. */
  followScope: (scope: Scope) => void;
  showFloor: (scope: Scope, keepPick?: boolean) => void;
  /** OSM 건물 가져오기: ask OpenStreetMap for the building at the position and add it (asynchronous). */
  importOsm: (position: Position) => void;
  info: (text: string) => void;
  fail: (text: string) => void;
  clearNotice: () => void;
}

export type ToolClick = (click: MapClick) => void;

/** null: the tool draws with Terra Draw and reports through onPathDrawn / onPolygonDrawn instead. */
export function toolClicks(env: ToolEnv): Record<Tool, ToolClick | null> {
  const { state, ctx, ui, strip, perform, patchUi, setStrip, openDialog, followScope, info, fail, clearNotice } = env;

  const onSelect: ToolClick = ({ node, edge, building, shift }) => {
    const hit = node?.id ?? edge?.id ?? building?.id ?? null;
    patchUi((u) => ({ selection: nextSelection(u.selection, hit, shift), ...(hit ? { panelTab: 'properties' as const } : {}) }));
    clearNotice();
  };

  const onSelectBuilding: ToolClick = ({ position }) => {
    const b = buildingAt(state, position);
    patchUi({ selectedBuildingId: b?.id ?? null });
    if (b) clearNotice();
    else info('여기에는 건물이 없습니다. 건물 외곽선 안쪽을 눌러 주세요.');
  };

  /** The kind is the user's choice; WHERE it goes (outdoors or which floor) comes from the clicked place (SPEC-v0.2 5.2). */
  const onAddNode: ToolClick = ({ position, scope: clicked }) => {
    const kind = effectiveAddKind(ui);
    if (kind === 'outdoor' || kind === 'poi') {
      if (clicked.kind !== 'outdoor') return fail('바깥 지점은 건물 밖을 눌러 만드세요. (O 키를 누르고 있으면 건물 위라도 바깥으로 찍힙니다.)');
      if (kind === 'poi') return openDialog({ kind, position });
      perform(planOutdoorNode(state, ctx, position));
      return;
    }
    if (clicked.kind !== 'building') return fail(NEED_FLOOR);
    if (kind === 'classroom' || kind === 'stairs') return openDialog({ kind, position, scope: clicked });
    if (perform(planIndoorNode(state, ctx, { buildingId: clicked.buildingId, level: clicked.level, kind, position })) === undefined) followScope(clicked);
  };

  /** Two-click tools: remember the first node, then build the edge on the second. */
  const pickPair = (make: (a: string, b: string) => PlanResult, next: string): ToolClick => ({ node }) => {
    if (!node) return info(ui.pickFrom ? next : '지점 가까이를 눌러 주세요.');
    if (!ui.pickFrom) {
      patchUi({ pickFrom: node.id });
      return info(`${node.id}을(를) 골랐습니다. ${next}`);
    }
    const plan = make(ui.pickFrom, node.id);
    patchUi({ pickFrom: null });
    perform(plan);
  };

  /**
   * 연결통로 and 에스컬레이터: the first click picks the start and opens the small window; the floor chosen there is shown;
   * the second click is a point on that floor, or an empty spot where a new point is made. One Plan, one Ctrl+Z.
   */
  const onCross = (tool: 'bridge' | 'escalator'): ToolClick => ({ position, node, scope: clicked }) => {
    if (!ui.pickFrom) {
      if (node) return pickCrossStart(tool, node);
      return info(tool === 'bridge' ? '시작할 지점(건물 안의 지점)을 눌러 주세요.' : '시작할 지점(아래쪽 지점)을 눌러 주세요.');
    }
    const from = state.nodes[ui.pickFrom];
    if (!from) return patchUi({ pickFrom: null });
    let end: CrossEnd;
    if (node) end = { nodeId: node.id };
    else if (!sameScope(clicked, ui.scope)) {
      // An empty spot makes a new point, and only on the floor being shown (or outdoors).
      return fail(ui.scope.kind === 'building' ? '새 지점은 지금 보이는 층의 건물 안쪽에 만들 수 있습니다. 건물 안쪽을 눌러 주세요.' : '바깥에 새 지점을 만들려면 건물 밖을 눌러 주세요.');
    } else end = clicked.kind === 'building' ? { position, buildingId: clicked.buildingId, level: clicked.level } : { position, buildingId: null, level: null };
    const plan = tool === 'bridge'
      ? planBridge(state, ctx, from.id, end, { covered: ui.crossPick.noRoof ? false : null })
      : planEscalator(state, ctx, from.id, end, ui.crossPick.mode);
    if (perform(plan) === undefined) patchUi({ pickFrom: null });
  };

  /** The first click: remember the node and show the floor the other end is most likely on (nearest other building / next floor). */
  const pickCrossStart = (tool: 'bridge' | 'escalator', node: EditNode) => {
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
    if (first) env.showFloor(first, true);
    const where = first ? `${scopeLabel(first, state)}을(를) 보여 드립니다. ` : '';
    info(`${node.id}을(를) 골랐습니다. ${where}창에서 고른 뒤 이어질 지점이나 빈자리를 눌러 주세요.`);
  };

  const onRestroom: ToolClick = ({ position, scope }) => (
    scope.kind === 'building' ? openDialog({ kind: 'restroom', position, scope }) : fail(NEED_FLOOR)
  );

  /** An existing elevator: edit its floors. Anywhere else on a floor: a new one. */
  const onElevator: ToolClick = ({ position, node, scope }) => {
    const elevatorId = node?.props.node_type === 'elevator_stop' ? node.props.elevator_id : undefined;
    if (elevatorId) return openDialog({ kind: 'elevator-edit', elevatorId });
    if (scope.kind !== 'building') return fail(NEED_FLOOR);
    openDialog({ kind: 'elevator', position, buildingId: scope.buildingId });
  };

  /** 호실 연속 입력: a front door per click, Shift+click for the back door of the room just placed. */
  const onDoor: ToolClick = ({ position, scope, shift: back }) => {
    const run = ui.doorRun;
    if (back && run.lastRef === null) return fail('뒷문은 앞문을 찍은 다음에 만들 수 있습니다. 먼저 앞문을 눌러 주세요.');
    const ref = back ? run.lastRef ?? '' : run.nextRef;
    if (perform(planDoor(state, ctx, { position, scope, ref, back })) !== undefined) return;
    followScope(scope);
    // The door the plan added, so F can turn it into the other one.
    const door = Object.values(env.currentState().nodes).find((n) => !(n.id in state.nodes) && n.props.node_type === 'door');
    patchUi({
      doorRun: back
        ? { ...run, lastDoorId: door?.id ?? run.lastDoorId }
        : { ...run, lastRef: ref.trim(), nextRef: nextRefAfter(ref.trim(), run.step), lastDoorId: door?.id ?? null },
    });
  };

  /** 강의실 자동 연결: corridor edges first (click again to take one out), then the first and the last door place. */
  const onStrip: ToolClick = ({ position, edge }) => {
    const stage = stripStage(strip);
    if (edge && (stage === 'corridor' || stage === 'first')) {
      if (edge.props.highway !== 'corridor' || edge.props.edge_type !== 'indoor') return fail('복도 구간(건물 안 복도)을 눌러 주세요.');
      setStrip((st) => ({ ...st, edgeIds: st.edgeIds.includes(edge.id) ? st.edgeIds.filter((id) => id !== edge.id) : [...st.edgeIds, edge.id] }));
      return clearNotice();
    }
    if (stage === 'corridor') return info('먼저 복도 구간을 눌러 주세요.');
    if (stage === 'first') return setStrip((st) => ({ ...st, first: position }));
    if (stage === 'last') return setStrip((st) => ({ ...st, last: position }));
  };

  return {
    select: onSelect,
    'select-building': onSelectBuilding,
    path: null,
    building: null,
    'osm-building': ({ position }) => env.importOsm(position),
    'add-node': onAddNode,
    // An edge between two points linked to other floors is made on those floors too (sync.ts).
    connect: pickPair((a, b) => withSyncMirror(state, ctx, planConnect(state, ctx, a, b)), '이을 다른 지점을 눌러 주세요.'),
    portal: pickPair((a, b) => planPortal(state, ctx, a, b), '이어질 바깥 지점을 눌러 주세요(흐리게 보이는 바깥 지점).'),
    bridge: onCross('bridge'),
    restroom: onRestroom,
    elevator: onElevator,
    escalator: onCross('escalator'),
    door: onDoor,
    strip: onStrip,
  };
}
