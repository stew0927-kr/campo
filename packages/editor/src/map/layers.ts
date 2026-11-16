// How the edit state is drawn on the map. Display only: builds a throwaway GeoJSON from the EditState.
import type { FeatureCollection } from 'geojson';
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { PICTOGRAM_COLORS, beltEndIds, closeRing, edgeCoords, outlineOfLevel, edgesAt, movedTogether, pictogramOf, type EditNode, type EditState, type PictogramKind, type Position, type Profile, type Wheelchair } from '@campo/core';
import { unattachedIds } from '../model/connect.ts';
import { edgeMidpoint } from '../model/split.ts';
import { PAIR_OFFSET_PX, pairOffsets } from '../model/pairs.ts';
import { buildingInScope, edgeStrong, nodeStrong, roomInScope, type Scope } from '../model/scope.ts';
import type { RouteRef } from '../model/terrain3d.ts';

export const DATA_SOURCE = 'campo-data';

/** Line colours per kind of way. Same values as the CSS tokens --footway / --steps / --ramp. */
export const WAY_COLORS = { footway: '#2463a6', corridor: '#3d4c5a', steps: '#d4461a', ramp: '#1f8f68', elevator: '#6a4fc4', other: '#5b6875' } as const;

/** Image id of a point badge (icons.ts registerPictograms); a restroom's carries its wheelchair answer too. */
export const pictogramImage = (kind: PictogramKind, wheelchair: Wheelchair | null): string => (wheelchair ? `pict-${kind}-${wheelchair}` : `pict-${kind}`);

/** The badge a point is drawn with (core pictogramOf), or '' for a plain dot. */
export function nodeIcon(n: EditNode, beltEnds: ReadonlySet<string>): string {
  const kind = pictogramOf(n, beltEnds);
  if (kind === null) return '';
  return pictogramImage(kind, n.props.node_type === 'restroom' ? n.props.wheelchair ?? 'unknown' : null);
}

const isClassroom = (n: EditNode) => n.props.node_type === 'door' && (n.props.space_name !== undefined || n.props.ref !== undefined);

/**
 * Display properties of a moving belt (escalator, moving walkway): `conveying` ('' when none), the side of a pair (`pairOffset`, -1 / 0 / +1),
 * and the arrow that shows the way it moves. The arrow symbol follows the line but not line-offset, so its own offset is given here:
 * in the icon's frame (turned half round for backward) down is the right-hand side of the arrow's heading.
 */
function beltProps(conveying: string | undefined, pairOffset: number): Record<string, string | number> {
  const px = pairOffset * PAIR_OFFSET_PX;
  if (conveying === undefined) return { conveying: '', pairOffset: 0, arrow: '', arrowRot: 0, arrowOffset: 0 };
  const backward = conveying === 'backward';
  return {
    conveying, pairOffset,
    arrow: conveying === 'reversible' ? 'belt-arrow-both' : 'belt-arrow',
    arrowRot: backward ? 180 : 0,
    arrowOffset: backward ? -px : px,
  };
}

