// 평지 합치기: the two sides the user clicked on the map, and the Plan that merges those plazas into one.
// 기하는 core(mergePlazas)가 합니다: 여기서는 어느 평지의 어느 변인지만 정리해 넘깁니다.
import { mergePlazas, nearestOnPlazaBoundary, type EditState, type Position } from '@campo/core';
import type { PlanResult } from './plan.ts';
import { plazaLabel } from './plaza.ts';

/** A side of a plaza on the map: which plaza, which ring (0 = outer, 1+ = holes) and which side of it. */
export interface PlazaEdgePick {
  plazaId: string;
  ring: number;
  segment: number;
  /** Where it was clicked, for the marker on the map. */
  at: Position;
}

/** "평지 '분수 광장' 바깥 2번째 변" — for the status line while two sides are being picked. */
export function edgePickLabel(state: EditState, pick: PlazaEdgePick): string {
  const p = state.plazas[pick.plazaId];
  const where = pick.ring === 0 ? '바깥' : `구멍 ${pick.ring}`;
  return p ? `${plazaLabel(p)} ${where} ${pick.segment + 1}번째 변` : `${pick.plazaId} ${where} ${pick.segment + 1}번째 변`;
}

/** The plaza edge nearest a point, as a pick (null: no plaza within reach of it). */
export function edgeNear(state: EditState, plazaId: string, at: Position): PlazaEdgePick | null {
  const p = state.plazas[plazaId];
  const hit = p ? nearestOnPlazaBoundary(p.polygon, at) : null;
  return hit ? { plazaId, ring: hit.ring, segment: hit.segment, at: hit.position } : null;
}

/**
 * Merge the plazas of the two picked sides (the first stays under its id and name). Same plaza twice is refused: the
 * user has to click a side of the other plaza.
 */
export function planMergePlazas(state: EditState, first: PlazaEdgePick, second: PlazaEdgePick): PlanResult {
  const a = state.plazas[first.plazaId];
  const b = state.plazas[second.plazaId];
  if (!a || !b) return { error: '합칠 평지를 찾을 수 없습니다.' };
  if (first.plazaId === second.plazaId) return { error: '같은 평지의 변 두 개는 합칠 수 없습니다. 다른 평지의 변을 눌러 주세요.' };
  return {
    annotation: `${plazaLabel(a)}와 ${plazaLabel(b)} 합치기`,
    steps: [() => mergePlazas(first.plazaId, second.plazaId, {
      into: { ring: first.ring, segment: first.segment },
      from: { ring: second.ring, segment: second.segment },
    })],
  };
}
