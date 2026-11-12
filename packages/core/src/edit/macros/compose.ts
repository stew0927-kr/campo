// A macro is one Action made of several engine actions (SPEC-v0.2 §4: a macro that adds 50 nodes is one history entry).
// The plan runs the sub-actions one after another on immutable states; the macro's recipe writes the end state into
// the draft, so History.perform records one entry and one undo takes all of it back.
import { current, isDraft } from 'immer';
import type { Action, EditContext, OverrideCopy } from '../action.ts';
import { defineAction } from '../action.ts';
import { freshId } from '../ids.ts';
import { idTaken, type EditState } from '../state.ts';
import { writeBack } from '../writeback.ts';

/** Thrown inside a plan to stop the macro; the macro is then disabled with this reason. */
export class MacroStop extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'MacroStop';
  }
}

export interface Runner {
  /** State after the sub-actions run so far. */
  readonly state: EditState;
  /**
   * Run a sub-action on the current state and collect its warnings. Stops the macro with its disabled() reason.
   * `key` names the sub-action's inputs: the same key in a later run gets the same action instance back,
   * so ids the sub-action draws itself (splitEdgeAt) repeat when the macro runs again on the same state.
   */
  step(key: string, make: () => Action): EditState;
  /** A new id with this prefix. The same call in a later run on the same state gives the same id. */
  newId(prefix: string): string;
  /** Stop the macro with a Korean reason. */
  fail(reason: string): never;
}

export type MacroPlan<R> = (r: Runner) => R;

export type MacroSuccess<R> = { ok: true; state: EditState; warnings: string[]; overrideCopies: OverrideCopy[] } & R;
export interface MacroFailure {
  ok: false;
  reason: string;
}
export type MacroRun<R> = MacroSuccess<R> | MacroFailure;

export interface MacroAction<R> extends Action {
  /** Run the plan without History: the end state, the collected warnings and the macro's result, or why it cannot run. */
  run(state: EditState): MacroRun<R>;
}

/** What the macro functions (attachDoor(state, …) etc.) return. On failure the state is the input, unchanged. */
export type MacroResult<R> =
  | ({ ok: true; state: EditState; warnings: string[]; overrideCopies: OverrideCopy[]; action: MacroAction<R> } & R)
  | { ok: false; state: EditState; reason: string };

export function resultOf<R>(state: EditState, action: MacroAction<R>): MacroResult<R> {
  const run = action.run(state);
  if (!run.ok) return { ok: false, state, reason: run.reason };
  return { ...run, action };
}

/**
 * Define a macro from a plan. The plan must be a pure function of the state it is given (plus the ids it draws,
 * which repeat through the caches below). `annotation` may read the plan's result.
 */
export function defineMacro<R extends object>(
  annotation: string | ((result: R) => string),
  ctx: EditContext,
  plan: MacroPlan<R>,
): MacroAction<R> {
  const subs = new Map<string, Action>();
  const ids = new Map<string, string>();
  let last: { state: EditState; run: MacroRun<R> } | undefined;

  const run = (start: EditState): MacroRun<R> => {
    if (last && last.state === start) return last.run;
    let state = start;
    let steps = 0;
    let draws = 0;
    const warnings: string[] = [];
    const copies: OverrideCopy[] = [];
    /** Feature ids that have an overrides.json entry as the steps so far leave them. */
    const overrideIds = new Set(ctx.overrideIds ?? []);
    const drawn = new Set<string>();
    const runner: Runner = {
      get state() {
        return state;
      },
      step(key, make) {
        const k = `${steps++}\u0000${key}`;
        let action = subs.get(k);
        if (!action) {
          action = make();
          subs.set(k, action);
        }
        const reason = action.disabled(state);
        if (reason !== false) throw new MacroStop(reason);
        for (const w of action.warnings?.(state) ?? []) if (!warnings.includes(w)) warnings.push(w);
        for (const c of action.overrideCopies?.(state, overrideIds) ?? []) {
          copies.push(c);
          overrideIds.add(c.toId);
          if (c.move) overrideIds.delete(c.fromId);
        }
        state = action.apply(state);
        return state;
      },
      newId(prefix) {
        const k = `${draws++}\u0000${prefix}`;
        let id = ids.get(k);
        if (id === undefined || idTaken(state, id) || drawn.has(id)) {
          id = freshId(state, ctx.ids, prefix, drawn);
          ids.set(k, id);
        }
        drawn.add(id);
        return id;
      },
      fail(reason) {
        throw new MacroStop(reason);
      },
    };
    let out: MacroRun<R>;
    try {
      const result = plan(runner);
      out = { ...result, ok: true, state, warnings, overrideCopies: copies };
    } catch (e) {
      if (!(e instanceof MacroStop)) throw e;
      out = { ok: false, reason: e.reason };
    }
    last = { state: start, run: out };
    return out;
  };

  const action = defineAction({
    annotation:
      typeof annotation === 'string'
        ? annotation
        : (state) => {
            const r = run(state);
            return r.ok ? annotation(r) : '매크로';
          },
    disabled(state) {
      const r = run(state);
      return r.ok ? false : r.reason;
    },
    recipe(draft) {
      const base = (isDraft(draft) ? current(draft) : draft) as EditState;
      const r = run(base);
      if (!r.ok) throw new Error(r.reason);
      writeBack(draft, base, r.state);
    },
    warnings(state) {
      const r = run(state);
      return r.ok ? [...r.warnings] : [];
    },
    overrideCopies(state) {
      const r = run(state);
      return r.ok ? [...r.overrideCopies] : [];
    },
  });
  return Object.assign(action, { run });
}

/** Ids in `after[collection]` that `before` does not have, sorted. */
export function addedKeys(before: EditState, after: EditState, collection: 'nodes' | 'edges'): string[] {
  return Object.keys(after[collection]).filter((k) => !(k in before[collection])).sort();
}
