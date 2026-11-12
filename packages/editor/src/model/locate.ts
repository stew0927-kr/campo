// Where a feature is, so the 검사 tab can take the map there.
import { edgeCoords, findFeature, type EditNode, type EditState, type Position } from '@campo/core';
import { OUTDOOR, type Scope } from './scope.ts';

function center(pts: readonly Position[]): Position {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

export function featureCenter(state: EditState, id: string): Position | undefined {
  const where = findFeature(state, id);
  if (!where) return undefined;
  switch (where.collection) {
    case 'nodes': return state.nodes[where.key]!.coord;
    case 'edges': return center(edgeCoords(state, state.edges[where.key]!));
    case 'buildings': return center(state.buildings[where.key]!.polygon[0] ?? []);
    case 'rooms': return center(state.rooms[where.key]!.polygon[0] ?? []);
  }
}

/** The floor to show for a feature: its own floor, or the lower floor of an edge (like the file layout). */
export function featureScope(state: EditState, id: string): Scope {
  const where = findFeature(state, id);
  if (!where || where.collection === 'buildings') return OUTDOOR;
  if (where.collection === 'rooms') {
    const p = state.rooms[where.key]!.props;
    return { kind: 'building', buildingId: p.building_id, level: p.level };
  }
  const nodes: EditNode[] = where.collection === 'nodes'
    ? [state.nodes[where.key]!]
    : [state.edges[where.key]!.props.from, state.edges[where.key]!.props.to].map((n) => state.nodes[n]).filter((n): n is EditNode => !!n);
  const indoor = nodes.filter((n) => n.props.building_id !== null && n.props.level !== null);
  if (indoor.length === 0) return OUTDOOR;
  const lower = indoor.reduce((a, b) => (b.props.level! < a.props.level! ? b : a));
  return { kind: 'building', buildingId: lower.props.building_id!, level: lower.props.level! };
}
