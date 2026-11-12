// What the editor is looking at: outdoors, or one floor of one building (SPEC §8 지도 보기).
// Display and picking only: routing never uses this.
import type { EditBuilding, EditEdge, EditNode, EditRoom, EditState, Position } from '@campo/core';
import { buildingAt } from './building.ts';

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

// ---- Scope by where the pointer is (SPEC-v0.2 5.2) ----

/** The floor a click on an unfamiliar building lands on: its first ground floor, else its lowest. */
export function defaultLevel(b: EditBuilding): number {
  return b.props.ground_levels[0] ?? Math.min(...b.props.levels);
}

/**
 * The scope of something placed at `position`. Inside a building outline it is that building's floor: `shown`'s level when
 * `shown` is a floor of the same building, else the building's default floor. Outside it is the outdoors. `forceOutdoor`
 * (the O key held) always gives the outdoors (a roof path, under pilotis).
 */
export function scopeAt(state: Pick<EditState, 'buildings'>, position: Position, shown: Scope, forceOutdoor = false): Scope {
  if (forceOutdoor) return OUTDOOR;
  const b = buildingAt(state, position);
  if (!b) return OUTDOOR;
  if (shown.kind === 'building' && shown.buildingId === b.id) return shown;
  return { kind: 'building', buildingId: b.id, level: defaultLevel(b) };
}

export const sameScope = (a: Scope, b: Scope): boolean =>
  a.kind === b.kind && (a.kind === 'outdoor' || (b.kind === 'building' && a.buildingId === b.buildingId && a.level === b.level));

/**
 * Whether a drawn path in `scope` may attach to `node` (SPEC-v0.2 5.2): same scope only, plus entrances from the outdoors.
 * An entrance is also in its own floor's scope, so it attaches from both sides.
 */
export function snappable(node: Pick<EditNode, 'props'>, scope: Scope): boolean {
  return nodeInScope(node, scope) || (scope.kind === 'outdoor' && node.props.node_type === 'entrance');
}

/** Drawn strongly while `shown` is on screen: this floor, and the outdoors (outdoor ways stay visible from a floor). */
export function nodeStrong(node: Pick<EditNode, 'props'>, shown: Scope): boolean {
  return nodeInScope(node, shown) || node.props.building_id === null;
}

export function edgeStrong(state: Pick<EditState, 'nodes'>, edge: EditEdge, shown: Scope): boolean {
  if (edgeInScope(state, edge, shown)) return true;
  const ends = [edge.props.from, edge.props.to].map((id) => state.nodes[id]);
  return ends.length === 2 && ends.every((n) => n !== undefined && n.props.building_id === null);
}

/** Level shown after `[` (-1) or `]` (+1) on a floor of `b`: the neighbouring level in its list, or null at the end. */
export function levelStep(b: EditBuilding, level: number, dir: -1 | 1): number | null {
  const levels = [...b.props.levels].sort((x, y) => x - y);
  const i = levels.indexOf(level);
  return levels[i + dir] ?? null;
}
