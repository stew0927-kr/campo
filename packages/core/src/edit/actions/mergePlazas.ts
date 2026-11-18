// 평지 합치기 action: 두 평지에서 고른 변 사이를 채워 하나로 합칩니다. 합친 결과는 한 id(into)로 남고 from은 지워집니다.
// 합친 평지는 다른 평지와 맞닿거나 겹쳐도 됩니다(이어진 평지, SPEC-v0.2 2.8).
import { normalizePlazaRings, plazaRegionsOverlap } from '../../plaza/geometry.ts';
import { closedRings, mergePlazaPolygons, type PlazaEdgeRef } from '../../plaza/merge.ts';
import type { Position } from '../../types.ts';
import { bumpRev, defineAction, type Action } from '../action.ts';
import { clone, sortedValues, type EditState } from '../state.ts';

export interface PlazaMergeEdges {
  /** A side of the plaza that stays (into). */
  into: PlazaEdgeRef;
  /** A side of the plaza that goes away (from). */
  from: PlazaEdgeRef;
}

/** The merged rings, or the reason it cannot be made (Korean). */
export function mergedPlazaPolygon(state: EditState, intoId: string, fromId: string, edges: PlazaMergeEdges): { polygon: Position[][] } | { error: string } {
  const into = state.plazas[intoId];
  const from = state.plazas[fromId];
  if (!into) return { error: `평지 "${intoId}"이(가) 없습니다.` };
  if (!from) return { error: `평지 "${fromId}"이(가) 없습니다.` };
  return mergePlazaPolygons(closedRings(into.polygon), edges.into, closedRings(from.polygon), edges.from);
}

/** The plaza the merged area would overlap, other than the two being merged, or undefined. Information only. */
export function overlappingOtherPlaza(state: EditState, polygon: Position[][], except: readonly string[]): string | undefined {
  return sortedValues(state.plazas).find((p) => !except.includes(p.id) && plazaRegionsOverlap(p.polygon, polygon))?.id;
}

/** The merged polygon as it would be saved, or the reason not (Korean). */
function mergeResult(state: EditState, intoId: string, fromId: string, edges: PlazaMergeEdges): { polygon: Position[][] } | { error: string } {
  const made = mergedPlazaPolygon(state, intoId, fromId, edges);
  if ('error' in made) return made;
  return { polygon: normalizePlazaRings(clone(made.polygon)) };
}

/**
 * Merge the plaza `fromId` into `intoId` along the clicked sides (평지 합치기). The kept plaza's polygon becomes the
 * union of both and of the bridge between the sides, its holes stay, and its rev goes up; the other plaza goes away.
 */
export function mergePlazas(intoId: string, fromId: string, edges: PlazaMergeEdges): Action {
  return defineAction({
    annotation: '평지 합치기',
    disabled(state) {
      if (intoId === fromId) return '같은 평지끼리는 합칠 수 없습니다. 다른 평지를 골라 주세요.';
      const made = mergeResult(state, intoId, fromId, edges);
      return 'error' in made ? made.error : false;
    },
    recipe(draft) {
      const made = mergeResult(draft as EditState, intoId, fromId, edges);
      if ('error' in made) return;
      const p = draft.plazas[intoId]!;
      p.polygon = made.polygon.map((ring) => ring.map(([lng, lat]): Position => [lng, lat]));
      bumpRev(p.props);
      delete draft.plazas[fromId];
    },
  });
}
