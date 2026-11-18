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

/**
 * Which plaza's solid area `polygon` would overlap, or undefined. Information only: plazas may touch and overlap (they
 * are then linked, SPEC-v0.2 2.8), so no action refuses on it.
 */
export function overlappingPlaza(state: EditState, polygon: Position[][], except?: string): string | undefined {
  return sortedValues(state.plazas).find((p) => p.id !== except && plazaRegionsOverlap(p.polygon, polygon))?.id;
}

/** Add a flat ground area (평지, rev 1). Its rings must pass plazaProblem; it may touch or overlap other plazas. */
export function addPlaza(input: NewPlaza, ctx?: EditContext): Action {
  if (input.id === undefined) needIds(ctx, 'addPlaza');
  const memo = idMemo();
  const polygon = normalizePlazaRings(clone(input.polygon));
  return defineAction({
    annotation: '평지 추가',
    disabled(state) {
      if (input.id !== undefined && idTaken(state, input.id)) return `이미 있는 id입니다: ${input.id}`;
      const problem = plazaProblem(polygon);
      return problem || false;
    },
    recipe(draft) {
      const id = input.id ?? memo(0, draft, () => freshId(draft, ctx!.ids, plazaIdPrefix()));
      draft.plazas[id] = { id, polygon: clone(polygon), props: withRevOne(input.props) };
    },
  });
}
