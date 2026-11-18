import { closeRingPositions, normalizePlazaRings, plazaProblem } from '../../plaza/geometry.ts';
import type { Position } from '../../types.ts';
import { bumpRev, defineAction, type Action } from '../action.ts';
import { clone, type EditState } from '../state.ts';

function withHole(state: EditState, plazaId: string, ring: Position[]): Position[][] | undefined {
  const p = state.plazas[plazaId];
  if (!p) return undefined;
  return normalizePlazaRings([...clone(p.polygon), closeRingPositions(ring)]);
}

/** Cut a hole into a plaza (rev + 1). The ring is closed and turned clockwise; the plaza with it must pass plazaProblem. */
export function addPlazaHole(plazaId: string, ring: Position[]): Action {
  const hole = clone(ring);
  return defineAction({
    annotation: '평지에 구멍 뚫기',
    disabled(state) {
      const next = withHole(state, plazaId, hole);
      if (!next) return `평지 "${plazaId}"이(가) 없습니다.`;
      const problem = plazaProblem(next);
      return problem || false;
    },
    recipe(draft) {
      const next = withHole(draft as EditState, plazaId, hole)!;
      const p = draft.plazas[plazaId]!;
      p.polygon = next;
      bumpRev(p.props);
    },
  });
}
