// The right-click menu (SPEC-v0.2 5.1 작업): what it can edit at once on the selection, and the Plan that does it (setProps).
import { setProps, type EditState } from '@campo/core';
import { classify } from './ops.ts';
import type { PlanResult } from './plan.ts';

export interface Option {
  value: string;
  label: string;
}

/** Node types a menu may switch between. Elevator stops, landings and restrooms carry their own data and are edited elsewhere. */
const INDOOR_NODE: Option[] = [
  { value: 'corridor', label: '복도 지점' },
  { value: 'door', label: '문' },
  { value: 'entrance', label: '출입구' },
];
const OUTDOOR_NODE: Option[] = [
  { value: 'outdoor', label: '바깥 지점' },
  { value: 'poi', label: '출발·도착 후보' },
];
const INDOOR_EDGE: Option[] = [
  { value: 'corridor', label: '복도' },
  { value: 'ramp', label: '경사로' },
];
const OUTDOOR_EDGE: Option[] = [
  { value: 'footway', label: '평지 길' },
  { value: 'ramp', label: '경사로' },
];

export interface MenuFields {
  /** Selected nodes / edges. */
  nodes: number;
  edges: number;
  /** The kind (node_type or highway) the whole selection can be switched between, or null. */
  kinds: Option[] | null;
  /** Current kind when all selected have the same one, else null. */
  kind: string | null;
  /** 이름 can be typed (every selected Feature is a node). */
  name: boolean;
  /** Current name when all selected nodes share it, else null (mixed). */
  nameValue: string | null;
  /** step_free can be set (every selected Feature is an edge). */
  stepFree: boolean;
  /** 'true' / 'false' / 'null' when all selected edges share it, else null. */
  stepFreeValue: string | null;
}

const same = <T,>(list: T[]): T | null => (list.length > 0 && list.every((v) => v === list[0]) ? list[0]! : null);

/** What the menu can edit for these ids: points and edges only, and only the fields that make sense for all of them. */
export function menuFields(state: EditState, ids: readonly string[]): MenuFields {
  const sel = classify(state, ids);
  const nodes = sel.nodes.map((id) => state.nodes[id]!);
  const edges = sel.edges.map((id) => state.edges[id]!);
  const pure = sel.rooms.length === 0 && sel.buildings.length === 0;
  let kinds: Option[] | null = null;
  if (pure && nodes.length > 0 && edges.length === 0) {
    const indoor = nodes.every((n) => n.props.building_id !== null);
    const outdoor = nodes.every((n) => n.props.building_id === null);
    const list = indoor ? INDOOR_NODE : outdoor ? OUTDOOR_NODE : null;
    if (list && nodes.every((n) => list.some((o) => o.value === n.props.node_type))) kinds = list;
  } else if (pure && edges.length > 0 && nodes.length === 0) {
    const plain = edges.every((e) => e.props.conveying === undefined && (e.props.edge_type === 'indoor' || e.props.edge_type === 'outdoor'));
    const type = same(edges.map((e) => e.props.edge_type));
    if (plain && type !== null) {
      const list = type === 'indoor' ? INDOOR_EDGE : OUTDOOR_EDGE;
      if (edges.every((e) => list.some((o) => o.value === e.props.highway))) kinds = list;
    }
  }
  return {
    nodes: nodes.length,
    edges: edges.length,
    kinds,
    kind: nodes.length > 0 && edges.length === 0 ? same(nodes.map((n) => n.props.node_type)) : edges.length > 0 && nodes.length === 0 ? same(edges.map((e) => e.props.highway)) : null,
    name: pure && nodes.length > 0 && edges.length === 0,
    nameValue: nodes.length > 0 ? same(nodes.map((n) => n.props.name ?? '')) : null,
    stepFree: pure && edges.length > 0 && nodes.length === 0,
    stepFreeValue: edges.length > 0 ? same(edges.map((e) => String(e.props.step_free))) : null,
  };
}

export interface MenuEdits {
  kind?: string;
  /** Empty text removes the name. */
  name?: string;
  step_free?: boolean | null;
}

/** setProps for the menu's fields on every selected node / edge, as one Plan. */
export function planMenuEdit(state: EditState, ids: readonly string[], edits: MenuEdits): PlanResult {
  const f = menuFields(state, ids);
  const sel = classify(state, ids);
  const nodePatch: Record<string, unknown> = {};
  const edgePatch: Record<string, unknown> = {};
  if (edits.kind !== undefined) {
    if (!f.kinds?.some((o) => o.value === edits.kind)) return { error: '이 선택의 종류는 여기서 바꿀 수 없습니다.' };
    if (sel.nodes.length > 0) nodePatch['node_type'] = edits.kind;
    else edgePatch['highway'] = edits.kind;
  }
  if (edits.name !== undefined) {
    if (!f.name) return { error: '이름은 지점만 바꿀 수 있습니다.' };
    nodePatch['name'] = edits.name.trim() === '' ? undefined : edits.name.trim();
  }
  if (edits.step_free !== undefined) {
    if (!f.stepFree) return { error: 'step_free는 구간만 바꿀 수 있습니다.' };
    edgePatch['step_free'] = edits.step_free;
  }
  const steps: Array<() => ReturnType<typeof setProps>> = [];
  if (sel.nodes.length > 0 && Object.keys(nodePatch).length > 0) steps.push(() => setProps(sel.nodes, nodePatch));
  if (sel.edges.length > 0 && Object.keys(edgePatch).length > 0) steps.push(() => setProps(sel.edges, edgePatch));
  if (steps.length === 0) return { error: '바꿀 속성이 없습니다.' };
  const what = edits.kind !== undefined ? '종류' : edits.name !== undefined ? '이름' : 'step_free';
  return { annotation: `${what} 바꾸기`, steps };
}

/** "지점 5개, 구간 4개" for the menu's heading and the copy window. */
export function selectionSummary(state: EditState, ids: readonly string[]): string {
  const sel = classify(state, ids);
  const parts: string[] = [];
  if (sel.nodes.length > 0) parts.push(`지점 ${sel.nodes.length}개`);
  if (sel.edges.length > 0) parts.push(`구간 ${sel.edges.length}개`);
  if (sel.rooms.length > 0) parts.push(`강의실 영역 ${sel.rooms.length}개`);
  if (sel.buildings.length > 0) parts.push(`건물 ${sel.buildings.length}개`);
  return parts.join(', ');
}