/** `broken`: points 끊긴 지점 찾기 reports; they get a ring. */
export function toDisplayGeoJSON(state: EditState, scope: Scope, highlight: ReadonlySet<string> = new Set(), broken: ReadonlySet<string> = new Set()): FeatureCollection {
  const features: FeatureCollection['features'] = [];
  for (const b of Object.values(state.buildings)) {
    features.push({
      type: 'Feature',
      id: b.id,
      // The floor shown is drawn with its own outline when it has one (floor_outlines), the others with the building's.
      geometry: { type: 'Polygon', coordinates: scope.kind === 'building' && scope.buildingId === b.id ? outlineOfLevel(b, scope.level) : b.polygon },
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
  const pairs = pairOffsets(state);
  for (const e of Object.values(state.edges)) {
    if (!state.nodes[e.props.from] || !state.nodes[e.props.to]) continue;
    features.push({
      type: 'Feature',
      id: e.id,
      geometry: { type: 'LineString', coordinates: edgeCoords(state, e) },
      properties: {
        id: e.id, kind: 'edge', highway: e.props.highway, node_type: null, classroom: false,
        emphasis: edgeStrong(state, e, scope) ? 1 : 0, selected: false, highlight: highlight.has(e.id),
        ...beltProps(e.props.conveying, pairs.get(e.id) ?? 0),
      },
    });
    if (highlight.has(e.id)) {
      // The handle in the middle of a selected edge: dragging it makes a new node there (SPEC-v0.2 5.1).
      const mid = edgeMidpoint(state, e.id);
      if (mid) features.push({ type: 'Feature', id: `handle:${e.id}`, geometry: { type: 'Point', coordinates: mid }, properties: { id: e.id, kind: 'handle', highway: null, node_type: null, classroom: false, emphasis: 1, selected: false, highlight: false } });
    }
  }
  const waiting = unattachedIds(state);
  const beltEnds = beltEndIds(state);
  for (const n of Object.values(state.nodes)) {
    features.push({
      type: 'Feature',
      id: n.id,
      geometry: { type: 'Point', coordinates: n.coord },
      properties: {
        id: n.id, kind: 'node', highway: null, node_type: n.props.node_type, classroom: isClassroom(n),
        emphasis: nodeStrong(n, scope) ? 1 : 0, selected: false, highlight: highlight.has(n.id),
        unattached: waiting.has(n.id), icon: nodeIcon(n, beltEnds), synced: n.props.sync_group !== undefined, broken: broken.has(n.id),
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
const isBelt: ExpressionSpecification = ['!=', ['get', 'conveying'], ''];
/** A point drawn as a pictogram badge rather than a dot. */
const hasIcon: ExpressionSpecification = ['!=', ['get', 'icon'], ''];
/** Pixels to move an edge aside so a pair of escalators between the same two points shows both. */
/** icon-offset of a belt arrow: [0, px] for the few sides a pair can have (a match, because an offset cannot be built from a number at run time). */
const arrowShift = ['match', ['get', 'arrowOffset'],
  ...[-2, -1, 1, 2].flatMap((side) => [side * PAIR_OFFSET_PX, ['literal', [0, side * PAIR_OFFSET_PX]]]),
  ['literal', [0, 0]],
] as unknown as ExpressionSpecification;
const pairShift: ExpressionSpecification = ['*', ['get', 'pairOffset'], PAIR_OFFSET_PX];

const wayColor = [
  'match', ['get', 'highway'],
  'footway', WAY_COLORS.footway,
  'corridor', WAY_COLORS.corridor,
  'steps', WAY_COLORS.steps,
  'ramp', WAY_COLORS.ramp,
  'elevator', WAY_COLORS.elevator,
  WAY_COLORS.other,
] as const;

/** Dot colours (a dragged point, a POI): the typed points take their badge colour. */
const nodeColor = [
  'match', ['get', 'node_type'],
  'entrance', PICTOGRAM_COLORS.entrance,
  'elevator_stop', PICTOGRAM_COLORS.elevator,
  'stair_landing', PICTOGRAM_COLORS.stairs,
  'restroom', PICTOGRAM_COLORS.restroom_all,
  'door', PICTOGRAM_COLORS.door,
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
    paint: { 'line-color': '#f2b705', 'line-width': 13, 'line-opacity': 0.6, 'line-offset': pairShift },
  },
  {
    id: 'campo-edges-casing',
    type: 'line',
    source: DATA_SOURCE,
    filter: isEdge,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': opacity, 'line-offset': pairShift },
  },
  {
    id: 'campo-edges',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', isEdge, ['!=', ['get', 'highway'], 'steps']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': wayColor as never, 'line-width': 4, 'line-opacity': opacity, 'line-offset': pairShift },
  },
  {
    // Stairs: short heavy dashes, read as treads.
    id: 'campo-edges-steps',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', isEdge, ['==', ['get', 'highway'], 'steps'], ['!', isBelt]],
    paint: { 'line-color': WAY_COLORS.steps, 'line-width': 6, 'line-dasharray': [0.6, 0.5], 'line-opacity': opacity },
  },
  {
    // Escalators: the same colour as stairs, but a solid belt with an arrow for the way it runs.
    id: 'campo-edges-escalator',
    type: 'line',
    source: DATA_SOURCE,
    filter: ['all', isEdge, ['==', ['get', 'highway'], 'steps'], isBelt],
    layout: { 'line-cap': 'butt' },
    paint: { 'line-color': WAY_COLORS.steps, 'line-width': 6, 'line-opacity': opacity, 'line-offset': pairShift },
  },
  {
    id: 'campo-belt-arrows',
    type: 'symbol',
    source: DATA_SOURCE,
    filter: ['all', isEdge, isBelt],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 48,
      'icon-image': ['get', 'arrow'],
      'icon-rotate': ['get', 'arrowRot'],
      'icon-offset': arrowShift,
      'icon-rotation-alignment': 'map',
      'icon-size': 1,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': opacity },
  },
  {
    id: 'campo-nodes-highlight',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['get', 'highlight']],
    paint: { 'circle-radius': ['case', hasIcon, 18, 11] as never, 'circle-color': '#f2b705', 'circle-opacity': 0.55 },
  },
  {
    // Plain points (corridor, outdoor, classroom-less POIs); typed points are badges (campo-pictograms).
    id: 'campo-nodes',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['!', hasIcon]],
    paint: {
      'circle-radius': ['case', ['any', ['==', ['get', 'node_type'], 'poi'], ['get', 'classroom']], 6, 4.5] as never,
      'circle-color': ['case', ['get', 'classroom'], PICTOGRAM_COLORS.door, nodeColor] as never,
      'circle-stroke-color': '#1e2933',
      'circle-stroke-width': 2,
      'circle-opacity': opacity,
      'circle-stroke-opacity': opacity,
    },
  },
];

/** Ring of a point linked to other floors. Same value as the CSS token --sync. */
export const SYNC_COLOR = '#0b7285';
/** Ring of a broken point (끊긴 지점 찾기). Same value as the CSS token --broken. */
export const BROKEN_COLOR = '#d6336c';

/** Warning colour of the ring round an unattached point (SPEC-v0.2 6.5). Same value as the CSS token --warn-ring. */
export const UNATTACHED_COLOR = '#e8590c';

DATA_LAYERS.push(
  {
    id: 'campo-nodes-unattached',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['==', ['get', 'unattached'], true], strong],
    paint: { 'circle-radius': ['case', hasIcon, 19, 17] as never, 'circle-color': UNATTACHED_COLOR, 'circle-opacity': 0.12, 'circle-stroke-color': UNATTACHED_COLOR, 'circle-stroke-width': 3, 'circle-stroke-opacity': opacity },
  },
  {
    // Linked to the same spot on other floors (sync_group): a thin ring round the point.
    id: 'campo-nodes-synced',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['==', ['get', 'synced'], true], strong],
    paint: { 'circle-radius': ['case', hasIcon, 15.5, 9] as never, 'circle-color': SYNC_COLOR, 'circle-opacity': 0, 'circle-stroke-color': SYNC_COLOR, 'circle-stroke-width': 1.5 },
  },
  {
    // 끊긴 지점 찾기: a route cannot use this point. Drawn on every floor that is shown strongly, and outdoors.
    id: 'campo-nodes-broken',
    type: 'circle',
    source: DATA_SOURCE,
    filter: ['all', isNode, ['==', ['get', 'broken'], true], strong],
    paint: { 'circle-radius': ['case', hasIcon, 18, 14] as never, 'circle-color': BROKEN_COLOR, 'circle-opacity': 0.14, 'circle-stroke-color': BROKEN_COLOR, 'circle-stroke-width': 3.5 },
  },
  {
    // Stairs, elevators, escalator ends, restrooms, entrances and room doors (core pictograms.ts). Smaller when zoomed out.
    id: 'campo-pictograms',
    type: 'symbol',
    source: DATA_SOURCE,
    filter: ['all', isNode, hasIcon],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 16, 0.62, 19, 1] as never,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
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
    paint: { 'circle-radius': 6, 'circle-color': ['case', ['get', 'classroom'], PICTOGRAM_COLORS.door, nodeColor] as never, 'circle-stroke-color': '#1e2933', 'circle-stroke-width': 2 },
  },
];

// ---- Routes (길찾기 tab) ----

export const ROUTE_SOURCE = 'campo-routes';
/** 경로 테스트 ends: the 출발 pin green, the 도착 pin red (icons.ts draws the pins). */
export const ROUTE_PIN_COLORS = { start: '#2b8a3e', end: '#e03131' } as const;
/** The routes the 경로 테스트 tab draws (core profiles; fewest_steps only appears as the step_free fallback). */
export type EditorProfile = Extract<Profile, 'shortest' | 'step_free' | 'elevator_first' | 'wheelchair'>;
/** Same values as the CSS tokens --route-shortest / --route-step-free / --route-elevator / --route-wheelchair. */
export const ROUTE_COLORS: Record<EditorProfile, string> = { shortest: '#c2255c', step_free: '#0b7285', elevator_first: '#e67700', wheelchair: '#5f3dc4' };

export interface RouteLine {
  /**
   * 'snap': the dashed line between a picked end (the pin) and the foot of the perpendicular on the route.
   * 'start' / 'end': the 출발 / 도착 pin, one position.
   */
  profile: EditorProfile | 'snap' | 'start' | 'end';
  coordinates: Position[];
  /** What each coordinate stands on, for the 3D view (map/deck3d.ts); without it every point is on the ground. */
  refs?: RouteRef[];
}

export function routesGeoJSON(routes: readonly RouteLine[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap((r): FeatureCollection['features'] => {
      if (r.profile === 'start' || r.profile === 'end') {
        return r.coordinates[0] ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: r.coordinates[0] }, properties: { profile: r.profile } }] : [];
      }
      return r.coordinates.length >= 2 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: r.coordinates }, properties: { profile: r.profile } }] : [];
    }),
  };
}

