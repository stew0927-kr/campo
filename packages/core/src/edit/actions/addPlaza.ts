import { normalizePlazaRings, plazaProblem, plazaRegionsOverlap } from '../../plaza/geometry.ts';
import type { PlazaProperties, Position } from '../../types.ts';
import { defineAction, idMemo, needIds, type Action, type EditContext } from '../action.ts';
import { freshId, plazaIdPrefix } from '../ids.ts';
import { clone, idTaken, sortedValues, type EditState } from '../state.ts';
import { withRevOne, type NewProps } from './common.ts';

export interface NewPlaza {
  /** Omit to draw one from ctx.ids. */
  id?: string;
  /** [outer, ...holes]. Closed and oriented on the way in (outer CCW, holes CW). */
  polygon: Position[][];
  props: NewProps<PlazaProperties>;
}

/** Which plaza's solid area `polygon` would overlap (E18), or undefined. */
export function overlappingPlaza(state: EditState, polygon: Position[][], except?: string): string | undefined {
  return sortedValues(state.plazas).find((p) => p.id !== except && plazaRegionsOverlap(p.polygon, polygon))?.id;
}

/** Add a flat ground area (평지, rev 1). Its rings must pass plazaProblem and it may not overlap another plaza. */
export function addPlaza(input: NewPlaza, ctx?: EditContext): Action {
  if (input.id === undefined) needIds(ctx, 'addPlaza');
  const memo = idMemo();
  const polygon = normalizePlazaRings(clone(input.polygon));
  return defineAction({
    annotation: '평지 추가',
    disabled(state) {
      if (input.id !== undefined && idTaken(state, input.id)) return `이미 있는 id입니다: ${input.id}`;
      const problem = plazaProblem(polygon);
      if (problem) return problem;
      const other = overlappingPlaza(state, polygon);
      return other === undefined ? false : `평지 "${other}"와 겹칩니다. 겹치지 않게 그리거나 그 평지 안쪽에 구멍으로 그려 주세요.`;
    },
    recipe(draft) {
      const id = input.id ?? memo(0, draft, () => freshId(draft, ctx!.ids, plazaIdPrefix()));
      draft.plazas[id] = { id, polygon: clone(polygon), props: withRevOne(input.props) };
    },
  });
}
