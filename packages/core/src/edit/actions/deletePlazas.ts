import { defineAction, deletionWarnings, type Action, type EditContext } from '../action.ts';
import { missing } from './common.ts';

/** Delete plazas (평지). Nothing else points at a plaza, so nothing else changes. */
export function deletePlazas(ids: readonly string[], ctx?: EditContext): Action {
  const list = [...new Set(ids)];
  const action = defineAction({
    annotation: `평지 ${list.length}개 삭제`,
    disabled: (state) => missing('평지', list, (id) => id in state.plazas),
    recipe(draft) {
      for (const id of list) delete draft.plazas[id];
    },
    warnings: (state) => deletionWarnings(action, ctx, state),
  });
  return action;
}
