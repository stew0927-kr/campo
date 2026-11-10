// Korean floor-change sentences for a found route. Display only: floor numbers
// are read here to print them, never to choose or connect anything.
import type { CampusGraph } from './graph.ts';
import type { EdgeFeature, NodeFeature } from './types.ts';

export interface Leg {
  edge: EdgeFeature;
  /** Campus node ids in travel direction. */
  from: string;
  to: string;
}

type Move = 'elevator' | 'stairs' | 'bridge' | 'portal' | null;

function moveOf(edge: EdgeFeature): Move {
  const { highway, edge_type } = edge.properties;
  if (highway === 'elevator') return 'elevator';
  if (highway === 'steps' && edge_type === 'indoor') return 'stairs';
  if (edge_type === 'bridge') return 'bridge';
  if (edge_type === 'portal') return 'portal';
  return null;
}

/**
 * e.g. ["바깥 → A동 4층 출입구", "A동 4층 → 엘리베이터 → 3층", "A동 3층 → 연결통로 → B동 2층"].
 * Consecutive elevator edges are one ride; consecutive indoor stair edges are one climb.
 */
export function describeLegs(g: CampusGraph, legs: readonly Leg[]): string[] {
  const out: string[] = [];
  const node = (id: string) => g.nodes.get(id)!;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]!;
    const move = moveOf(leg.edge);
    if (move === null) continue;

    if (move === 'elevator' || move === 'stairs') {
      let j = i;
      while (j + 1 < legs.length && moveOf(legs[j + 1]!.edge) === move) j++;
      const start = node(leg.from);
      const end = node(legs[j]!.to);
      const via = move === 'elevator' ? '엘리베이터' : '계단';
      const endText = start.properties.building_id === end.properties.building_id ? floor(end) : place(g, end);
      out.push(`${place(g, start)} → ${via} → ${endText || place(g, end)}`);
      i = j;
    } else if (move === 'bridge') {
      out.push(`${place(g, node(leg.from))} → 연결통로 → ${place(g, node(leg.to))}`);
    } else {
      const from = node(leg.from);
      const to = node(leg.to);
      if (from.properties.building_id === null && to.properties.building_id !== null) {
        out.push(`바깥 → ${place(g, to)} 출입구`);
      } else if (from.properties.building_id !== null && to.properties.building_id === null) {
        out.push(`${place(g, from)} 출입구 → 바깥`);
      }
    }
  }
  return out;
}

function place(g: CampusGraph, node: NodeFeature): string {
  const id = node.properties.building_id;
  if (id === null || id === undefined) return '바깥';
  const name = g.buildings.get(id)?.properties.name ?? id;
  return [name, floor(node)].filter(Boolean).join(' ');
}

/** 1 → "1층", -1 → "지하 1층"; empty when the level is unknown. */
function floor(node: NodeFeature): string {
  const level = node.properties.level;
  if (typeof level !== 'number') return '';
  return level < 0 ? `지하 ${-level}층` : `${level}층`;
}