const routeColor: ExpressionSpecification = [
  'match', ['get', 'profile'],
  'shortest', ROUTE_COLORS.shortest, 'elevator_first', ROUTE_COLORS.elevator_first, 'wheelchair', ROUTE_COLORS.wheelchair,
  ROUTE_COLORS.step_free,
];
/** Side by side where routes share a path, so none hides another. */
const routeOffset: ExpressionSpecification = ['match', ['get', 'profile'], 'shortest', -6, 'elevator_first', 6, 0];

export const ROUTE_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-routes',
    type: 'line',
    source: ROUTE_SOURCE,
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'profile'], 'snap']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': routeColor, 'line-width': 6, 'line-opacity': 0.85, 'line-offset': routeOffset },
  },
  {
    id: 'campo-routes-snap',
    type: 'line',
    source: ROUTE_SOURCE,
    filter: ['==', ['get', 'profile'], 'snap'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#1e2933', 'line-width': 2.5, 'line-opacity': 0.85, 'line-dasharray': [1, 1.4] },
  },
  {
    // The exact spot under each pin's tip.
    id: 'campo-routes-end-dot',
    type: 'circle',
    source: ROUTE_SOURCE,
    filter: ['match', ['get', 'profile'], ['start', 'end'], true, false],
    paint: {
      'circle-radius': 3.5,
      'circle-color': ['match', ['get', 'profile'], 'start', ROUTE_PIN_COLORS.start, ROUTE_PIN_COLORS.end],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  },
  {
    id: 'campo-routes-pins',
    type: 'symbol',
    source: ROUTE_SOURCE,
    filter: ['match', ['get', 'profile'], ['start', 'end'], true, false],
    layout: {
      'icon-image': ['match', ['get', 'profile'], 'start', 'route-start', 'route-end'],
      'icon-anchor': 'bottom',
      'icon-offset': [0, -2],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  },
];

// ---- Preview (호실 연속 입력, 강의실 자동 연결): the foot of the perpendicular, its link, the doors a row would place ----

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

// ---- 고도: break lines (drawn ones and the campus edges that act as one) and the slope parts of the routes shown ----

export const ELEVATION_SOURCE = 'campo-elevation';
/** Same values as the CSS tokens --breakline / --slope-caution / --slope-steep. */
export const ELEVATION_COLORS = { breakline: '#6b4423', caution: '#d9a100', steep: '#c92a2a' } as const;

export interface BreaklineShape {
  /** 'drawn': ElevationStore.breaklines (고도 단절선 그리기); 'edge': an outdoor flight or an is_breakline edge. */
  kind: 'drawn' | 'edge';
  id: string;
  coordinates: Position[];
  /** Drawn lines only: the low side (left / right of the drawing direction) and the drop in metres, when set. */
  lowSide?: 'left' | 'right';
  dropM?: number;
}

/** What the map shows of the drawn line being edited: which one, the side under the pointer, its points while one is pulled. */
export interface BreaklineView {
  selected: string | null;
  /** The side the pointer is on (faint teeth there); null: none. */
  preview: 'left' | 'right' | null;
  /** The selected line's points while a point is being dragged. */
  dragged?: Position[] | null;
}

/** How faint the teeth of the side under the pointer are, before a click makes them the low side. */
export const BREAKLINE_PREVIEW_OPACITY = 0.35;

export function elevationGeoJSON(
  breaklines: readonly BreaklineShape[],
  slopes: readonly { cls: 'caution' | 'steep'; coordinates: Position[] }[],
  view: BreaklineView = { selected: null, preview: null },
): FeatureCollection {
  const line = (coordinates: Position[], properties: Record<string, string | number>): FeatureCollection['features'] =>
    coordinates.length >= 2 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties }] : [];
  const out: FeatureCollection['features'] = [];
  for (const b of breaklines) {
    if (b.kind === 'edge') {
      out.push(...line(b.coordinates, { role: 'break-edge', id: b.id }));
      continue;
    }
    const selected = b.id === view.selected;
    const coords = selected && view.dragged ? view.dragged : b.coordinates;
    out.push(...line(coords, { role: 'break-drawn', id: b.id, selected: selected ? 1 : 0 }));
    // Teeth hang off the low side (opaque); the side under the pointer of the line being edited gets faint ones.
    if (b.lowSide) out.push(...line(coords, { role: 'break-teeth', id: b.id, side: b.lowSide, opacity: 1 }));
    if (selected && view.preview && view.preview !== b.lowSide) {
      out.push(...line(coords, { role: 'break-teeth', id: b.id, side: view.preview, opacity: BREAKLINE_PREVIEW_OPACITY }));
    }
    if (selected) {
      for (const [i, c] of coords.entries()) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { role: 'break-vertex', index: i } });
    }
  }
  for (const s of slopes) out.push(...line(s.coordinates, { role: `slope-${s.cls}` }));
  return { type: 'FeatureCollection', features: out };
}

