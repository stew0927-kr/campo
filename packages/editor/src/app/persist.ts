// Saving the campus folder in two steps, so the screen can ask "save despite check errors?" in between:
// prepareSave builds exactly the files that will be written and checks them; commitSave tells the session they were written.
import { validateCampus, type EditState, type Override } from '@campo/core';
import { overridesOf, overridesWithQueued } from '../model/reports.ts';
import { tabLabel } from '../ui/registry.ts';
import {
  OBSERVATION_FILE, commitObservations, commitOverrides, extrasWithPending, pendingObservationsText, pendingOverrides, stateToCampus, stateToFiles,
  type PendingOverrides, type Session,
} from '../model/session.ts';

export interface PreparedSave {
  files: Record<string, string>;
  /** The overrides.json to write, when a split, a heal or an applied report changed it. */
  overrides: PendingOverrides | null;
  /** Check errors of the campus as it would be saved (SPEC §8: check before saving). */
  errorCount: number;
}

/**
 * `queued` are the overrides.json entries of temporary reports applied in the 제보 관리 tab
 * (added to the file next to the ones a split or heal carries along).
 */
export function prepareSave(session: Session, state: EditState, queued: readonly Override[]): PreparedSave {
  const files = stateToFiles(state, session.meta, session.passthrough);
  let overrides = pendingOverrides(session);
  if (queued.length > 0) {
    const base = overrides?.overrides ?? overridesOf(session.extras);
    if (base === null) throw new Error(`overrides.json을 읽을 수 없어 제보의 override를 더하지 못했습니다. ${tabLabel('checks')} 탭을 확인해 주세요.`);
    overrides = overridesWithQueued(base, queued);
  }
  if (overrides) files['overrides.json'] = overrides.text;
  // Measurements typed since the last save are appended to observations/editor.jsonl (the other observation files stay as they are).
  const observations = pendingObservationsText(session);
  if (observations !== null) files[OBSERVATION_FILE] = observations;
  const extras = extrasWithPending(session, overrides ? { path: 'overrides.json', text: overrides.text } : undefined);
  const { errors } = validateCampus(stateToCampus(state, session.meta, session.passthrough, extras));
  return { files, overrides, errorCount: errors.length };
}

/** The files of `save` are on disk: the session's base moves to the saved state and its pending lists are emptied. */
export function commitSave(session: Session, save: PreparedSave): void {
  session.history.markSaved();
  if (save.overrides) commitOverrides(session, save.overrides);
  commitObservations(session);
}
