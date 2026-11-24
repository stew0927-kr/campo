import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson';
import { edgeWidthM, type CampusGraph } from '@campo/core';

/** Outdoor way kinds drawn on the base map: plain walkway, stairs, ramp. */
export type OutdoorWayKind = 'walk' | 'stairs' | 'ramp';

const byId = (a: Feature, b: Feature) => String(a.properties?.['id']).localeCompare(String(b.properties?.['id']));

/**
 * Outdoor walkways for the default (outdoor) map. An edge counts only when both ends are outdoor nodes
 * (building_id null), it is not indoor/portal/bridge or an elevator, and it has a drawable geometry.
 * Bidirectional links are visited twice, so edges are de-duplicated by id. Sorted by id for stable output.
 */
export function outdoorLines(graph: CampusGraph | null): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  if (!graph) return { type: 'FeatureCollection', features };
  const outdoorNode = (id: string) => graph.nodes.get(id)?.properties.building_id === null;
  const seen = new Set<string>();
  graph.graph.forEachLink((link) => {
    if (!('edge' in link.data)) return;
    const edge = link.data.edge;
    if (seen.has(edge.id)) return;
    seen.add(edge.id);
    const p = edge.properties;
    if (!outdoorNode(p.from) || !outdoorNode(p.to)) return;
    if (p.edge_type !== undefined && p.edge_type !== 'outdoor') return;
    if (p.highway === 'elevator') return;
    if (edge.geometry.coordinates.length < 2) return;
    const kind: OutdoorWayKind = p.highway === 'steps' ? 'stairs' : p.highway === 'ramp' ? 'ramp' : 'walk';
    features.push({ type: 'Feature', properties: { id: edge.id, kind, width: edgeWidthM(p) }, geometry: edge.geometry });
  });
  features.sort(byId);
  return { type: 'FeatureCollection', features };
}

/** Plazas (평지) as fill polygons. Rings with fewer than 4 points are skipped; holes are kept. Sorted by id. */
export function outdoorPlazas(graph: CampusGraph | null): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  if (!graph) return { type: 'FeatureCollection', features };
  for (const plaza of graph.plazas.values()) {
    if ((plaza.geometry.coordinates[0]?.length ?? 0) < 4) continue;
    features.push({
      type: 'Feature',
      properties: { id: plaza.id, name: plaza.properties.name ?? null, surface: plaza.properties.surface ?? null },
      geometry: plaza.geometry,
    });
  }
  features.sort(byId);
  return { type: 'FeatureCollection', features };
}
