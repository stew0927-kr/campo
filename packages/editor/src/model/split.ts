// Splitting an edge: the X key and the handle in the middle of a selected edge (SPEC-v0.2 5.1, 5.3).
import { edgeCoords, splitEdgeAt, type EditContext, type EditState, type Position } from '@campo/core';
import { classify } from './ops.ts';
import type { PlanResult } from './plan.ts';

/** The point half way along the edge's line (lng/lat scaled to a local metric frame). */
export function edgeMidpoint(state: EditState, edgeId: string): Position | undefined {
  const edge = state.edges[edgeId];
  if (!edge || !state.nodes[edge.props.from] || !state.nodes[edge.props.to]) return undefined;
  const coords = edgeCoords(state, edge);
  const kx = Math.cos((coords[0]![1] * Math.PI) / 180);
  const len = (a: Position, b: Position) => Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]);
  let total = 0;
  for (let i = 0; i + 1 < coords.length; i++) total += len(coords[i]!, coords[i + 1]!);
  let left = total / 2;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [a, b] = [coords[i]!, coords[i + 1]!];
    const l = len(a, b);
    if (left <= l && l > 0) {
      const t = left / l;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    left -= l;
  }
  return undefined;
}

/** X: every selected edge is cut in two at its middle. */
export function planSplit(state: EditState, ctx: EditContext, ids: readonly string[]): PlanResult {
  const edges = classify(state, ids).edges;
  if (edges.length === 0) return { error: '나눌 구간을 먼저 골라 주세요.' };
  const steps = edges.map((id) => {
    const mid = edgeMidpoint(state, id)!;
    return () => splitEdgeAt(id, mid, {}, ctx);
  });
  return { annotation: edges.length === 1 ? '구간 나누기' : `구간 ${edges.length}개 나누기`, steps };
}
