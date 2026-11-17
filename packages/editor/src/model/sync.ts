// 층 연동: points copied to other floors of one building share a sync_group (copy.ts). While they do, a flat edge added
// or deleted between two such points on one floor is added or deleted between their counterparts on the other floors too,
// in the same Plan (one Ctrl+Z). "층 연동 취소" takes a point out of its group.
// Nothing here compares floor numbers to decide what connects: a counterpart is a point of the same building with the
// same sync_group that stands on another floor.
import { addEdge, deleteEdges, setProps, type Action, type EditContext, type EditEdge, type EditNode, type EditState } from '@campo/core';
import { classify } from './ops.ts';
import type { Plan, PlanResult, Step } from './plan.ts';
import type { EdgeProps } from './tools.ts';

/** An edge inside one floor of one building, the kind 잇기 and 길 그리기 make: no stairs, ride, belt, portal or bridge. */
export function isFlatIndoor(state: EditState, e: EditEdge): boolean {
  const p = e.props;
  if (p.edge_type !== 'indoor' || p.conveying !== undefined || (p.highway !== 'corridor' && p.highway !== 'ramp')) return false;
  const [a, b] = [state.nodes[p.from], state.nodes[p.to]];
  return a !== undefined && b !== undefined && a.props.building_id !== null && a.props.building_id === b.props.building_id && a.props.level === b.props.level;
}

/** The points of the node's sync group on the other floors of its building, by level. Empty without a group. */
export function counterparts(state: EditState, node: EditNode): Map<number, EditNode> {
  const out = new Map<number, EditNode>();
  const { sync_group: group, building_id, level } = node.props;
  if (group === undefined || building_id === null) return out;
  for (const n of Object.values(state.nodes)) {
    if (n.props.sync_group !== group || n.props.building_id !== building_id || n.props.level === level || n.props.level === null) continue;
    if (!out.has(n.props.level)) out.set(n.props.level, n);
  }
  return out;
}

const between = (state: EditState, a: string, b: string): EditEdge[] =>
  Object.values(state.edges).filter((e) => (e.props.from === a && e.props.to === b) || (e.props.from === b && e.props.to === a));

/** The pairs (A', B') of the other floors that mirror an edge between A and B: both ends synced, both counterparts on one floor. */
function mirrorPairs(state: EditState, fromId: string, toId: string): { level: number; from: EditNode; to: EditNode }[] {
  const [a, b] = [state.nodes[fromId], state.nodes[toId]];
  if (!a || !b) return [];
  const [as, bs] = [counterparts(state, a), counterparts(state, b)];
  return [...as].flatMap(([level, from]) => {
    const to = bs.get(level);
    return to ? [{ level, from, to }] : [];
  }).sort((x, y) => x.level - y.level);
}

export interface SyncMirror {
  added: number;
  removed: number;
}

/**
 * `plan` with the edges it adds or deletes between synced points repeated on the other floors. The plan is run here on
 * `state` to see what it changes; the same action objects go into the result (an action keeps the ids it drew), followed by
 * the mirrored additions and deletions. An edge the other floor already has is not made twice. Deletions are mirrored only
 * for `deletedEdges`, the edges the person asked to delete: an edge that went because one of its points was deleted is
 * not (the counterparts on the other floors are still there, and so is their edge).
 * Returns `plan` itself when there is nothing to mirror or the plan cannot run.
 */
export function withSyncMirror(state: EditState, ctx: EditContext, plan: PlanResult, deletedEdges: readonly string[] = []): PlanResult {
  if ('error' in plan) return plan;
  if (!Object.values(state.nodes).some((n) => n.props.sync_group !== undefined)) return plan;
  let s = state;
  const ran: Action[] = [];
  for (const step of plan.steps) {
    const action = step(s);
    if (!action) continue;
    if (action.disabled(s) !== false) return plan; // the plan fails as it would have without the mirror
    ran.push(action);
    s = action.apply(s);
  }
  const after = s;
  const mirror: Action[] = [];
  const count: SyncMirror = { added: 0, removed: 0 };
  const perform = (action: Action) => {
    if (action.disabled(s) !== false) return false;
    s = action.apply(s);
    mirror.push(action);
    return true;
  };

  for (const e of Object.values(after.edges)) {
    if (e.id in state.edges || !isFlatIndoor(after, e)) continue;
    for (const pair of mirrorPairs(after, e.props.from, e.props.to)) {
      if (between(s, pair.from.id, pair.to.id).length > 0) continue;
      const { rev: _rev, ...rest } = e.props;
      const props: EdgeProps = {
        ...rest, from: pair.from.id, to: pair.to.id,
        ...(rest.level_from !== undefined ? { level_from: pair.level } : {}),
        ...(rest.level_to !== undefined ? { level_to: pair.level } : {}),
      };
      if (perform(addEdge({ props }, ctx))) count.added++;
    }
  }
  for (const id of deletedEdges) {
    const e = state.edges[id];
    if (!e || id in after.edges || !isFlatIndoor(state, e)) continue;
    // The pairs as they were before: deleting a corridor's last edge takes its end point along.
    for (const pair of mirrorPairs(state, e.props.from, e.props.to)) {
      const twins = between(s, pair.from.id, pair.to.id).filter((x) => isFlatIndoor(s, x) && x.props.highway === e.props.highway);
      if (twins.length > 0 && perform(deleteEdges(twins.map((x) => x.id), ctx))) count.removed += twins.length;
    }
  }
  if (mirror.length === 0) return plan;
  const notices = [
    ...(plan.notices ?? []),
    ...(count.added > 0 ? [`연동된 다른 층에도 구간 ${count.added}개를 만들었습니다.`] : []),
    ...(count.removed > 0 ? [`연동된 다른 층의 구간 ${count.removed}개도 지웠습니다.`] : []),
  ];
  return { annotation: plan.annotation, steps: [...ran, ...mirror].map((a): Step => () => a), notices };
}

/** The selected points that belong to a sync group. */
export function syncedIn(state: EditState, ids: readonly string[]): string[] {
  return classify(state, ids).nodes.filter((id) => state.nodes[id]!.props.sync_group !== undefined);
}

/** "층 연동 취소": the selected points leave their sync group and are independent again. The other floors keep theirs. */
export function planUnsync(state: EditState, ids: readonly string[]): PlanResult {
  const nodes = syncedIn(state, ids);
  if (nodes.length === 0) return { error: '층 연동된 지점이 아닙니다.' };
  const plan: Plan = {
    annotation: nodes.length === 1 ? '층 연동 취소' : `지점 ${nodes.length}개 층 연동 취소`,
    steps: [() => setProps(nodes, { sync_group: undefined })],
    notices: ['이 층의 지점만 연동에서 뺐습니다. 다른 층의 지점은 그대로 연동되어 있습니다.'],
  };
  return plan;
}
