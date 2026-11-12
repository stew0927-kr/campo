// densifyCorridor (SPEC-v0.2 6.2): extra nodes along a corridor (photo guide points, long-corridor midpoints).
// Not needed for routing (attachDoor makes nodes only where doors join), so nothing calls it by default.
import type { Position } from '../../types.ts';
import type { EditContext } from '../action.ts';
import { splitEdgeAt } from '../actions/splitEdgeAt.ts';
import { footOnLine } from '../geo.ts';
import { edgeCoords, type EditState } from '../state.ts';
import { addedKeys, defineMacro, resultOf, type MacroAction, type MacroResult, type Runner } from './compose.ts';
import { chainOf } from './corridor.ts';
import { pointAlong } from './geo.ts';
import { SNAP_VERTEX_M } from '../tolerances.ts';

/** Either a spacing in metres or a number of nodes spread evenly. */
export type DensifyOptions = { interval: number; count?: never } | { count: number; interval?: never };

export interface DensifyResult {
  /** New corridor nodes, start to end of the line. */
  nodeIds: string[];
}

/** Distances along a line of `length` metres where nodes go, before skipping the ones too close to existing nodes. */
export function densifyTargets(length: number, opts: DensifyOptions): number[] | string {
  const out: number[] = [];
  if (opts.interval !== undefined) {
    if (!(opts.interval > SNAP_VERTEX_M)) return `간격(interval)은 ${SNAP_VERTEX_M}m보다 커야 합니다.`;
    for (let d = opts.interval; d < length; d += opts.interval) out.push(d);
  } else {
    const n = opts.count;
    if (!Number.isInteger(n) || n < 1) return '개수(count)는 1 이상의 정수여야 합니다.';
    if (length / (n + 1) <= SNAP_VERTEX_M) return `복도가 짧아 ${n}개를 ${SNAP_VERTEX_M}m보다 넓은 간격으로 넣을 수 없습니다.`;
    for (let i = 1; i <= n; i++) out.push((length * i) / (n + 1));
  }
  return out;
}

export function densifyCorridorAction(edgeIds: readonly string[], opts: DensifyOptions, ctx: EditContext): MacroAction<DensifyResult> {
  return defineMacro<DensifyResult>((res) => `복도에 지점 ${res.nodeIds.length}개 넣기`, ctx, (r: Runner) => {
    const chain = chainOf(r.state, edgeIds);
    if (typeof chain === 'string') r.fail(chain);
    const targets = densifyTargets(chain.length, opts);
    if (typeof targets === 'string') r.fail(targets);
    const points: Position[] = targets
      .filter((d) => chain.nodeDistances.every((n) => Math.abs(n - d) > SNAP_VERTEX_M))
      .map((d) => pointAlong(chain.coords, d));
    if (points.length === 0) r.fail('넣을 지점이 없습니다. 복도가 간격보다 짧거나 그 자리에 이미 지점이 있습니다.');

    const pieces = new Set(chain.edgeIds);
    const nodeIds: string[] = [];
    for (const p of points) {
      let best: { id: string; d: number } | undefined;
      for (const id of [...pieces].sort()) {
        const d = footOnLine(edgeCoords(r.state, r.state.edges[id]!), p).pointDistance;
        if (!best || d < best.d) best = { id, d };
      }
      const before = r.state;
      r.step(`split ${best!.id} ${p.join(',')}`, () => splitEdgeAt(best!.id, p, {}, ctx));
      nodeIds.push(...addedKeys(before, r.state, 'nodes'));
      for (const e of addedKeys(before, r.state, 'edges')) pieces.add(e);
    }
    return { nodeIds };
  });
}

/** Put nodes along a chain of corridor edges, every `interval` metres or `count` evenly (SPEC-v0.2 6.2). */
export function densifyCorridor(state: EditState, edgeIds: readonly string[], opts: DensifyOptions, ctx: EditContext): MacroResult<DensifyResult> {
  return resultOf(state, densifyCorridorAction(edgeIds, opts, ctx));
}
