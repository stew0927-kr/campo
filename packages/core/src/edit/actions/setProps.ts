import { produce } from 'immer';
import { bumpRev, defineAction, type Action } from '../action.ts';
import { newViolations } from '../invariants.ts';
import { PLAZA_SURFACES } from '../../types.ts';
import { clone, findFeature, type EditState } from '../state.ts';
import { missing } from './common.ts';

/** The only keys setProps changes on a plaza (평지). null or undefined removes the key. */
export const PLAZA_EDITABLE_PROPS: readonly string[] = ['name', 'surface', 'fixed_height_m'];
export const PLAZA_HEIGHT_MIN_M = -100;
export const PLAZA_HEIGHT_MAX_M = 3000;

function plazaPatchProblem(patch: PropsPatch): string | false {
  const other = Object.keys(patch).filter((k) => !PLAZA_EDITABLE_PROPS.includes(k));
  if (other.length > 0) return `평지에서는 이름·표면·고정 높이만 바꿀 수 있습니다: ${other.join(', ')}`;
  const { name, surface, fixed_height_m: h } = patch as Record<string, unknown>;
  if (name !== undefined && name !== null && (typeof name !== 'string' || name.length === 0)) return '평지 이름은 비어 있지 않은 글자여야 합니다.';
  if (surface !== undefined && surface !== null && !(PLAZA_SURFACES as readonly unknown[]).includes(surface)) return `표면은 ${PLAZA_SURFACES.join(', ')} 중 하나여야 합니다.`;
  if (h !== undefined && h !== null && (typeof h !== 'number' || !Number.isFinite(h) || h < PLAZA_HEIGHT_MIN_M || h > PLAZA_HEIGHT_MAX_M)) {
    return `고정 높이는 ${PLAZA_HEIGHT_MIN_M}~${PLAZA_HEIGHT_MAX_M} m 사이의 숫자여야 합니다.`;
  }
  return false;
}

/** A value of `undefined` removes the key; `null` is stored as null. */
export type PropsPatch = Readonly<Record<string, unknown>>;

/**
 * Keys setProps never changes. id / kind / rev / from / to / building_id / level are structure (other actions own them);
 * `code` is a building's record key.
 */
export const LOCKED_PROPS: readonly string[] = ['id', 'kind', 'rev', 'from', 'to', 'building_id', 'level', 'code'];

/**
 * Change properties of one or more Features (any collection, buildings by Feature id). A plaza takes only name, surface and
 * fixed_height_m (finite, -100 to 3000 m), and null removes the key there.
 */
export function setProps(ids: readonly string[], patch: PropsPatch): Action {
  const list = [...new Set(ids)];
  const keys = Object.keys(patch);
  const recipe = (draft: EditState) => {
    for (const id of list) {
      const where = findFeature(draft, id)!;
      const record = draft[where.collection] as Record<string, { props: object }>;
      const props = record[where.key]!.props as Record<string, unknown>;
      const plaza = where.collection === 'plazas';
      for (const k of keys) {
        const v = patch[k];
        if (v === undefined || (plaza && v === null)) delete props[k];
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
      if (list.some((id) => findFeature(state, id)!.collection === 'plazas')) {
        const problem = plazaPatchProblem(patch);
        if (problem) return problem;
      }
      const broken = newViolations(state, produce(state, recipe), ['I4', 'I5']);
      if (broken.length > 0) return `바꾸면 불변식이 깨집니다: ${broken.map((v) => v.message).join(' ')}`;
      return false;
    },
    recipe,
  });
}
