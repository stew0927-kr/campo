import { bumpRev, defineAction, type Action } from '../action.ts';
import { missing } from './common.ts';

/** Swap two keys' values, only when the edge has both (keeps the saved key order). */
function swap(props: Record<string, unknown>, a: string, b: string): void {
  if (!(a in props) || !(b in props)) return;
  [props[a], props[b]] = [props[b], props[a]];
}

/**
 * Turn edges around (SPEC-v0.2 4.1): from / to and the order of vertices, and everything that is relative to the drawn
 * direction: conveying forward ↔ backward (reversible stays), incline up ↔ down, level_from ↔ level_to and
 * building_from ↔ building_to (they describe the from and to end). bidirectional and every other property stay.
 */
export function reverseEdge(ids: readonly string[]): Action {
  const list = [...new Set(ids)];
  return defineAction({
    annotation: list.length === 1 ? '구간 방향 뒤집기' : `구간 ${list.length}개 방향 뒤집기`,
    disabled: (state) => missing('구간', list, (id) => id in state.edges),
    recipe(draft) {
      for (const id of list) {
        const edge = draft.edges[id]!;
        const p = edge.props as unknown as Record<string, unknown>;
        swap(p, 'from', 'to');
        swap(p, 'level_from', 'level_to');
        swap(p, 'building_from', 'building_to');
        if (p['conveying'] === 'forward') p['conveying'] = 'backward';
        else if (p['conveying'] === 'backward') p['conveying'] = 'forward';
        if (p['incline'] === 'up') p['incline'] = 'down';
        else if (p['incline'] === 'down') p['incline'] = 'up';
        edge.vertices = [...edge.vertices].reverse();
        bumpRev(edge.props);
      }
    },
  });
}
