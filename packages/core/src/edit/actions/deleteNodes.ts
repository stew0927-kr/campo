import type { EdgeProperties, Position } from '../../types.ts';
import { bumpRev, defineAction, deletionWarnings, type Action, type EditContext } from '../action.ts';
import { lineLength } from '../geo.ts';
import { deepEqual, edgeCoords, edgesAt, type EditEdge, type EditState } from '../state.ts';
import { missing } from './common.ts';

export interface DeleteNodesOptions {
  /** Join the two edges through a deleted node into one when they match (default false). */
  heal?: boolean;
}

/** Edges that are never healed (same set that splitEdgeAt refuses). */
function unhealable(p: EdgeProperties): boolean {
  return p.highway === 'elevator' || p.edge_type === 'portal' || p.edge_type === 'bridge';
}

function comparable(p: EdgeProperties): Record<string, unknown> {
  const { from: _f, to: _t, rev: _r, step_count: _s, ...rest } = p;
  return rest;
}

export interface HealPlan {
  keep: string;
  drop: string;
  from: string;
  to: string;
  vertices: Position[];
  stepCount?: number;
}

/**
 * How deleting `nodeId` would join its two edges, or null when it would not.
 * Conditions: exactly two edges, equal apart from from / to / rev / step_count, a–n–b with a ≠ b, and
 * the same direction through n (a bidirectional edge without incline / conveying may be turned around).
 * The longer edge keeps its id; n's coordinate becomes a bend point; step counts add up.
 */
export function healPlan(state: EditState, nodeId: string): HealPlan | null {
  const at = edgesAt(state, nodeId);
  if (at.length !== 2) return null;
  const [e1, e2] = at as [EditEdge, EditEdge];
  for (const e of at) if (e.props.from === e.props.to || unhealable(e.props)) return null;
  if (!deepEqual(comparable(e1.props), comparable(e2.props))) return null;
  if ((e1.props.step_count === undefined) !== (e2.props.step_count === undefined)) return null;
  const other = (e: EditEdge) => (e.props.from === nodeId ? e.props.to : e.props.from);
  if (other(e1) === other(e2)) return null;

  const turnable = e1.props.bidirectional && e1.props.incline === undefined && e1.props.conveying === undefined;
  const enters = (e: EditEdge) => e.props.to === nodeId;
  // first: the edge walked into n, second: the edge walked out of n
  let first: EditEdge;
  let second: EditEdge;
  if (enters(e1) && !enters(e2)) [first, second] = [e1, e2];
  else if (enters(e2) && !enters(e1)) [first, second] = [e2, e1];
  else if (turnable) [first, second] = [e1, e2];
  else return null;

  const c1 = edgeCoords(state, first);
  const c2 = edgeCoords(state, second);
  const into = enters(first) ? c1 : [...c1].reverse();
  const outOf = enters(second) ? [...c2].reverse() : c2;
  let path = [...into, ...outOf.slice(1)];
  let ends = [other(first), other(second)];

  const l1 = lineLength(c1);
  const l2 = lineLength(c2);
  const keep = l2 > l1 ? second : first;
  const drop = keep === first ? second : first;
  // The kept edge keeps its drawn direction.
  const keepForward = keep === first ? enters(first) : !enters(second);
  if (!keepForward) {
    path = path.reverse();
    ends = [ends[1]!, ends[0]!];
  }
  const plan: HealPlan = { keep: keep.id, drop: drop.id, from: ends[0]!, to: ends[1]!, vertices: path.slice(1, -1) };
  if (e1.props.step_count !== undefined && e2.props.step_count !== undefined) plan.stepCount = e1.props.step_count + e2.props.step_count;
  return plan;
}

/** Delete nodes and their edges. With heal, a node between two matching edges joins them instead (see healPlan). */
export function deleteNodes(ids: readonly string[], options: DeleteNodesOptions = {}, ctx?: EditContext): Action {
  const list = [...new Set(ids)];
  const action = defineAction({
    annotation: `지점 ${list.length}개 삭제`,
    disabled: (state) => missing('지점', list, (id) => id in state.nodes),
    recipe(draft) {
      for (const id of list) {
        if (!draft.nodes[id]) continue;
        const plan = options.heal ? healPlan(draft, id) : null;
        if (plan) {
          const kept = draft.edges[plan.keep]!;
          kept.props.from = plan.from;
          kept.props.to = plan.to;
          kept.vertices = plan.vertices;
          if (plan.stepCount !== undefined) kept.props.step_count = plan.stepCount;
          bumpRev(kept.props);
          delete draft.edges[plan.drop];
        } else {
          for (const e of edgesAt(draft, id)) delete draft.edges[e.id];
        }
        delete draft.nodes[id];
      }
    },
    warnings: (state) => deletionWarnings(action, ctx, state),
  });
  return action;
}
