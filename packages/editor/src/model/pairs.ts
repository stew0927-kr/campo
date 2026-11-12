// Two escalators between the same two points (상행 + 하행 한 쌍) have the same line. Display only: each one gets a side so both show.
import type { EditState } from '@campo/core';

/** Pixels between two sides of a pair (the layers multiply the unit offset by this). */
export const PAIR_OFFSET_PX = 5;

const RANK: Record<string, number> = { forward: 0, reversible: 1, backward: 2 };

/**
 * Unit offsets (-1 left, +1 right of each edge's own direction) of the moving-belt edges that share both ends with another one.
 * Edges that stand alone are not in the map. Along one drawn direction the 상행 sits on the left, so it is always the same side of the pair.
 */
export function pairOffsets(state: Pick<EditState, 'edges'>): Map<string, number> {
  const groups = new Map<string, { id: string; from: string; rank: number }[]>();
  for (const e of Object.values(state.edges)) {
    if (e.props.conveying === undefined) continue;
    const key = [e.props.from, e.props.to].sort().join('\u0000');
    const list = groups.get(key) ?? [];
    list.push({ id: e.id, from: e.props.from, rank: RANK[e.props.conveying] ?? 3 });
    groups.set(key, list);
  }
  const out = new Map<string, number>();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
    const canonical = list[0]!.from; // the side is told in the direction of the first one
    list.forEach((e, i) => {
      const side = (i - (list.length - 1) / 2) * 2; // 2 edges: -1, +1
      out.set(e.id, e.from === canonical ? side : -side);
    });
  }
  return out;
}