/**
 * Break lines under the data (a cut in the ground), slope stripes over the routes. A drawn 고도 단절선 is a wall symbol
 * as on a topographic map: a solid edge with teeth hanging off its low side (icons.ts breakline-tooth; the image's teeth
 * point to the right of the line's direction, turned 180° for the left), so it reads as a drop and not as a path. A line
 * whose low side is not set yet has no teeth. The line being edited has a yellow casing and its points as handles.
 * Campus edges that act as one (outdoor steps, is_breakline) keep a thin dashed line beside them.
 */
export const BREAKLINE_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-breakline-casing',
    type: 'line',
    source: ELEVATION_SOURCE,
    filter: ['==', ['get', 'role'], 'break-drawn'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'selected'], 1], '#ffd43b', '#ffffff'],
      'line-width': ['case', ['==', ['get', 'selected'], 1], 11, 8],
      'line-opacity': 0.85,
    },
  },
  {
    id: 'campo-breakline',
    type: 'line',
    source: ELEVATION_SOURCE,
    filter: ['==', ['get', 'role'], 'break-drawn'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ELEVATION_COLORS.breakline, 'line-width': 3.5 },
  },
  {
    id: 'campo-breakline-teeth',
    type: 'symbol',
    source: ELEVATION_SOURCE,
    filter: ['==', ['get', 'role'], 'break-teeth'],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 14,
      'icon-image': 'breakline-tooth',
      'icon-rotation-alignment': 'map',
      'icon-keep-upright': false,
      'icon-rotate': ['case', ['==', ['get', 'side'], 'left'], 180, 0],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': ['get', 'opacity'] },
  },
  {
    id: 'campo-breakline-vertex',
    type: 'circle',
    source: ELEVATION_SOURCE,
    filter: ['==', ['get', 'role'], 'break-vertex'],
    paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': ELEVATION_COLORS.breakline, 'circle-stroke-width': 2.5 },
  },
  {
    id: 'campo-breakline-edge',
    type: 'line',
    source: ELEVATION_SOURCE,
    filter: ['==', ['get', 'role'], 'break-edge'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ELEVATION_COLORS.breakline, 'line-width': 2, 'line-dasharray': [0.6, 0.6], 'line-offset': 5 },
  },
];
export const SLOPE_LAYERS: LayerSpecification[] = [
  {
    id: 'campo-slope',
    type: 'line',
    source: ELEVATION_SOURCE,
    filter: ['match', ['get', 'role'], ['slope-caution', 'slope-steep'], true, false],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'role'], 'slope-steep', ELEVATION_COLORS.steep, ELEVATION_COLORS.caution],
      'line-width': 10,
      'line-opacity': 0.9,
      'line-dasharray': [0.35, 0.35],
    },
  },
];

