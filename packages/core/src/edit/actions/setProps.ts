import { produce } from 'immer';
import { bumpRev, defineAction, type Action } from '../action.ts';
import { newViolations } from '../invariants.ts';
import { clone, findFeature, type EditState } from '../state.ts';
import { missing } from './common.ts';

/** A value of `undefined` removes the key; `null` is stored as null. */
export type PropsPatch = Readonly<Record<string, unknown>>;

/**
 * Keys setProps never changes. id / kind / rev / from / to / building_id / level are structure (other actions own them);
 * `code` is a building's record key.
 */
export const LOCKED_PROPS: readonly string[] = ['id', 'kind', 'rev', 'from', 'to', 'building_id', 'level', 'code'];

/** Change properties of one or more Features (any collection, buildings by Feature id). */
export function setProps(ids: readonly string[], patch: PropsPatch): Action {
  const list = [...new Set(ids)];
  const keys = Object.keys(patch);
  const recipe = (draft: EditState) => {
    for (const id of list) {
      const where = findFeature(draft, id)!;
      const record = draft[where.collection] as Record<string, { props: object }>;
      const props = record[where.key]!.props as Record<string, unknown>;
      for (const k of keys) {
        const v = patch[k];
        if (v === undefined) delete props[k];
        else props[k] = clone(v);
      }
      bumpRev(props as { rev: number });
    }
  };
  return defineAction({
    annotation: list.length === 1 ? '속성 바꾸기' : `Feature ${list.length}개 속성 바꾸기`,
    disabled(state) {
      const gone = missing('Feature', list, (id) => findFeature(state, id) !== undefined);
      if (gone) return gone;
      if (keys.length === 0) return '바꿀 속성이 없습니다.';
      const locked = keys.filter((k) => LOCKED_PROPS.includes(k));
      if (locked.length > 0) return `이 속성은 여기서 바꿀 수 없습니다: ${locked.join(', ')}`;
      const broken = newViolations(state, produce(state, recipe), ['I4', 'I5']);
      if (broken.length > 0) return `바꾸면 불변식이 깨집니다: ${broken.map((v) => v.message).join(' ')}`;
      return false;
    },
    recipe,
  });
}
