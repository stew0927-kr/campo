// What the editor is looking at: outdoors, or one floor of one building (SPEC §8 지도 보기).
// Display and picking only: routing never uses this.
import type { EditBuilding, EditEdge, EditNode, EditRoom, EditState } from '@campo/core';

export type Scope = { kind: 'outdoor' } | { kind: 'building'; buildingId: string; level: number };

export const OUTDOOR: Scope = { kind: 'outdoor' };

export function nodeInScope(node: Pick<EditNode, 'props'>, scope: Scope): boolean {
  const p = node.props;
  return scope.kind === 'outdoor'
    ? p.building_id === null
    : p.building_id === scope.buildingId && p.level === scope.level;
}

/** Drawn strongly in this scope; everything else is faded. */
export function edgeInScope(state: Pick<EditState, 'nodes'>, edge: EditEdge, scope: Scope): boolean {
  const ends = [edge.props.from, edge.props.to].map((id) => state.nodes[id]).filter((n): n is EditNode => n !== undefined);
  if (scope.kind === 'outdoor') return ends.length > 0 && ends.every((n) => n.props.building_id === null);
  return ends.some((n) => nodeInScope(n, scope)); // includes stairs and elevators leaving this floor
}

export function buildingInScope(b: EditBuilding, scope: Scope): boolean {
  return scope.kind === 'outdoor' || b.id === scope.buildingId;
}

export function roomInScope(r: EditRoom, scope: Scope): boolean {
  return scope.kind === 'building' && r.props.building_id === scope.buildingId && r.props.level === scope.level;
}

/** "A동 3층", "A동 지하 1층", "바깥". */
export function scopeLabel(scope: Scope, state: Pick<EditState, 'buildings'>): string {
  if (scope.kind === 'outdoor') return '바깥';
  const b = Object.values(state.buildings).find((x) => x.id === scope.buildingId);
  return `${b?.props.name ?? scope.buildingId} ${floorLabel(scope.level)}`;
}

export function floorLabel(level: number): string {
  return level < 0 ? `지하 ${-level}층` : `${level}층`;
}
