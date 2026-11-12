// Edit history (SPEC-v0.2 §4). Same model as iD's coreHistory (modules/core/history.js: perform / replace /
// overwrite / undo / redo that skip entries without an annotation); no iD code is copied. Undo and redo use Immer patches.
import { applyPatches, produceWithPatches, type Patch } from 'immer';
import { annotationOf, type Action, type OverrideCopy } from './action.ts';
import { COLLECTIONS, deepEqual, type Collection, type EditState } from './state.ts';

export interface HistoryEntry {
  state: EditState;
  patches: Patch[];
  inversePatches: Patch[];
  /** Entries without one are skipped by undo / redo (the inside of a drag). */
  annotation: string | undefined;
  /** overrides.json entries the entry's actions ask to copy or move (split / heal). */
  overrideCopies: OverrideCopy[];
}

export interface HistoryOptions {
  /** Most entries kept; the oldest is dropped beyond this. Default 200. */
  limit?: number;
}

/**
 * `annotation` argument of perform / replace / overwrite: omit it to use the action's own annotation,
 * pass null for none (moves in the middle of a drag), or pass a string to override.
 */
export type AnnotationArg = string | null | undefined;

export interface History {
  perform(action: Action, annotation?: AnnotationArg): EditState;
  /** Apply to the current state and fold into the current entry (iD replace). */
  replace(action: Action, annotation?: AnnotationArg): EditState;
  /** Drop the current entry, then perform on the state before it (iD overwrite). */
  overwrite(action: Action, annotation?: AnnotationArg): EditState;
  undo(): EditState;
  redo(): EditState;
  current(): EditState;
  canUndo(): boolean;
  canRedo(): boolean;
  /** The current state becomes the rev baseline (call after saving). */
  markSaved(): void;
  /**
   * overrides.json entries to carry over for the edits since the last markSaved, in order, up to the current entry
   * (undone edits are not included). Apply them with applyOverrideCopies when saving.
   */
  overrideCopies(): OverrideCopy[];
  /** The rev baseline: the loaded state or the last saved one. */
  base(): EditState;
  /** Number of entries after the starting one. */
  size(): number;
}

interface RunResult {
  state: EditState;
  patches: Patch[];
  inversePatches: Patch[];
}

/** What the saved file would hold for a Feature, minus rev. Edges include their end coordinates. */
function savedForm(state: EditState, collection: Collection, feature: unknown): unknown {
  const f = feature as { id: string; props: { rev: number }; coord?: unknown; polygon?: unknown; vertices?: unknown };
  const { rev: _rev, ...props } = f.props as Record<string, unknown> & { rev: number };
  if (collection === 'edges') {
    const p = f.props as unknown as { from: string; to: string };
    return { id: f.id, from: state.nodes[p.from]?.coord ?? null, vertices: f.vertices, to: state.nodes[p.to]?.coord ?? null, props };
  }
  return { id: f.id, coord: f.coord, polygon: f.polygon, props };
}

/** Touched Features by patch path [collection, key]. */
function touched(patches: readonly Patch[], state: EditState): [Collection, string][] {
  const seen = new Set<string>();
  const out: [Collection, string][] = [];
  const add = (c: Collection, k: string) => {
    const tag = `${c}\u0000${k}`;
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push([c, k]);
    }
  };
  for (const { path } of patches) {
    const c = path[0] as Collection;
    if (!COLLECTIONS.includes(c)) continue;
    if (path.length === 1) for (const k of Object.keys(state[c])) add(c, k);
    else add(c, String(path[1]));
  }
  return out;
}

/**
 * Run an action and set the rev of every Feature it touched relative to `base`:
 * base rev + 1 when it differs from base, the base rev when it is back to the base content, 1 when it is new.
 */
