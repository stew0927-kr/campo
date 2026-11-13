// What the surveyor saw on a stretch or at a doorway: no step or sill, one, or did not look (the data's step_free: true / false / null).

export type StepFree = boolean | null;

/** In the order a press cycles through them. */
export const STEP_FREE_CHOICES: readonly { value: StepFree; label: string }[] = [
  { value: null, label: '안 봄' },
  { value: true, label: '없음' },
  { value: false, label: '있음' },
];

export const stepFreeLabel = (value: StepFree): string => STEP_FREE_CHOICES.find((c) => c.value === value)!.label;

export function nextStepFree(value: StepFree): StepFree {
  const i = STEP_FREE_CHOICES.findIndex((c) => c.value === value);
  return STEP_FREE_CHOICES[(i + 1) % STEP_FREE_CHOICES.length]!.value;
}
