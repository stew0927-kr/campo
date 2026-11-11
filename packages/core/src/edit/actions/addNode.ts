import type { NodeProperties, Position } from '../../types.ts';
import { defineAction, idMemo, needIds, type Action, type EditContext } from '../action.ts';
import { freshId, nodeIdPrefix } from '../ids.ts';
import { elevatorGroups, stopsTogether } from '../invariants.ts';
import { copy, idTaken, isPosition } from '../state.ts';
import { scopeProblem, withRevOne, type NewProps } from './common.ts';

export interface NewNode {
  /** Omit to draw one from ctx.ids. */
  id?: string;
  coord: Position;
  props: NewProps<NodeProperties>;
}

/** Add a node (rev 1). Disabled for a taken id, a scope that does not exist, or an elevator stop away from its shaft (I5). */
export function addNode(input: NewNode, ctx?: EditContext): Action {
  if (input.id === undefined) needIds(ctx, 'addNode');
  const memo = idMemo();
  return defineAction({
    annotation: '지점 추가',
    disabled(state) {
      if (input.id !== undefined && idTaken(state, input.id)) return `이미 있는 id입니다: ${input.id}`;
      if (!isPosition(input.coord)) return '좌표가 [경도, 위도] 숫자 쌍이 아닙니다.';
      const scope = scopeProblem(state, input.props);
      if (scope) return scope;
      const p = input.props;
      if (p.node_type === 'elevator_stop' && p.elevator_id !== undefined) {
        const apart = (elevatorGroups(state).get(p.elevator_id) ?? []).filter((s) => !stopsTogether(s.coord, input.coord));
        if (apart.length > 0) return `elevator_id "${p.elevator_id}"의 다른 정차 지점(${apart.map((s) => s.id).join(', ')})과 자리가 다릅니다. 같은 승강로는 같은 자리여야 합니다.`;
      }
      return false;
    },
    recipe(draft) {
      const id = input.id ?? memo(0, draft, () => freshId(draft, ctx!.ids, nodeIdPrefix(draft, input.props)));
      draft.nodes[id] = { id, coord: copy(input.coord), props: withRevOne(input.props) };
    },
  });
}
