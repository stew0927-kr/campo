// 평지 모양 수정: 도형 수정(draft)을 한 번에 저장하는 action. 건물 외곽선 수정(setBuildingOutline)의 평지판으로,
// 링 규칙(E16·E17: 닫힘·자기 교차·구멍 배치·점 개수)을 지나야 저장됩니다. 다른 평지와 맞닿거나 겹쳐도 됩니다.
import { normalizePlazaRings, plazaProblem } from '../../plaza/geometry.ts';
import type { Position } from '../../types.ts';
import { bumpRev, defineAction, type Action } from '../action.ts';
import { clone, type EditState } from '../state.ts';

/**
 * Replace a plaza's rings (평지 모양 수정). The rings are closed and oriented on the way in (outer CCW, holes CW) and
 * must pass plazaProblem; the plaza may touch or overlap other plazas. rev + 1.
 */
export function setPlazaOutline(plazaId: string, polygon: Position[][]): Action {
  const rings = normalizePlazaRings(clone(polygon));
  return defineAction({
    annotation: '평지 모양 수정',
    disabled(state: EditState) {
      const p = state.plazas[plazaId];
      if (!p) return `평지 "${plazaId}"이(가) 없습니다.`;
      const problem = plazaProblem(rings);
      return problem || false;
    },
    recipe(draft) {
      const p = draft.plazas[plazaId]!;
      p.polygon = clone(rings);
      bumpRev(p.props);
    },
  });
}