// ---- 외곽선 수정: the outline being edited, its sides and its corner handles ----

export const OUTLINE_SOURCE = 'campo-outline';
/** Same value as the CSS token --outline-edit. */
export const OUTLINE_COLOR = '#3b5bdb';

/** What the pointer is over while an outline is edited: a corner (drag, right-click deletes) or a side (right-click adds). */
export type OutlineHover = { kind: 'corner' | 'side'; index: number } | null;

export function outlineGeoJSON(corners: readonly Position[], holes: readonly Position[][], hover: OutlineHover, dragging: number | null): FeatureCollection {
  if (corners.length === 0) return { type: 'FeatureCollection', features: [] };
  const features: FeatureCollection['features'] = [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closeRing(corners), ...holes] }, properties: { role: 'fill' } },
  ];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % corners.length]!;
    const on = hover?.kind === 'side' && hover.index === i;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [a, b] }, properties: { role: 'side', index: i, hover: on } });
    // A faint dot in the middle of each side: where a right-click adds a corner.
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }, properties: { role: 'mid', index: i, hover: on } });
  });
  corners.forEach((c, i) => {
    const on = dragging === i || (hover?.kind === 'corner' && hover.index === i);
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { role: 'corner', index: i, hover: on } });
  });
  return { type: 'FeatureCollection', features };
}

