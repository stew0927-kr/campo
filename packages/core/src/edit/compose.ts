// compose: several actions as one Action, so History.perform records one entry and one undo takes all of it back
// (SPEC-v0.2 §4: a macro that adds 50 nodes is one history entry). The steps run one after another on immutable states;
// the recipe then writes only the Features that changed into the draft.
import { current, isDraft } from 'immer';
import { defineAction, type Action, type OverrideCopy } from './action.ts';
import type { EditState } from './state.ts';
import { writeBack } from './writeback.ts';

/** An action, or a function that builds it from the state the earlier steps left. null skips the step. */
export type ComposeStep = Action | ((state: EditState) => Action | null);

interface Run {
  /** Why it cannot run, or false. */
  reason: string | false;
  state: EditState;
  warnings: string[];
  copies: OverrideCopy[];
}

/**
 * Run `steps` in order as one action. It is disabled with the first step's reason. Warnings and override copies of
 * every step are collected. A step function is called once per position and its action is kept, so ids the
 * step draws repeat when the composed action runs again on the same state (disabled, warnings, History.perform).
 */
export function compose(steps: readonly ComposeStep[], annotation: string): Action {
  const made = new Map<number, Action | null>();
  let last: { start: EditState; run: Run } | undefined;

  const run = (start: EditState): Run => {
    if (last && last.start === start) return last.run;
    let state = start;
    const warnings: string[] = [];
    const copies: OverrideCopy[] = [];
    let failed: string | false = false;
    for (let i = 0; i < steps.length && failed === false; i++) {
      const step = steps[i]!;
      let action: Action | null;
      if (typeof step === 'function') {
        if (!made.has(i)) made.set(i, step(state));
        action = made.get(i)!;
      } else {
        action = step;
      }
      if (!action) continue;
      const reason = action.disabled(state);
      if (reason !== false) {
        failed = reason;
        break;
      }
      for (const w of action.warnings?.(state) ?? []) if (!warnings.includes(w)) warnings.push(w);
      copies.push(...(action.overrideCopies?.(state) ?? []));
      state = action.apply(state);
    }
    const out: Run = failed === false ? { reason: false, state, warnings, copies } : { reason: failed, state: start, warnings: [], copies: [] };
    last = { start, run: out };
    return out;
  };

  return defineAction({
    annotation,
    disabled(state) {
      if (steps.length === 0) return '묶을 동작이 없습니다.';
      return run(state).reason;
    },
    recipe(draft) {
      const base = (isDraft(draft) ? current(draft) : draft) as EditState;
      const r = run(base);
      if (r.reason !== false) throw new Error(r.reason);
      writeBack(draft, base, r.state);
    },
    warnings: (state) => [...run(state).warnings],
    overrideCopies: (state) => [...run(state).copies],
  });
}
