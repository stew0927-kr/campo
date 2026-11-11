// Actions (SPEC-v0.2 §4): pure `(state) => state` functions with a Korean annotation and a disabled(state) check.
// Editor, macros and the changeset CLI all change data only through these.
import { produce, type Draft } from 'immer';
import type { IdGen } from './ids.ts';
import { allIds, idTaken, type EditState } from './state.ts';

export interface EditContext {
  ids: IdGen;
  /** `target` values of observations/*.jsonl ("edge:<id>", "elevator:<id>"), for the split warning. */
  observationTargets?: ReadonlySet<string>;
  /** `feature_id` values of overrides.json, for the delete warnings. */
  overrideIds?: ReadonlySet<string>;
}

export interface Action {
  /** Korean history label, e.g. "지점 3개 삭제". A function when the label needs the state (deleteBuilding counts). */
  readonly annotation?: string | ((state: EditState) => string);
  /** Why the action cannot run on `state` (Korean), or false. */
  disabled(state: EditState): string | false;
  /** The change, written against an Immer draft. Only call it when disabled() is false. */
  recipe(draft: Draft<EditState>): void;
  /** `produce(state, recipe)`. Returns `state` itself when disabled. */
  apply(state: EditState): EditState;
  /** Korean warnings for running the action on `state` (measurements to redo, overrides to clean up). It still runs. */
  warnings?(state: EditState): string[];
}

export interface ActionSpec {
  annotation?: string | ((state: EditState) => string);
  disabled(state: EditState): string | false;
  recipe(draft: Draft<EditState>): void;
  warnings?(state: EditState): string[];
}

export function defineAction(spec: ActionSpec): Action {
  const action: Action = {
    ...spec,
    apply(state) {
      if (spec.disabled(state) !== false) return state;
      return produce(state, (draft) => {
        spec.recipe(draft);
      });
    },
  };
  return action;
}

export function annotationOf(action: Action, state: EditState): string | undefined {
  const a = action.annotation;
  return typeof a === 'function' ? a(state) : a;
}

/** Does nothing. Starts a drag (iD drag_node): perform(noop), replace(moveNode)… */
export function noop(): Action {
  return defineAction({ disabled: () => false, recipe: () => {} });
}

/** Ids drawn by one action instance, so applying it twice to the same state gives the same ids. */
export function idMemo(): (slot: number, state: EditState, draw: () => string) => string {
  const memo: string[] = [];
  return (slot, state, draw) => {
    let id = memo[slot];
    if (id === undefined || idTaken(state, id)) {
      id = draw();
      memo[slot] = id;
    }
    return id;
  };
}

export function needIds(ctx: EditContext | undefined, what: string): EditContext {
  if (!ctx) throw new Error(`${what}: an EditContext with an id generator is required to make new ids`);
  return ctx;
}

/** Ids present in `before` and gone in `after`. */
export function removedIds(before: EditState, after: EditState): string[] {
  const kept = new Set(allIds(after));
  return allIds(before).filter((id) => !kept.has(id)).sort();
}

export function overrideMessage(id: string, survivor?: string): string {
  const keep = survivor === undefined ? '' : `(남는 지점 ${survivor})`;
  return `"${id}"에 override가 있습니다${keep}. overrides.json에서 이 항목을 지우세요.`;
}

export const OBSERVATION_SPLIT_MESSAGE = '이 구간의 측정은 나누기 전 길이 기준이라 다시 재야 합니다';

export function observationMessage(edgeId: string): string {
  return `구간 "${edgeId}": ${OBSERVATION_SPLIT_MESSAGE}.`;
}

/** Override warnings for every Feature the action removes. `survivorOf` names the node a merged-away node lives on as. */
export function deletionWarnings(
  action: Pick<Action, 'apply'>,
  ctx: EditContext | undefined,
  state: EditState,
  survivorOf?: (id: string) => string | undefined,
): string[] {
  const overrides = ctx?.overrideIds;
  if (!overrides || overrides.size === 0) return [];
  return removedIds(state, action.apply(state))
    .filter((id) => overrides.has(id))
    .map((id) => overrideMessage(id, survivorOf?.(id)));
}

export function bumpRev(props: { rev: number }): void {
  props.rev += 1;
}
