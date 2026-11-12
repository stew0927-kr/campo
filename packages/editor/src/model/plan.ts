// A Plan is one user operation made of one or more core actions. It runs as ONE history entry
// (compose(steps, label) -> perform), so a single Ctrl+Z undoes the whole operation.
// The editor never builds a Feature itself: every step is an action.
import { compose, type Action, type EditState, type History } from '@campo/core';

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

/** Why the plan cannot run on `state` (Korean), or false. */
export function planReason(state: EditState, plan: Plan): string | false {
  return compose(plan.steps, plan.annotation).disabled(state);
}

/** Run the plan as one history entry. On failure nothing is left behind. Warnings come from the actions, before they run. */
export function runPlan(history: History, plan: Plan): RunResult {
  const action = compose(plan.steps, plan.annotation);
  const before = history.current();
  const reason = action.disabled(before);
  if (reason !== false) return { ok: false, reason };
  const warnings = action.warnings?.(before) ?? [];
  history.perform(action);
  return { ok: true, warnings };
}
