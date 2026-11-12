// A Plan is one user operation made of one or more core actions. It runs as ONE history entry
// (perform(noop) -> replace(each action, no label) -> replace(noop, label)), the same shape as a drag,
// so a single Ctrl+Z undoes the whole operation. The editor never builds a Feature itself: every step is an action.
import { noop, type Action, type EditState, type History } from '@campo/core';

/** Builds the action from the state the previous step left behind. null skips the step. */
export type Step = (state: EditState) => Action | null;

export interface Plan {
  /** Korean history label, e.g. "지점 3개 삭제". */
  annotation: string;
  steps: Step[];
}

export type PlanResult = Plan | { error: string };

export function isError(r: PlanResult): r is { error: string } {
  return 'error' in r;
}

export type RunResult = { ok: true; warnings: string[] } | { ok: false; reason: string };

/** Why the plan cannot run on `state` (Korean), or false. Applies the steps in order on a throwaway copy. */
export function planReason(state: EditState, plan: Plan): string | false {
  let s = state;
  for (const step of plan.steps) {
    const a = step(s);
    if (!a) continue;
    const reason = a.disabled(s);
    if (reason !== false) return reason;
    s = a.apply(s);
  }
  return false;
}

/** Run the plan as one history entry. On failure nothing is left behind. Warnings come from the actions, before they run. */
export function runPlan(history: History, plan: Plan): RunResult {
  const warnings: string[] = [];
  history.perform(noop(), null);
  try {
    for (const step of plan.steps) {
      const before = history.current();
      const action = step(before);
      if (!action) continue;
      const reason = action.disabled(before);
      if (reason !== false) throw new Error(reason);
      warnings.push(...(action.warnings?.(before) ?? []));
      history.replace(action, null);
    }
    history.replace(noop(), plan.annotation);
    return { ok: true, warnings };
  } catch (err) {
    history.undo();
    return { ok: false, reason: (err as Error).message };
  }
}
