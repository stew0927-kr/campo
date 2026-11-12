// How the edit state is drawn on the map. Display only: builds a throwaway GeoJSON from the EditState.
import type { FeatureCollection } from 'geojson';
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { edgeCoords, edgesAt, movedTogether, type EditNode, type EditState, type Position, type Profile } from '@campo/core';
import { unattachedIds } from '../model/connect.ts';
import { edgeMidpoint } from '../model/split.ts';
import { buildingInScope, edgeStrong, nodeStrong, roomInScope, type Scope } from '../model/scope.ts';

export const DATA_SOURCE = 'campo-data';

/** Line colours per kind of way. Same values as the CSS tokens --footway / --steps / --ramp. */
export const WAY_COLORS = { footway: '#2463a6', corridor: '#3d4c5a', steps: '#d4461a', ramp: '#1f8f68', elevator: '#6a4fc4', other: '#5b6875' } as const;

/** Name of the restroom icon (icons.ts): gender and wheelchair access, so both read on the map. */
export const restroomIcon = (n: EditNode): string =>
  n.props.node_type === 'restroom' ? `restroom-${n.props.restroom_gender ?? 'unisex'}-${n.props.wheelchair ?? 'unknown'}` : '';

const isClassroom = (n: EditNode) => n.props.node_type === 'door' && (n.props.space_name !== undefined || n.props.ref !== undefined);

export function toDisplayGeoJSON(state: EditState, scope: Scope, highlight: ReadonlySet<string> = new Set()): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const b of Object.values(state.buildings)) {
    features.push({
      type: 'Feature',
      id: b.id,
      geometry: { type: 'Polygon', coordinates: b.polygon },
      properties: {
        id: b.id, kind: 'building', highway: null, node_type: null, classroom: false,
        emphasis: buildingInScope(b, scope) ? 1 : 0, selected: scope.kind === 'building' && b.id === scope.buildingId, highlight: highlight.has(b.id),
      },
    });
  }
  for (const r of Object.values(state.rooms)) {
    features.push({
      type: 'Feature',
      id: r.id,
      geometry: { type: 'Polygon', coordinates: r.polygon },
      properties: { id: r.id, kind: 'room', highway: null, node_type: null, classroom: false, emphasis: roomInScope(r, scope) ? 1 : 0, selected: false, highlight: highlight.has(r.id) },
    });
  }
  for (const e of Object.values(state.edges)) {
    if (!state.nodes[e.props.from] || !state.nodes[e.props.to]) continue;
    features.push({
      type: 'Feature',
      id: e.id,
      geometry: { type: 'LineString', coordinates: edgeCoords(state, e) },
      properties: {
        id: e.id, kind: 'edge', highway: e.props.highway, node_type: null, classroom: false,
        emphasis: edgeStrong(state, e, scope) ? 1 : 0, selected: false, highlight: highlight.has(e.id),
      },
    });
    if (highlight.has(e.id)) {
      // The handle in the middle of a selected edge: dragging it makes a new node there (SPEC-v0.2 5.1).
      const mid = edgeMidpoint(state, e.id);
      if (mid) features.push({ type: 'Feature', id: `handle:${e.id}`, geometry: { type: 'Point', coordinates: mid }, properties: { id: e.id, kind: 'handle', highway: null, node_type: null, classroom: false, emphasis: 1, selected: false, highlight: false } });
    }
  }
  const waiting = unattachedIds(state);
  for (const n of Object.values(state.nodes)) {
    features.push({
      type: 'Feature',
      id: n.id,
      geometry: { type: 'Point', coordinates: n.coord },
      properties: {
        id: n.id, kind: 'node', highway: null, node_type: n.props.node_type, classroom: isClassroom(n),
        emphasis: nodeStrong(n, scope) ? 1 : 0, selected: false, highlight: highlight.has(n.id),
        unattached: waiting.has(n.id), icon: restroomIcon(n),
      },
    });
  }
  // Strong features last, so they draw above faded ones at the same spot (stacked elevator stops).
  features.sort((a, b) => Number(a.properties!['emphasis']) - Number(b.properties!['emphasis']));
  return { type: 'FeatureCollection', features };
}

// ---- Dragging a node: a small temporary source (the node and the edges on it) ----

export const DRAG_SOURCE = 'campo-drag';

/** The nodes a drag moves (an elevator stop moves with its shaft) and the edges on them. */
export function dragMembers(state: EditState, nodeId: string): { nodes: EditNode[]; edgeIds: string[] } {
  const nodes = movedTogether(state, nodeId);
  const edgeIds = [...new Set(nodes.flatMap((n) => edgesAt(state, n.id).map((e) => e.id)))].sort();
  return { nodes, edgeIds };
}

