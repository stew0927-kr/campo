// applyChangeset: a changeset file as one edit action (SPEC-v0.2 4, 7.2). The apply CLI changes data only through this.
import { defineAction, type Action } from '../action.ts';
import { checkChangeset, writeChanges } from '../../changeset/conflicts.ts';
import type { Changeset } from '../../changeset/types.ts';
import type { EditState } from '../state.ts';

const MAX_LISTED = 5;

/**
 * Write every change of `cs` (create / modify / delete) as one action. Disabled when the changeset is malformed,
 * conflicts with the state (rev_mismatch / id_exists / still_referenced), or would break an invariant;
 * use checkChangeset(state, cs) for the full structured list.
 */
export function applyChangeset(cs: Changeset): Action {
  return defineAction({
    annotation: `변경 묶음 적용: ${cs.summary !== '' ? cs.summary : cs.id}`,
    disabled(state: EditState) {
      const check = checkChangeset(state, cs);
      if (check.ok) return false;
      if (check.alreadyApplied) return `이미 적용된 changeset입니다: ${cs.id}`;
      const lines = [...check.problems.map((p) => p.message), ...check.conflicts.map((c) => `[${c.code}] ${c.message}`)];
      const more = lines.length > MAX_LISTED ? ` 외 ${lines.length - MAX_LISTED}개` : '';
      return `changeset ${cs.id}을(를) 적용할 수 없습니다: ${lines.slice(0, MAX_LISTED).join(' ')}${more}`;
    },
    recipe(draft) {
      writeChanges(draft as EditState, cs);
    },
  });
}
