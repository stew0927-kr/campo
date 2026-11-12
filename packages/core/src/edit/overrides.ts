// Carry overrides.json entries across a split or a heal (SPEC-v0.2 2.5, 4.1). Pure: the editor calls this when saving.
import type { Override } from '../types.ts';
import type { OverrideCopy } from './action.ts';

/**
 * Apply the copies in order: every entry of `fromId` is repeated for `toId` with the same status, until and report_id
 * (skipped when `toId` already has that report). `move` also drops the `fromId` entries.
 * In order, so a copy of a copy works. The input list is not changed.
 */
export function applyOverrideCopies(overrides: readonly Override[], copies: readonly OverrideCopy[]): Override[] {
  let out = overrides.map((o) => ({ ...o }));
  for (const { fromId, toId, move } of copies) {
    const entries = out.filter((o) => o.feature_id === fromId);
    for (const o of entries) {
      if (!out.some((x) => x.feature_id === toId && x.report_id === o.report_id)) out.push({ ...o, feature_id: toId });
    }
    if (move) out = out.filter((o) => o.feature_id !== fromId);
  }
  return out;
}