const outlineRole = (role: string): ExpressionSpecification => ['==', ['get', 'role'], role];
export const OUTLINE_LAYERS: LayerSpecification[] = [
  { id: 'campo-outline-fill', type: 'fill', source: OUTLINE_SOURCE, filter: outlineRole('fill'), paint: { 'fill-color': OUTLINE_COLOR, 'fill-opacity': 0.12 } },
  {
    // The side under the pointer: a wide soft band, so it is plain where a right-click adds a corner.
    id: 'campo-outline-side-hover', type: 'line', source: OUTLINE_SOURCE, filter: ['all', outlineRole('side'), ['get', 'hover']],
    layout: { 'line-cap': 'round' }, paint: { 'line-color': OUTLINE_COLOR, 'line-width': 9, 'line-opacity': 0.25 },
  },
  {
    id: 'campo-outline-side', type: 'line', source: OUTLINE_SOURCE, filter: outlineRole('side'),
    layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': OUTLINE_COLOR, 'line-width': 2.5 },
  },
  {
    id: 'campo-outline-mid', type: 'circle', source: OUTLINE_SOURCE, filter: outlineRole('mid'),
    paint: {
      'circle-radius': ['case', ['get', 'hover'], 4.5, 3] as never,
      'circle-color': '#ffffff', 'circle-stroke-color': OUTLINE_COLOR, 'circle-stroke-width': 1.5, 'circle-opacity': 0.9,
    },
  },
  {
    id: 'campo-outline-corner', type: 'circle', source: OUTLINE_SOURCE, filter: outlineRole('corner'),
    paint: {
      'circle-radius': ['case', ['get', 'hover'], 8, 6.5] as never,
      'circle-color': ['case', ['get', 'hover'], OUTLINE_COLOR, '#ffffff'] as never,
      'circle-stroke-color': ['case', ['get', 'hover'], '#ffffff', OUTLINE_COLOR] as never,
      'circle-stroke-width': 2.5,
    },
  },
];
