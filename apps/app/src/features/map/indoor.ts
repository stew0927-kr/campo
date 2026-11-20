import type { FeatureCollection, LineString } from 'geojson';
import type { CampusGraph } from '@campo/core';
import type { CampusRouteView } from '../../contracts.ts';
export function floorLines(graph: CampusGraph | null, buildingId: string | null, level: number | null, route: CampusRouteView | null): FeatureCollection<LineString> {
  const features: FeatureCollection<LineString>['features'] = [];
  if (!graph || buildingId === null) return { type: 'FeatureCollection', features };
  const belongs = (id: string) => {
    const node = graph.nodes.get(id);
    return node?.properties.building_id === buildingId && node.properties.level === level;
  };
  const used = new Set<string>();
  graph.graph.forEachLink((link) => {
    if (!('edge' in link.data)) return;
    const edge = link.data.edge;
    if (used.has(edge.id) || !belongs(edge.properties.from) || !belongs(edge.properties.to)) return;
    used.add(edge.id);
    features.push({ type: 'Feature', properties: { route: false }, geometry: edge.geometry });
  });
  route?.nodeIds.slice(1).forEach((id, index) => {
    const previous = route.nodeIds[index]!;
    if (!belongs(id) || !belongs(previous)) return;
    features.push({ type: 'Feature', properties: { route: true }, geometry: { type: 'LineString', coordinates: [graph.nodes.get(previous)!.geometry.coordinates, graph.nodes.get(id)!.geometry.coordinates] } });
  });
  return { type: 'FeatureCollection', features };
}
