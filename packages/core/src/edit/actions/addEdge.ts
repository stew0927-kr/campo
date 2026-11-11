import type { EdgeProperties, Position } from '../../types.ts';
import { defineAction, idMemo, needIds, type Action, type EditContext } from '../action.ts';
import { edgeFileScope, edgeIdPrefix, freshId } from '../ids.ts';
import { copy, idTaken, isPosition, isScopeBound, scopeOfNode } from '../state.ts';
import { withRevOne, type NewProps } from './common.ts';

export interface NewEdge {
  /** Omit to draw one from ctx.ids. */
  id?: string;
  /** Bend points between from and to. Default none. */
  vertices?: Position[];
  props: NewProps<EdgeProperties>;
}

/** Add an edge (rev 1) between two existing nodes. A flat edge across scopes must be a portal or a bridge (I4). */
export function addEdge(input: NewEdge, ctx?: EditContext): Action {
  if (input.id === undefined) needIds(ctx, 'addEdge');
  const memo = idMemo();
  return defineAction({
    annotation: '구간 추가',
    disabled(state) {
      const { from, to } = input.props;
      if (input.id !== undefined && idTaken(state, input.id)) return `이미 있는 id입니다: ${input.id}`;
      const a = state.nodes[from];
      const b = state.nodes[to];
      if (!a) return `from 지점 "${from}"이(가) 없습니다.`;
      if (!b) return `to 지점 "${to}"이(가) 없습니다.`;
      if (from === to) return '구간의 양 끝이 같은 지점입니다.';
      if (!(input.vertices ?? []).every(isPosition)) return '꺾임점 좌표가 [경도, 위도] 숫자 쌍이 아닙니다.';
      if (isScopeBound(input.props) && scopeOfNode(a) !== scopeOfNode(b)) {
        return `평지 구간은 서로 다른 범위(${scopeOfNode(a)} → ${scopeOfNode(b)})를 이을 수 없습니다. 포탈이나 연결통로로 이어 주세요.`;
      }
      return false;
    },
    recipe(draft) {
      const id = input.id ?? memo(0, draft, () => {
        const scope = edgeFileScope(input.props.edge_type, draft.nodes[input.props.from]!.props, draft.nodes[input.props.to]!.props);
        return freshId(draft, ctx!.ids, edgeIdPrefix(draft, scope));
      });
      draft.edges[id] = { id, vertices: (input.vertices ?? []).map(copy), props: withRevOne(input.props) };
    },
  });
}
