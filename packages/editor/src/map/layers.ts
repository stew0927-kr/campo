// How saved data is drawn on the map. Display only: builds a throwaway GeoJSON from CampusDoc.
import type { FeatureCollection } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import type { CampusDoc } from '../model/document.ts';

export const DATA_SOURCE = 'campo-data';

/** Line colours per kind of way. Same values as the CSS tokens --footway / --steps / --ramp. */
export const WAY_COLORS = { footway: '#2463a6', steps: '#d4461a', ramp: '#1f8f68', other: '#5b6875' } as const;

export function toDisplayGeoJSON(doc: CampusDoc): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const f of doc.features.values()) {
    const p = f.properties;
    // Outdoor mode (SPEC §8): outdoor data and building outlines are drawn strongly.
    const outdoor = p.kind === 'building' || (p.kind === 'node' ? p.building_id === null : p.edge_type === 'outdoor' || p.edge_type === undefined);
    features.push({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry,
      properties: {
        id: f.id,
        kind: p.kind,
        highway: p.kind === 'edge' ? p.highway : null,
        node_type: p.kind === 'node' ? p.node_type : null,
        emphasis: outdoor ? 1 : 0,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

const wayColor = [
  'match', ['get', 'highway'],
  'footway', WAY_COLORS.footway,
  'steps', WAY_COLORS.steps,
  'ramp', WAY_COLORS.ramp,
  WAY_COLORS.other,
] as const;

const opacity = ['case', ['==', ['get', 'emphasis'], 1], 1, 0.25] as const;

export const DATA_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-buildings',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['==', ['get', 'kind'], 'building'],
    paint: { 'line-color': '#1e2933', 'line-width': 1.5, 'line-opacity': 0.7 },
  },
  {
    id: 'campo-edges-casing',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['==', ['get', 'kind'], 'edge'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': opacity as never },
  },
  {
    id: 'campo-edges',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', ['==', ['get', 'kind'], 'edge'], ['!=', ['get', 'highway'], 'steps']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': wayColor as never, 'line-width': 4, 'line-opacity': opacity as never },
  },
  {
    // Stairs: short heavy dashes, read as treads.
    id: 'campo-edges-steps',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', ['==', ['get', 'kind'], 'edge'], ['==', ['get', 'highway'], 'steps']],
    paint: { 'line-color': WAY_COLORS.steps, 'line-width': 6, 'line-dasharray': [0.6, 0.5], 'line-opacity': opacity as never },
  },
  {
    id: 'campo-nodes',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['==', ['get', 'kind'], 'node'],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'node_type'], 'poi'], 6, 4],
      'circle-color': '#ffffff',
      'circle-stroke-color': '#1e2933',
      'circle-stroke-width': 2,
      'circle-opacity': opacity as never,
      'circle-stroke-opacity': opacity as never,
    },
  },
];
