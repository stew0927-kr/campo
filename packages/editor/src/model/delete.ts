// "삭제": a wrongly drawn point, edge or building, together with what would be left dangling.
// Removing a node without its edges (or a building without its contents) leaves the campus
// failing the §7-3 dangling-ref check, so the cleanup belongs to the same function.
import type { CampoFeature } from '@campo/core';
import type { CampusDoc } from './document.ts';

export interface DeleteResult {
  /** The document without the feature and without anything that existed only through it. */
  doc: CampusDoc;
  /** Every id removed, the chosen feature first. Empty when `featureId` is not in the document. */
  deletedIds: string[];
}

/**
 * Deletes one feature:
 * - a node takes every edge that has it as `from` or `to` (§7-3: an edge needs both ends);
 * - an edge takes only itself;
 * - a building takes the nodes and edges inside it, plus any bridge that names it
 *   (`building_from` / `building_to`), so the other side is not left pointing at nothing.
 * The document passed in is not changed; a new one comes back.
 */
export function deleteFeature(doc: CampusDoc, featureId: string): DeleteResult {
  const target = doc.features.get(featureId);
  if (!target) return { doc, deletedIds: [] };

  const doomed = new Set<string>([featureId]);
  if (target.properties.kind === 'node') {
    for (const f of doc.features.values()) {
      const p = f.properties;
      if (p.kind === 'edge' && (p.from === featureId || p.to === featureId)) doomed.add(f.id);
    }
  } else if (target.properties.kind === 'building') {
    for (const f of doc.features.values()) {
      const p = f.properties;
      if (p.kind === 'node' && p.building_id === featureId) doomed.add(f.id);
    }
    for (const f of doc.features.values()) {
      const p = f.properties;
      if (p.kind !== 'edge') continue;
      if (doomed.has(p.from) || doomed.has(p.to) || p.building_from === featureId || p.building_to === featureId) doomed.add(f.id);
    }
  }

  const features = new Map(doc.features);
  for (const id of doomed) features.delete(id);
  return { doc: { ...doc, features }, deletedIds: [...doomed] };
}

/** How many nodes, edges and buildings a `deleteFeature` result removes (for the notice text). */
export function countDeleted(doc: CampusDoc, deletedIds: readonly string[]): { nodes: number; edges: number; buildings: number } {
  const count = { nodes: 0, edges: 0, buildings: 0 };
  for (const id of deletedIds) {
    const f: CampoFeature | undefined = doc.features.get(id);
    if (!f) continue;
    if (f.properties.kind === 'node') count.nodes++;
    else if (f.properties.kind === 'edge') count.edges++;
    else count.buildings++;
  }
  return count;
}
