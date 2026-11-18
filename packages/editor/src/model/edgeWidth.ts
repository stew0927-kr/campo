// 길 폭 (width_m, SPEC §4.2) in the editor: what the typed text means, which edges take a width, and the one-entry plan.
// Map data changes only through the core action setEdgeWidth.
import { EDGE_WIDTH_MAX_M, EDGE_WIDTH_MIN_M, isValidEdgeWidth, setEdgeWidth, type EdgeProperties, type EditState } from '@campo/core';
import type { PlanResult } from './plan.ts';

/** Shown under the field when the typed width is not usable; nothing is saved. */
export const EDGE_WIDTH_RANGE_MESSAGE = `${EDGE_WIDTH_MIN_M} m 이상 ${EDGE_WIDTH_MAX_M} m 이하로 입력해 주세요.`;

/** Typed text → a width (m), null for an empty field (back to the default 2.0 m), or the range message. */
export function parseEdgeWidthInput(text: string): { width: number | null } | { error: string } {
  const t = text.trim();
  if (t === '') return { width: null };
  const v = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : Number.NaN;
  return isValidEdgeWidth(v) ? { width: v } : { error: EDGE_WIDTH_RANGE_MESSAGE };
}

/** Indoor edges and elevators have no width field: the height solver only flattens outdoor ways. */
export function edgeWidthApplies(p: Pick<EdgeProperties, 'highway' | 'edge_type'>): boolean {
  return p.edge_type !== 'indoor' && p.highway !== 'elevator';
}

/** The selected ids that are edges taking a width, in selection order. */
export function widthTargets(state: EditState, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const e = state.edges[id];
    return e !== undefined && edgeWidthApplies(e.props);
  });
}

/** Set (or with null, clear) the width of every given edge: one setEdgeWidth, one history entry. */
export function planEdgeWidth(state: EditState, ids: readonly string[], width: number | null): PlanResult {
  const targets = widthTargets(state, ids);
  if (targets.length === 0) return { error: '폭을 바꿀 바깥 길을 골라 주세요.' };
  const action = setEdgeWidth(targets, width);
  const reason = action.disabled(state);
  if (reason) return { error: reason };
  const annotation = width === null ? '길 폭 기본값으로' : targets.length === 1 ? '길 폭 바꾸기' : `길 폭 ${targets.length}개 바꾸기`;
  return { annotation, steps: [() => setEdgeWidth(targets, width)] };
}
