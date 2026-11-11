import type { NodeType } from '../../types.ts';
import { defineAction, deletionWarnings, type Action, type EditContext } from '../action.ts';
import type { EditState } from '../state.ts';
import { missing } from './common.ts';

/** Node types that are only there to carry edges. Doors, restrooms, rooms, entrances, stops and landings stay. */
export const DISPOSABLE_NODE_TYPES: readonly NodeType[] = ['corridor', 'outdoor'];

/** Delete nodes of a disposable type that no edge uses any more (draft or state). */
export function dropOrphans(draft: EditState, candidates: Iterable<string>): void {
  const used = new Set<string>();
  for (const e of Object.values(draft.edges)) {
    used.add(e.props.from);
    used.add(e.props.to);
  }
  for (const id of candidates) {
    const node = draft.nodes[id];
    if (node && !used.has(id) && DISPOSABLE_NODE_TYPES.includes(node.props.node_type)) delete draft.nodes[id];
  }
}

/** Delete edges. A corridor / outdoor node left with no edge goes too. */
export function deleteEdges(ids: readonly string[], ctx?: EditContext): Action {
  const list = [...new Set(ids)];
  const action = defineAction({
    annotation: `구간 ${list.length}개 삭제`,
    disabled: (state) => missing('구간', list, (id) => id in state.edges),
    recipe(draft) {
      const ends = new Set<string>();
      for (const id of list) {
        const edge = draft.edges[id]!;
        ends.add(edge.props.from);
        ends.add(edge.props.to);
        delete draft.edges[id];
      }
      dropOrphans(draft, [...ends].sort());
    },
    warnings: (state) => deletionWarnings(action, ctx, state),
  });
  return action;
}