/** The dragged node(s) and their edges as they are now (edges follow by construction), plus a ring on the drop target. */
export function dragGeoJSON(state: EditState, nodeId: string, target?: Position | null): FeatureCollection {
  const { nodes, edgeIds } = dragMembers(state, nodeId);
  const features: FeatureCollection['features'] = [];
  for (const id of edgeIds) {
    const e = state.edges[id]!;
    if (!state.nodes[e.props.from] || !state.nodes[e.props.to]) continue;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: edgeCoords(state, e) }, properties: { role: 'edge', highway: e.props.highway } });
  }
  for (const n of nodes) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: n.coord }, properties: { role: 'node', node_type: n.props.node_type, classroom: isClassroom(n) } });
  }
  if (target) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: target }, properties: { role: 'target' } });
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
      'line-color': ['case', ['get', 'highlight'], '#f2b705', '#1e2933'] as never,
      'line-width': ['case', ['get', 'highlight'], 4, ['get', 'selected'], 2.5, 1.5] as never,
      'line-opacity': ['case', strong, 0.8, 0.3] as never,
    },
  },
  {
    // Selected edges: a yellow halo under the line.
    id: 'campo-edges-highlight',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', isEdge, ['get', 'highlight']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#f2b705', 'line-width': 13, 'line-opacity': 0.6 },
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

/** Warning colour of the ring round an unattached point (SPEC-v0.2 6.5). Same value as the CSS token --warn-ring. */
export const UNATTACHED_COLOR = '#e8590c';

DATA_LAYERS.push(
  {
    id: 'campo-nodes-unattached',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['==', ['get', 'unattached'], true], strong],
    paint: { 'circle-radius': 17, 'circle-color': UNATTACHED_COLOR, 'circle-opacity': 0.12, 'circle-stroke-color': UNATTACHED_COLOR, 'circle-stroke-width': 3, 'circle-stroke-opacity': opacity },
  },
  {
    id: 'campo-restrooms',
    type: 'symbol',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['!=', ['get', 'icon'], '']],
    layout: { 'icon-image': ['get', 'icon'], 'icon-size': 0.8, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-opacity': opacity },
  },
  {
    id: 'campo-handles',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['==', ['get', 'kind'], 'handle'],
    paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': '#7a5a00', 'circle-stroke-width': 2 },
  },
);

/** While a node is dragged the main source still holds its old place: hide the node and its edges there. */
export function hideInData(ids: readonly string[]): Map<string, ExpressionSpecification | undefined> {
  const out = new Map<string, ExpressionSpecification | undefined>();
  for (const layer of DATA_LAYERS) {
    const base = (layer as { filter?: ExpressionSpecification }).filter;
    out.set(layer.id, ids.length === 0 || !base ? base : ['all', base, ['!', ['in', ['get', 'id'], ['literal', [...ids]]]]] as ExpressionSpecification);
  }
  return out;
}

// ---- Drag layers: above everything while a node is being dragged ----

export const DRAG_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-drag-edges-casing',
    type: 'line',
    source: DRAG_SOURCE,
    filter: ['==', ['get', 'role'], 'edge'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 7 },
  },
  {
    id: 'campo-drag-edges',
    type: 'line',
    source: DRAG_SOURCE,
    filter: ['==', ['get', 'role'], 'edge'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': wayColor as never, 'line-width': 4 },
  },
  {
    id: 'campo-drag-target',
    type: 'circle',
    source: DRAG_SOURCE,
    filter: ['==', ['get', 'role'], 'target'],
    paint: { 'circle-radius': 12, 'circle-color': '#f2b705', 'circle-opacity': 0.5 },
  },
  {
    id: 'campo-drag-nodes',
    type: 'circle',
    source: DRAG_SOURCE,
    filter: ['==', ['get', 'role'], 'node'],
    paint: { 'circle-radius': 6, 'circle-color': ['case', ['get', 'classroom'], '#2463a6', nodeColor] as never, 'circle-stroke-color': '#1e2933', 'circle-stroke-width': 2 },
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

// ---- Preview (문 연속 찍기, 강의실 줄): the foot of the perpendicular, its link, the doors a row would place ----

export const PREVIEW_SOURCE = 'campo-preview';

export function previewGeoJSON(...parts: (FeatureCollection | null | undefined)[]): FeatureCollection {
  return { type: 'FeatureCollection', features: parts.flatMap((p) => p?.features ?? []) };
}

export const PREVIEW_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-preview-link',
    type: 'line',
    source: PREVIEW_SOURCE,
    filter: ['==', ['get', 'role'], 'link'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#1e2933', 'line-width': 2.5, 'line-dasharray': [1.5, 1] },
  },
  {
    id: 'campo-preview-foot',
    type: 'circle',
    source: PREVIEW_SOURCE,
    filter: ['==', ['get', 'role'], 'foot'],
    paint: { 'circle-radius': 6, 'circle-color': '#f2b705', 'circle-stroke-color': '#1e2933', 'circle-stroke-width': 2 },
  },
  {
    id: 'campo-preview-doors',
    type: 'circle',
    source: PREVIEW_SOURCE,
    filter: ['match', ['get', 'role'], ['door', 'back'], true, false],
    paint: {
      'circle-radius': 6,
      'circle-color': ['match', ['get', 'role'], 'back', '#0b7285', '#2463a6'] as never,
      'circle-opacity': 0.75,
      'circle-stroke-color': '#1e2933',
      'circle-stroke-width': 2,
    },
  },
];
