// What the editor is looking at: outdoors, or one floor of one building (SPEC §8 지도 보기).
// Display and picking only: routing never uses this.
import type { CampoFeature, NodeFeature } from '@campo/core';
import type { CampusDoc } from './document.ts';

export type Scope = { kind: 'outdoor' } | { kind: 'building'; buildingId: string; level: number };

export const OUTDOOR: Scope = { kind: 'outdoor' };

export function nodeInScope(node: NodeFeature, scope: Scope): boolean {
  const p = node.properties;
  return scope.kind === 'outdoor'
    ? p.building_id === null
    : p.building_id === scope.buildingId && p.level === scope.level;
}

/** Drawn strongly in this scope; everything else is faded. */
export function inScope(feature: CampoFeature, scope: Scope, doc: Pick<CampusDoc, 'features'>): boolean {
  const p = feature.properties;
  if (p.kind === 'building') return scope.kind === 'outdoor' || feature.id === scope.buildingId;
  if (p.kind === 'node') return nodeInScope(feature as NodeFeature, scope);
  const ends = [p.from, p.to].map((id) => doc.features.get(id)).filter((n): n is NodeFeature => n?.properties.kind === 'node');
  if (scope.kind === 'outdoor') return ends.length > 0 && ends.every((n) => n.properties.building_id === null);
  return ends.some((n) => nodeInScope(n, scope)); // includes stairs and elevators leaving this floor
}

/** "A동 3층", "A동 지하 1층", "바깥". */
export function scopeLabel(scope: Scope, doc: Pick<CampusDoc, 'features'>): string {
  if (scope.kind === 'outdoor') return '바깥';
  const b = doc.features.get(scope.buildingId);
  const name = b?.properties.kind === 'building' ? b.properties.name : scope.buildingId;
  return `${name} ${floorLabel(scope.level)}`;
}

export function floorLabel(level: number): string {
  return level < 0 ? `지하 ${-level}층` : `${level}층`;
}