function run(state: EditState, action: Action, base: EditState): RunResult {
  const reason = action.disabled(state);
  if (reason !== false) throw new Error(reason);
  const [s1, p1, i1] = produceWithPatches(state, (draft) => {
    action.recipe(draft);
  });
  const fixes: [Collection, string, number][] = [];
  for (const [c, k] of touched(p1, s1)) {
    const now = (s1[c] as Record<string, { props: { rev: number } }>)[k];
    if (!now) continue;
    const was = (base[c] as Record<string, { props: { rev: number } }>)[k];
    const rev = !was ? 1 : deepEqual(savedForm(base, c, was), savedForm(s1, c, now)) ? was.props.rev : was.props.rev + 1;
    if (now.props.rev !== rev) fixes.push([c, k, rev]);
  }
  if (fixes.length === 0) return { state: s1, patches: p1, inversePatches: i1 };
  const [s2, p2, i2] = produceWithPatches(s1, (draft) => {
    for (const [c, k, rev] of fixes) (draft[c] as Record<string, { props: { rev: number } }>)[k]!.props.rev = rev;
  });
  return { state: s2, patches: [...p1, ...p2], inversePatches: [...i2, ...i1] };
}

export function createHistory(start: EditState, options: HistoryOptions = {}): History {
  const limit = options.limit ?? 200;
  let stack: HistoryEntry[] = [{ state: start, patches: [], inversePatches: [], annotation: undefined, overrideCopies: [] }];
  /** Entries up to this index are already saved (markSaved). */
  let savedIndex = 0;
  let index = 0;
  let current = start;
  let base = start;

  const label = (action: Action, before: EditState, arg: AnnotationArg) =>
    arg === null ? undefined : arg ?? annotationOf(action, before);

  const push = (entry: HistoryEntry) => {
    stack = stack.slice(0, index + 1);
    stack.push(entry);
    index++;
    savedIndex = Math.min(savedIndex, index - 1);
    while (stack.length - 1 > limit) {
      stack.shift();
      index--;
      savedIndex = Math.max(0, savedIndex - 1);
    }
    current = entry.state;
    return current;
  };

  const perform = (action: Action, annotation?: AnnotationArg) => {
    const r = run(current, action, base);
    return push({ ...r, annotation: label(action, current, annotation), overrideCopies: action.overrideCopies?.(current) ?? [] });
  };

  return {
    perform,
    replace(action, annotation) {
      if (index === 0) return perform(action, annotation);
      const r = run(current, action, base);
      const copies = action.overrideCopies?.(current) ?? [];
      const top = stack[index]!;
      stack = stack.slice(0, index + 1);
      stack[index] = {
        state: r.state,
        patches: [...top.patches, ...r.patches],
        inversePatches: [...r.inversePatches, ...top.inversePatches],
        annotation: label(action, current, annotation),
        overrideCopies: [...top.overrideCopies, ...copies],
      };
      current = r.state;
      return current;
    },
    overwrite(action, annotation) {
      if (index > 0) {
        current = applyPatches(current, stack[index]!.inversePatches);
        stack = stack.slice(0, index);
        index--;
      }
      return perform(action, annotation);
    },
    undo() {
      let s = current;
      while (index > 0) {
        s = applyPatches(s, stack[index]!.inversePatches);
        index--;
        if (stack[index]!.annotation !== undefined) break;
      }
      current = s;
      return current;
    },
    redo() {
      for (let t = index + 1; t < stack.length; t++) {
        if (stack[t]!.annotation === undefined) continue;
        let s = current;
        for (let i = index + 1; i <= t; i++) s = applyPatches(s, stack[i]!.patches);
        index = t;
        current = s;
        break;
      }
      return current;
    },
    current: () => current,
    canUndo: () => index > 0,
    canRedo: () => stack.slice(index + 1).some((e) => e.annotation !== undefined),
    markSaved() {
      base = current;
      savedIndex = index;
    },
    overrideCopies: () => stack.slice(savedIndex + 1, index + 1).flatMap((e) => e.overrideCopies),
    base: () => base,
    size: () => stack.length - 1,
  };
}
