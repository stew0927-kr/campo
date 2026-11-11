import type { Position } from '../../types.ts';
import { bumpRev, defineAction, type Action } from '../action.ts';
import { copy, isPosition, sortedValues, type EditNode, type EditState } from '../state.ts';

/** The node and, for an elevator stop, every stop of the same elevator_id (one shaft moves together, SPEC-v0.2 2.2). */
export function movedTogether(state: EditState, id: string): EditNode[] {
  const node = state.nodes[id];
  if (!node) return [];
  const eid = node.props.elevator_id;
  if (node.props.node_type !== 'elevator_stop' || eid === undefined) return [node];
  return sortedValues(state.nodes).filter((n) => n.props.node_type === 'elevator_stop' && n.props.elevator_id === eid);
}

/**
 * Move a node. The edges follow by construction; they still get rev+1 because their saved end coordinates change (SPEC-v0.2 7.1).
 * An elevator stop moves every stop of its elevator_id to the same coordinate.
 */
export function moveNode(id: string, coord: Position): Action {
  return defineAction({
    annotation: '지점 이동',
    disabled(state) {
      if (!state.nodes[id]) return `지점 "${id}"이(가) 없습니다.`;
      if (!isPosition(coord)) return '좌표가 [경도, 위도] 숫자 쌍이 아닙니다.';
      return false;
    },
    recipe(draft) {
      const moved = new Set(movedTogether(draft, id).map((n) => n.id));
      for (const nid of moved) {
        const node = draft.nodes[nid]!;
        node.coord = copy(coord);
        bumpRev(node.props);
      }
      for (const edge of Object.values(draft.edges)) {
        if (moved.has(edge.props.from) || moved.has(edge.props.to)) bumpRev(edge.props);
      }
    },
  });
}
