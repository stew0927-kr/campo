// Where the surveyor is: outdoors, or on one floor of one building. Display and recording only: routing never uses this.
import type { EditBuilding, EditNode, EditState } from '@campo/core';

export type Scope = { kind: 'outdoor' } | { kind: 'building'; buildingId: string; level: number };

export const OUTDOOR: Scope = { kind: 'outdoor' };

export function sameScope(a: Scope, b: Scope): boolean {
  if (a.kind === 'outdoor' || b.kind === 'outdoor') return a.kind === b.kind;
  return a.buildingId === b.buildingId && a.level === b.level;
}

/** The building_id / level pair a node of this scope carries. */
export function scopeProps(scope: Scope): { building_id: string | null; level: number | null } {
  return scope.kind === 'outdoor' ? { building_id: null, level: null } : { building_id: scope.buildingId, level: scope.level };
}

export function scopeOfNode(node: Pick<EditNode, 'props'>): Scope {
  const { building_id, level } = node.props;
  return building_id === null || level === null ? OUTDOOR : { kind: 'building', buildingId: building_id, level };
}

export function nodeInScope(node: Pick<EditNode, 'props'>, scope: Scope): boolean {
  return sameScope(scopeOfNode(node), scope);
}

/** "3층", "지하 1층". */
export function floorLabel(level: number): string {
  return level < 0 ? `지하 ${-level}층` : `${level}층`;
}

/** "제1공학관 3층", "바깥". */
export function scopeLabel(scope: Scope, state: Pick<EditState, 'buildings'>): string {
  if (scope.kind === 'outdoor') return '바깥';
  const b = Object.values(state.buildings).find((x) => x.id === scope.buildingId);
  return `${b?.props.name ?? scope.buildingId} ${floorLabel(scope.level)}`;
}

/** The floor shown first for a building: its first ground floor, else its lowest. */
export function defaultLevel(b: EditBuilding): number {
  return b.props.ground_levels[0] ?? Math.min(...b.props.levels);
}
