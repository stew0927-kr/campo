import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { createHistory, createIdGen, fromCampus, type Action, type EditContext, type EditState, type LoadedCampus } from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';

export const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/campus-basic', import.meta.url));

let cached: { loaded: LoadedCampus; state: EditState } | undefined;

/** campus-basic as an edit state (deep-frozen, so any mutation of the input throws). */
export async function fixtureState(): Promise<EditState> {
  return (await fixture()).state;
}

export async function fixture(): Promise<{ loaded: LoadedCampus; state: EditState }> {
  if (!cached) {
    const loaded = await loadCampus(FIXTURE_DIR);
    const { state, issues } = fromCampus(loaded);
    if (issues.length > 0) throw new Error(`fixture loads with issues: ${JSON.stringify(issues)}`);
    cached = { loaded, state: deepFreeze(state) };
  }
  return cached;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export function ctx(seed = 1, extra: Partial<EditContext> = {}): EditContext {
  return { ids: createIdGen(seed), ...extra };
}

/** apply() on a deep-frozen state must not throw and must leave the state equal to a copy taken before. */
export function expectInputUntouched(state: EditState, action: Action): EditState {
  const before = JSON.parse(JSON.stringify(state)) as EditState;
  const after = action.apply(deepFreeze(state));
  expect(state).toEqual(before);
  return after;
}

/** perform → undo gives the start, redo gives the result again. */
export function expectUndoRedo(state: EditState, action: Action): EditState {
  const h = createHistory(state);
  const after = h.perform(action);
  expect(after).not.toEqual(state);
  expect(h.undo()).toEqual(state);
  expect(h.redo()).toEqual(after);
  return after;
}

/** Ids present in `after` but not in `before`. */
export function newIds(before: EditState, after: EditState): string[] {
  const had = new Set([...Object.keys(before.nodes), ...Object.keys(before.edges), ...Object.keys(before.rooms)]);
  return [...Object.keys(after.nodes), ...Object.keys(after.edges), ...Object.keys(after.rooms)].filter((id) => !had.has(id)).sort();
}
