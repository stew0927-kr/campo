// What the 장소 고르기 sheet (ScopeSheet) shows: which buildings match the search, and which of them are unfolded.
// Plain TypeScript with no React Native import, so Node can test it.
import type { Scope } from '../model/scope.ts';

interface Searchable {
  id: string;
  props: { name: string; code: string };
}

/** Lower case with every space removed, so "제 1 공학관" finds "제1공학관" and "ab" finds "A B". */
export function normalizeQuery(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/** The buildings whose name or code contains the query. An empty query keeps them all, in the same order. */
export function filterBuildings<B extends Searchable>(buildings: readonly B[], query: string): B[] {
  const q = normalizeQuery(query);
  if (q === '') return [...buildings];
  return buildings.filter((b) => normalizeQuery(b.props.name).includes(q) || normalizeQuery(b.props.code).includes(q));
}

/** Folded to start with: only the building the surveyor is in, if any. */
export function initialExpanded(scope: Scope): ReadonlySet<string> {
  return new Set(scope.kind === 'building' ? [scope.buildingId] : []);
}

/** Pressing a building's header flips that building alone. */
export function toggleExpanded(expanded: ReadonlySet<string>, buildingId: string): ReadonlySet<string> {
  const next = new Set(expanded);
  if (!next.delete(buildingId)) next.add(buildingId);
  return next;
}

/** While searching, every match is open so its floors can be picked at once; otherwise the surveyor's own toggles rule. */
export function isExpanded(expanded: ReadonlySet<string>, buildingId: string, query: string): boolean {
  return normalizeQuery(query) !== '' || expanded.has(buildingId);
}
