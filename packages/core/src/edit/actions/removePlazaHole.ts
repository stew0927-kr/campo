import { bumpRev, defineAction, type Action } from '../action.ts';

/** Remove hole `holeIndex` of a plaza (0 = polygon[1]), rev + 1. */
export function removePlazaHole(plazaId: string, holeIndex: number): Action {
  return defineAction({
    annotation: '평지 구멍 지우기',
    disabled(state) {
      const p = state.plazas[plazaId];
      if (!p) return `평지 "${plazaId}"이(가) 없습니다.`;
      if (!Number.isInteger(holeIndex) || holeIndex < 0 || holeIndex + 1 >= p.polygon.length) return `평지 "${plazaId}"에 ${holeIndex + 1}번째 구멍이 없습니다.`;
      return false;
    },
    recipe(draft) {
      const p = draft.plazas[plazaId]!;
      p.polygon.splice(holeIndex + 1, 1);
      bumpRev(p.props);
    },
  });
}
