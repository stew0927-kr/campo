import { EDGE_WIDTH_MAX_M, EDGE_WIDTH_MIN_M, isValidEdgeWidth } from '../../edgeWidth.ts';
import { bumpRev, defineAction, type Action } from '../action.ts';
import type { EditState } from '../state.ts';
import { missing } from './common.ts';

export const EDGE_WIDTH_REFUSED = `길 폭은 ${EDGE_WIDTH_MIN_M} m 이상 ${EDGE_WIDTH_MAX_M} m 이하로 입력해 주세요.`;

function changes(state: EditState, id: string, widthM: number | null): boolean {
  const p = state.edges[id]!.props;
  return widthM === null ? 'width_m' in p : p.width_m !== widthM;
}

/**
 * Set width_m (SPEC §4.2) on one or more edges, one history entry. `null` removes the key: the edge goes back to the
 * default 2.0 m. Edges that already have the width are left alone (no rev bump). Widths outside 0.5 to 20 m are refused.
 */
export function setEdgeWidth(edgeIds: readonly string[], widthM: number | null): Action {
  const ids = [...new Set(edgeIds)];
  return defineAction({
    annotation: widthM === null ? '길 폭 기본값으로' : ids.length === 1 ? '길 폭 바꾸기' : `길 폭 ${ids.length}개 바꾸기`,
    disabled(state) {
      const gone = missing('구간', ids, (id) => id in state.edges);
      if (gone) return gone;
      if (widthM !== null && !isValidEdgeWidth(widthM)) return EDGE_WIDTH_REFUSED;
      if (!ids.some((id) => changes(state, id, widthM))) return '바뀔 길 폭이 없습니다.';
      return false;
    },
    recipe(draft) {
      for (const id of ids) {
        if (!changes(draft, id, widthM)) continue;
        const props = draft.edges[id]!.props;
        if (widthM === null) delete props.width_m;
        else props.width_m = widthM;
        bumpRev(props);
      }
    },
  });
}
