// The right-click menu (SPEC-v0.2 5.1 작업): what it can edit at once on the selection, and the Plan that does it (setProps).
import { setProps, type EditEdge, type EditState } from '@campo/core';
import { classify } from './ops.ts';
import { kindChangeExtras } from './elevation.ts';
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
  /** 계단으로 바꾸기 / 일반 길로 바꾸기: null when no edge is selected, else the one switch item the menu offers. */
  stairs: StairsSwitch | null;
}

export type StairsTarget = 'steps' | 'footway';

export interface StairsSwitch {
  /** What the item turns the edges into: steps, or a plain footway when every selected edge already is steps. */
  to: StairsTarget;
  label: string;
  /** Why the item cannot be used (shown as the tooltip and under the item), or false. */
  blocked: string | false;
}

export const STAIRS_LABEL: Record<StairsTarget, string> = { steps: '계단으로 바꾸기', footway: '일반 길로 바꾸기' };

const STAIRS_REASON = {
  mixed: '구간만 골랐을 때 바꿀 수 있습니다. 지점, 방, 건물, 평지는 빼고 골라 주세요.',
  portal: '출입구 연결(portal)은 평지 길만 될 수 있어 바꿀 수 없습니다.',
  indoorLike: '건물 안, 연결통로, 엘리베이터, 에스컬레이터 구간은 바꿀 수 없습니다. 같은 층 안의 계단 구간은 만들지 않습니다.',
  unchanged: '이미 그 상태입니다.',
} as const;

/** The reason these edges cannot be switched between a plain way and steps, or false. Only outdoor footway / ramp / steps can. */
function stairsBlocked(edges: readonly EditEdge[]): string | false {
  if (edges.some((e) => e.props.edge_type === 'portal')) return STAIRS_REASON.portal;
  const outdoorWay = (e: EditEdge) => e.props.edge_type === 'outdoor' && e.props.conveying === undefined && ['footway', 'steps', 'ramp'].includes(e.props.highway);
  if (!edges.every(outdoorWay)) return STAIRS_REASON.indoorLike;
  return false;
}

const stairsTargetOf = (edges: readonly EditEdge[]): StairsTarget => (edges.every((e) => e.props.highway === 'steps') ? 'footway' : 'steps');

const same = <T,>(list: T[]): T | null => (list.length > 0 && list.every((v) => v === list[0]) ? list[0]! : null);

/** What the menu can edit for these ids: points and edges only, and only the fields that make sense for all of them. */
export function menuFields(state: EditState, ids: readonly string[]): MenuFields {
  const sel = classify(state, ids);
  const nodes = sel.nodes.map((id) => state.nodes[id]!);
  const edges = sel.edges.map((id) => state.edges[id]!);
  const pure = sel.rooms.length === 0 && sel.buildings.length === 0 && sel.plazas.length === 0;
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
    stairs: edges.length === 0 ? null : stairsSwitch(edges, pure && nodes.length === 0),
  };
}

function stairsSwitch(edges: readonly EditEdge[], edgesOnly: boolean): StairsSwitch {
  const to = stairsTargetOf(edges);
  return { to, label: STAIRS_LABEL[to], blocked: edgesOnly ? stairsBlocked(edges) : STAIRS_REASON.mixed };
}

export interface MenuEdits {
  /** 계단으로 바꾸기 ('steps') or 일반 길로 바꾸기 ('footway'). */
  stairs?: StairsTarget;
  kind?: string;
  /** Empty text removes the name. */
  name?: string;
  step_free?: boolean | null;
}

/** setProps for the menu's fields on every selected node / edge, as one Plan. */
export function planMenuEdit(state: EditState, ids: readonly string[], edits: MenuEdits): PlanResult {
  const f = menuFields(state, ids);
  const sel = classify(state, ids);
  if (edits.stairs !== undefined) return planStairsSwitch(state, f, sel.edges, edits.stairs);
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
  if (sel.edges.length > 0 && Object.keys(edgePatch).length > 0) {
    // A footway turned into steps (or anything else) is no longer "checked level": flat_exact goes with it, and
    // is_breakline where the new kind cannot have one (ELEVATION_INTEGRATION.md 3장). Same entry, one Ctrl+Z.
    const extras = edits.kind === undefined ? [] : sel.edges.flatMap((id) => {
      const extra = kindChangeExtras(state.edges[id]!.props, edits.kind!);
      return Object.keys(extra).length > 0 ? [{ id, extra }] : [];
    });
    const plain = sel.edges.filter((id) => !extras.some((x) => x.id === id));
    if (plain.length > 0) steps.push(() => setProps(plain, edgePatch));
    for (const { id, extra } of extras) steps.push(() => setProps([id], { ...edgePatch, ...extra }));
  }
  if (steps.length === 0) return { error: '바꿀 속성이 없습니다.' };
  const what = edits.kind !== undefined ? '종류' : edits.name !== undefined ? '이름' : 'step_free';
  return { annotation: `${what} 바꾸기`, steps };
}

/**
 * Every selected edge to steps (step_free false, flat_exact removed) or to a plain footway (step_free null, incline removed).
 * is_breakline stays: the schema allows it on both. Edges already in the target state are left alone. One Plan: one Ctrl+Z.
 */
function planStairsSwitch(state: EditState, f: MenuFields, edgeIds: readonly string[], to: StairsTarget): PlanResult {
  if (!f.stairs) return { error: '구간을 골라 주세요.' };
  if (f.stairs.blocked) return { error: f.stairs.blocked };
  const changing = edgeIds.filter((id) => state.edges[id]!.props.highway !== to);
  if (changing.length === 0) return { error: STAIRS_REASON.unchanged };
  const steps: Array<() => ReturnType<typeof setProps>> = [];
  const plain: string[] = [];
  for (const id of changing) {
    const p = state.edges[id]!.props;
    const extra: Record<string, undefined> = { ...kindChangeExtras(p, to), ...(to === 'footway' && p.incline !== undefined ? { incline: undefined } : {}) };
    if (Object.keys(extra).length === 0) plain.push(id);
    else steps.push(() => setProps([id], { highway: to, step_free: to === 'steps' ? false : null, ...extra }));
  }
  if (plain.length > 0) steps.unshift(() => setProps(plain, { highway: to, step_free: to === 'steps' ? false : null }));
  return { annotation: to === 'steps' ? '계단으로 바꾸기' : '일반 길로 바꾸기', steps };
}

/** "지점 5개, 구간 4개" for the menu's heading and the copy window. */
export function selectionSummary(state: EditState, ids: readonly string[]): string {
  const sel = classify(state, ids);
  const parts: string[] = [];
  if (sel.nodes.length > 0) parts.push(`지점 ${sel.nodes.length}개`);
  if (sel.edges.length > 0) parts.push(`구간 ${sel.edges.length}개`);
  if (sel.rooms.length > 0) parts.push(`강의실 영역 ${sel.rooms.length}개`);
  if (sel.buildings.length > 0) parts.push(`건물 ${sel.buildings.length}개`);
  if (sel.plazas.length > 0) parts.push(`평지 ${sel.plazas.length}개`);
  return parts.join(', ');
}
