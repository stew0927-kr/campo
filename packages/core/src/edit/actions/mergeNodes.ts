// The approach (no code copied) follows iD's actionConnect (modules/actions/connect.js):
// the last node of the list survives (the drop target of a drag) unless another node is "interesting".
import { produce } from 'immer';
import type { NodeType } from '../../types.ts';
import { bumpRev, defineAction, deletionWarnings, type Action, type EditContext } from '../action.ts';
import { newViolations } from '../invariants.ts';
import { clone, scopeOfNode, type EditState } from '../state.ts';
import { missing } from './common.ts';

/** Node types that carry meaning of their own. At most one of them may take part in a merge. */
export const IMPORTANT_NODE_TYPES: readonly NodeType[] = ['entrance', 'door', 'elevator_stop', 'restroom', 'poi'];

/** Properties never copied from a merged-away node. */
const KEEP_OWN = new Set(['kind', 'node_type', 'building_id', 'level', 'rev']);

/** The node that stays: the one important node, otherwise the last id. */
export function mergeSurvivor(state: EditState, ids: readonly string[]): string {
  const important = ids.filter((id) => IMPORTANT_NODE_TYPES.includes(state.nodes[id]!.props.node_type));
  return important[0] ?? ids[ids.length - 1]!;
}

/**
 * Merge nodes into one (iD actionConnect). Empty properties of the survivor are filled from the others,
 * their edges are moved onto the survivor, and edges that would run from the survivor to itself are deleted.
 * Disabled across scopes (another level is another scope) or with two or more important nodes.
 */
export function mergeNodes(ids: readonly string[], ctx?: EditContext): Action {
  const list = [...new Set(ids)];
  const recipe = (draft: EditState) => {
    const keep = mergeSurvivor(draft, list);
    const gone = new Set(list.filter((id) => id !== keep));
    const survivor = draft.nodes[keep]!;
    const props = survivor.props as unknown as Record<string, unknown>;
    for (const id of list) {
      if (!gone.has(id)) continue;
      for (const [k, v] of Object.entries(draft.nodes[id]!.props)) {
        if (!KEEP_OWN.has(k) && props[k] === undefined && v !== undefined) props[k] = clone(v);
      }
    }
    for (const edge of Object.values(draft.edges)) {
      const p = edge.props;
      const from = gone.has(p.from) ? keep : p.from;
      const to = gone.has(p.to) ? keep : p.to;
      if (from === p.from && to === p.to) continue;
      if (from === to) {
        delete draft.edges[edge.id];
        continue;
      }
      p.from = from;
      p.to = to;
      bumpRev(p);
    }
    for (const id of gone) delete draft.nodes[id];
    bumpRev(survivor.props);
  };

  const action = defineAction({
    annotation: `지점 ${list.length}개 합치기`,
    disabled(state) {
      if (list.length < 2) return '합칠 지점을 두 개 이상 골라 주세요.';
      const gone = missing('지점', list, (id) => id in state.nodes);
      if (gone) return gone;
      const scopes = new Set(list.map((id) => scopeOfNode(state.nodes[id]!)));
      if (scopes.size > 1) return `범위(바깥, 건물+층)가 다른 지점은 합칠 수 없습니다: ${[...scopes].sort().join(', ')}`;
      const important = list.filter((id) => IMPORTANT_NODE_TYPES.includes(state.nodes[id]!.props.node_type));
      if (important.length > 1) return `출입구·문·엘리베이터 정차·화장실·강의실 지점이 둘 이상이라 합칠 수 없습니다: ${important.join(', ')}`;
      const broken = newViolations(state, produce(state, recipe), ['I4', 'I5']);
      if (broken.length > 0) return `합치면 불변식이 깨집니다: ${broken.map((v) => v.message).join(' ')}`;
      return false;
    },
    recipe,
    warnings(state) {
      if (action.disabled(state) !== false) return [];
      const keep = mergeSurvivor(state, list);
      return deletionWarnings(action, ctx, state, (id) => (list.includes(id) && id !== keep ? keep : undefined));
    },
  });
  return action;
}
