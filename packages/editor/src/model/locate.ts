// Where a feature is, so the 검사 tab can take the map there.
import type { CampoFeature, NodeFeature, Position } from '@campo/core';
import type { CampusDoc } from './document.ts';
import { getNode } from './ids.ts';
import { OUTDOOR, type Scope } from './scope.ts';

export function featureCenter(f: CampoFeature): Position {
  const g = f.geometry;
  if (g.type === 'Point') return g.coordinates;
  const pts = g.type === 'LineString' ? g.coordinates : (g.coordinates[0] ?? []);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** The floor to show for a feature: its own floor, or the lower floor of an edge (like the file layout). */
export function featureScope(f: CampoFeature, doc: Pick<CampusDoc, 'features'>): Scope {
  const p = f.properties;
  if (p.kind === 'building') return OUTDOOR;
  if (p.kind === 'room') return { kind: 'building', buildingId: p.building_id, level: p.level };
  const nodes: NodeFeature[] = p.kind === 'node' ? [f as NodeFeature] : [p.from, p.to].map((id) => getNode(doc, id)).filter((n): n is NodeFeature => !!n);
  const indoor = nodes.filter((n) => n.properties.building_id !== null && n.properties.level !== null);
  if (indoor.length === 0) return OUTDOOR;
  const lower = indoor.reduce((a, b) => (b.properties.level! < a.properties.level! ? b : a));
  return { kind: 'building', buildingId: lower.properties.building_id!, level: lower.properties.level! };
}
