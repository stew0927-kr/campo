// How saved data is drawn on the map. Display only: builds a throwaway GeoJSON from CampusDoc.
import type { FeatureCollection } from 'geojson';
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import type { Position, Profile } from '@campo/core';
import type { CampusDoc } from '../model/document.ts';
import { inScope, type Scope } from '../model/scope.ts';

export const DATA_SOURCE = 'campo-data';

/** Line colours per kind of way. Same values as the CSS tokens --footway / --steps / --ramp. */
export const WAY_COLORS = { footway: '#2463a6', corridor: '#3d4c5a', steps: '#d4461a', ramp: '#1f8f68', elevator: '#6a4fc4', other: '#5b6875' } as const;

export function toDisplayGeoJSON(doc: CampusDoc, scope: Scope, highlight: ReadonlySet<string> = new Set()): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const f of doc.features.values()) {
    const p = f.properties;
    features.push({
      type: 'Feature',
      id: f.id,
      geometry: f.geometry,
      properties: {
        id: f.id,
        kind: p.kind,
        highway: p.kind === 'edge' ? p.highway : null,
        node_type: p.kind === 'node' ? p.node_type : null,
        classroom: p.kind === 'node' && p.node_type === 'door' && (p.space_name !== undefined || p.ref !== undefined),
        emphasis: inScope(f, scope, doc) ? 1 : 0,
        selected: scope.kind === 'building' && f.id === scope.buildingId,
        highlight: highlight.has(f.id),
      },
    });
  }
  // Strong features last, so they draw above faded ones at the same spot (stacked elevator stops).
  features.sort((a, b) => Number(a.properties!['emphasis']) - Number(b.properties!['emphasis']));
  return { type: 'FeatureCollection', features };
}

const strong: ExpressionSpecification = ['==', ['get', 'emphasis'], 1];
const opacity: ExpressionSpecification = ['case', strong, 1, 0.18];
const isEdge: ExpressionSpecification = ['==', ['get', 'kind'], 'edge'];
const isNode: ExpressionSpecification = ['==', ['get', 'kind'], 'node'];

const wayColor = [
  'match', ['get', 'highway'],
  'footway', WAY_COLORS.footway,
  'corridor', WAY_COLORS.corridor,
  'steps', WAY_COLORS.steps,
  'ramp', WAY_COLORS.ramp,
  'elevator', WAY_COLORS.elevator,
  WAY_COLORS.other,
] as const;

const nodeColor = [
  'match', ['get', 'node_type'],
  'entrance', '#1f8f68',
  'elevator_stop', WAY_COLORS.elevator,
  'stair_landing', WAY_COLORS.steps,
  'poi', '#1e2933',
  '#ffffff',
] as const;

export const DATA_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-buildings-fill',
    type: 'fill',
    source: DATA_SOURCE,
    filter: ['==', ['get', 'kind'], 'building'],
    paint: { 'fill-color': '#1e2933', 'fill-opacity': ['case', ['get', 'selected'], 0.08, 0.03] as never },
  },
  {
    id: 'campo-buildings',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['==', ['get', 'kind'], 'building'],
    paint: {
      'line-color': '#1e2933',
      'line-width': ['case', ['get', 'selected'], 2.5, 1.5] as never,
      'line-opacity': ['case', strong, 0.8, 0.3] as never,
    },
  },
  {
    id: 'campo-edges-casing',
    type: 'line',
    source: DATA_SOURCE,
    filter: isEdge,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': opacity },
  },
  {
    id: 'campo-edges',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', isEdge, ['!=', ['get', 'highway'], 'steps']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': wayColor as never, 'line-width': 4, 'line-opacity': opacity },
  },
  {
    // Stairs: short heavy dashes, read as treads.
    id: 'campo-edges-steps',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', isEdge, ['==', ['get', 'highway'], 'steps']],
    paint: { 'line-color': WAY_COLORS.steps, 'line-width': 6, 'line-dasharray': [0.6, 0.5], 'line-opacity': opacity },
  },
  {
    id: 'campo-nodes-highlight',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['get', 'highlight']],
    paint: { 'circle-radius': 11, 'circle-color': '#f2b705', 'circle-opacity': 0.55 },
  },
  {
    id: 'campo-nodes',
    type: 'circle',
    source: DATA_SOURCE,
    filter: isNode,
    paint: {
      'circle-radius': ['case', ['any', ['==', ['get', 'node_type'], 'poi'], ['get', 'classroom']], 6, 4.5] as never,
      'circle-color': ['case', ['get', 'classroom'], '#2463a6', nodeColor] as never,
      'circle-stroke-color': '#1e2933',
      'circle-stroke-width': 2,
      'circle-opacity': opacity,
      'circle-stroke-opacity': opacity,
    },
  },
];

// ---- Routes (길찾기 tab) ----

export const ROUTE_SOURCE = 'campo-routes';
/** Same values as the CSS tokens --route-shortest / --route-step-free. */
/** The two routes the 길찾기 tab shows; core's fewest_steps only appears as the step_free fallback. */
export type EditorProfile = Extract<Profile, 'shortest' | 'step_free'>;
export const ROUTE_COLORS: Record<EditorProfile, string> = { shortest: '#c2255c', step_free: '#0b7285' };

export interface RouteLine {
  profile: EditorProfile;
  coordinates: Position[];
}

export function routesGeoJSON(routes: readonly RouteLine[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.filter((r) => r.coordinates.length >= 2).map((r) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: r.coordinates },
      properties: { profile: r.profile },
    })),
  };
}

const routeColor: ExpressionSpecification = ['match', ['get', 'profile'], 'shortest', ROUTE_COLORS.shortest, ROUTE_COLORS.step_free];
/** Side by side where both routes share a path, so neither hides the other. */
const routeOffset: ExpressionSpecification = ['match', ['get', 'profile'], 'shortest', -5, 5];

export const ROUTE_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-routes',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': routeColor, 'line-width': 7, 'line-opacity': 0.85, 'line-offset': routeOffset },
  },
];
