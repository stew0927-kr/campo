// Operations on the selection (SPEC-v0.2 5.3): delete, delete and heal, merge, property edits. Each builds a Plan of core actions.
import {
  FLIGHT_SEC_MAX,
  FLIGHT_SEC_MIN,
  buildingById,
  deleteBuilding,
  deleteEdges,
  deleteNodes,
  deleteRooms,
  mergeNodes,
  previewDeleteBuilding,
  setProps,
  type DeleteBuildingPreview,
  type EditContext,
  type EditState,
} from '@campo/core';
import type { Plan, PlanResult } from './plan.ts';
import type { AnyProps } from './session.ts';

export interface SelectionParts {
  nodes: string[];
  edges: string[];
  rooms: string[];
  /** Building codes. */
  buildings: string[];
}

/** Split selected ids by kind, in the order they were picked. Ids that are gone are dropped. */
export function classify(state: EditState, ids: readonly string[]): SelectionParts {
  const out: SelectionParts = { nodes: [], edges: [], rooms: [], buildings: [] };
  for (const id of ids) {
    if (id in state.nodes) out.nodes.push(id);
    else if (id in state.edges) out.edges.push(id);
    else if (id in state.rooms) out.rooms.push(id);
    else {
      const b = buildingById(state, id);
      if (b) out.buildings.push(b.props.code);
    }
  }
  return out;
}

export interface BuildingToDelete {
  code: string;
  name: string;
  preview: DeleteBuildingPreview;
}

export function buildingsToDelete(state: EditState, ids: readonly string[]): BuildingToDelete[] {
  return classify(state, ids).buildings.map((code) => ({ code, name: state.buildings[code]!.props.name, preview: previewDeleteBuilding(state, code) }));
}

/**
 * Delete the selection (Delete), or with `heal` (Shift+Delete) join the two edges of a node that has exactly two matching ones.
 * Buildings are included: the caller shows the confirmation dialog (buildingsToDelete) before running the plan.
 */
export function planDelete(state: EditState, ctx: EditContext, ids: readonly string[], heal: boolean): PlanResult {
  const sel = classify(state, ids);
  if (sel.nodes.length + sel.edges.length + sel.rooms.length + sel.buildings.length === 0) {
    return { error: '먼저 지울 지점이나 구간을 골라 주세요.' };
  }
  const parts: string[] = [];
  if (sel.nodes.length > 0) parts.push(`지점 ${sel.nodes.length}개 ${heal ? '이어 붙이며 삭제' : '삭제'}`);
  if (sel.edges.length > 0) parts.push(`구간 ${sel.edges.length}개 삭제`);
  if (sel.rooms.length > 0) parts.push(`강의실 영역 ${sel.rooms.length}개 삭제`);
  for (const code of sel.buildings) parts.push(`건물 ${code} 삭제`);

  const steps: Plan['steps'] = [];
  if (sel.nodes.length > 0) steps.push(() => deleteNodes(sel.nodes, { heal }, ctx));
  if (sel.edges.length > 0) {
    // Deleting nodes already removed the edges they carried.
    steps.push((s) => {
      const left = sel.edges.filter((id) => id in s.edges);
      return left.length > 0 ? deleteEdges(left, ctx) : null;
    });
  }
  if (sel.rooms.length > 0) steps.push(() => deleteRooms(sel.rooms, ctx));
  for (const code of sel.buildings) steps.push((s) => (s.buildings[code] ? deleteBuilding(code, ctx) : null));
  return { annotation: parts.join(', '), steps };
}

/** Merge the selected nodes (M). The last one picked stays unless another is an important kind (core decides). */
export function planMerge(state: EditState, ctx: EditContext, ids: readonly string[]): PlanResult {
  const nodes = classify(state, ids).nodes;
  if (nodes.length < 2) return { error: '합칠 지점을 두 개 이상 골라 주세요.' };
  return { annotation: `지점 ${nodes.length}개 합치기`, steps: [() => mergeNodes(nodes, ctx)] };
}

/** Fields the 속성 tab edits (SPEC §8). */
export interface CommonEdits {
  /** true: checked on site. false: steps or a sill. null: not known. */
  step_free?: boolean | null;
  /** Indoor steps edges: seconds to climb the flight (0-30). null puts it back to the default. */
  flight_sec?: number | null;
  needs_check?: boolean;
  source?: string;
}

/** The setProps patch for `edits` on a Feature with `props`, or null when nothing would change. */
export function propsPatch(props: AnyProps, edits: CommonEdits): Record<string, unknown> | null {
  const cur = props as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (edits.source !== undefined && edits.source !== props.source) patch['source'] = edits.source;
  if (edits.needs_check !== undefined && (edits.needs_check ? cur['needs_check'] !== true : cur['needs_check'] !== undefined)) {
    patch['needs_check'] = edits.needs_check ? true : undefined; // absent means false; keeps files short
  }
  if (props.kind === 'edge') {
    if (edits.step_free !== undefined && edits.step_free !== props.step_free) patch['step_free'] = edits.step_free;
    if (edits.flight_sec !== undefined && props.highway === 'steps' && props.edge_type === 'indoor') {
      const v = edits.flight_sec === null ? undefined : Math.min(FLIGHT_SEC_MAX, Math.max(FLIGHT_SEC_MIN, Math.round(edits.flight_sec)));
      if (v !== props.flight_sec) patch['flight_sec'] = v;
    }
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

export function planSetProps(state: EditState, id: string, patch: Record<string, unknown>): PlanResult {
  if (!(id in state.nodes) && !(id in state.edges) && !(id in state.rooms) && !buildingById(state, id)) {
    return { error: '속성을 바꿀 대상을 찾을 수 없습니다.' };
  }
  return { annotation: '속성 바꾸기', steps: [() => setProps([id], patch)] };
}

/** The selection after a click: a plain click selects one (nothing for empty ground), Shift adds or removes it. */
export function nextSelection(current: readonly string[], hit: string | null | undefined, shift: boolean): string[] {
  if (!hit) return shift ? [...current] : [];
  if (!shift) return [hit];
  return current.includes(hit) ? current.filter((id) => id !== hit) : [...current, hit];
}
