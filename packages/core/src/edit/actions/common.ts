// Shared checks for the actions.
import type { Position } from '../../types.ts';
import { buildingById, clone, isPosition, type EditState } from '../state.ts';

/** Properties of a new Feature: `rev` is optional because a new Feature always starts at rev 1. */
export type NewProps<P extends { rev: number }> = Omit<P, 'rev'> & { rev?: number };

/** Copy of `props` with rev 1. An existing rev key keeps its position, a missing one goes last. */
export function withRevOne<P extends { rev: number }>(props: NewProps<P>): P {
  return { ...clone(props), rev: 1 } as unknown as P;
}

/** Same scope rule for nodes and rooms: outdoor is building_id null + level null, indoor needs a real building and level. */
export function scopeProblem(state: EditState, p: { building_id: string | null; level: number | null }): string | false {
  if (p.building_id === null) {
    return p.level === null ? false : '바깥(building_id가 null)이면 level도 null이어야 합니다.';
  }
  const building = buildingById(state, p.building_id);
  if (!building) return `건물 "${p.building_id}"이(가) 없습니다.`;
  if (p.level === null || !building.props.levels.includes(p.level)) {
    return `${String(p.level)}층이 건물 "${p.building_id}"의 levels(${building.props.levels.join(', ')})에 없습니다.`;
  }
  return false;
}

export function polygonProblem(polygon: unknown): string | false {
  const ok = Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition) &&
    (ring[0] as Position)[0] === (ring[ring.length - 1] as Position)[0] &&
    (ring[0] as Position)[1] === (ring[ring.length - 1] as Position)[1]);
  return ok ? false : '영역은 닫힌 고리(첫 점 = 끝 점, 점 4개 이상)여야 합니다.';
}

export function missing(kind: string, ids: readonly string[], has: (id: string) => boolean): string | false {
  if (ids.length === 0) return `${kind}을(를) 하나 이상 골라 주세요.`;
  const gone = ids.filter((id) => !has(id));
  return gone.length > 0 ? `없는 ${kind}입니다: ${gone.join(', ')}` : false;
}
