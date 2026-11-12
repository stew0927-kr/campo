import type { Draft } from 'immer';
import { COLLECTIONS, type EditState } from './state.ts';

/** Make `draft` (currently `base`) equal to `end`, touching only the Features that differ (one patch per Feature). */
export function writeBack(draft: Draft<EditState>, base: EditState, end: EditState): void {
  for (const c of COLLECTIONS) {
    const d = draft[c] as unknown as Record<string, unknown>;
    const b = base[c] as Record<string, unknown>;
    const e = end[c] as Record<string, unknown>;
    for (const k of Object.keys(b)) if (!(k in e)) delete d[k];
    for (const k of Object.keys(e)) if (e[k] !== b[k]) d[k] = e[k];
  }
}
