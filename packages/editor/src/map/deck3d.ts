// The 3D views drawn with deck.gl over MapLibre (MapView adds a MapboxOverlay): 지형 3D (the height grid as a surface,
// the outdoor paths and the ground-floor outlines laid on it) and 건물 3D (every building's floors as slabs standing on
// that ground, and for the building shown its indoor points, paths and the vertical links between floors).
// Nothing here is pickable: clicks, drags and hovers stay with the 2D editor underneath.
import type { Layer } from '@deck.gl/core';
import { IconLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { PICTOGRAM_COLORS, STACK_COLORS, beltEndIds, buildingStack, edgeCoords, outlineOfLevel, pictogramOf, type EditState, type Level } from '@campo/core';
import type { Scope } from '../model/scope.ts';
import {
  buildingGround, buildingSegments, drapePath, groundOf, nodeHeights, terrainMesh, terrainWire, type Ground, type Segment3D, type TerrainGrid,
} from '../model/terrain3d.ts';
import { pictogramDataUrl } from './icons.ts';
import { WAY_COLORS } from './layers.ts';

type RGBA = [number, number, number, number];
const rgb = (hex: string, alpha = 255): RGBA => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];

/** Low to high: sage, sand, clay. A ramp you can read as height without a legend, quiet under the drawn data. */
const RELIEF: [number, RGBA][] = [[0, rgb('#a7b59a')], [0.5, rgb('#dccfa6')], [1, rgb('#b58d6c')]];
function reliefColor(t: number): RGBA {
  const k = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RELIEF.length; i++) {
    const [t1, c1] = RELIEF[i]!;
    const [t0, c0] = RELIEF[i - 1]!;
    if (k <= t1) {
      const f = (k - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j]! - v) * f)) as RGBA;
    }
  }
  return RELIEF[RELIEF.length - 1]![1];
}

/** Each floor's slab stops this far under the next one, so the floors read as separate plates. */
const SLAB_GAP_M = 0.4;
const SELECTED_PLATE_M = 0.35;
/** The indoor points and links are drawn over the slabs whatever is in front, so they never hide behind a floor. */
const ON_TOP = { depthCompare: 'always' as const };

export interface Deck3DInput {
  state: EditState;
  scope: Scope;
  /** The height grid, or null (flat ground). */
  grid: TerrainGrid | null;
  terrain: boolean;
  buildings: boolean;
  measured: (buildingId: string) => ReadonlyMap<Level, number>;
}

interface Slab {
  polygon: [number, number, number][][];
  height: number;
  role: 'floor' | 'below' | 'selected' | 'ground';
}

export function deckLayers({ state, scope, grid, terrain, buildings, measured }: Deck3DInput): Layer[] {
  const layers: Layer[] = [];
  const ground: Ground = terrain ? groundOf(grid) : () => 0;

  if (terrain && grid) {
    const cells = terrainMesh(grid, 1);
    const top = Math.max(1, ...cells.map((c) => c.z));
    layers.push(new SolidPolygonLayer({
      id: 'terrain-mesh', data: cells, _full3d: true, filled: true, extruded: false, opacity: 0.93,
      getPolygon: (c: (typeof cells)[number]) => c.polygon, getFillColor: (c: (typeof cells)[number]) => reliefColor(c.z / top),
    }));
    // A light wire every few cells: the eye reads slope from how the lines bend.
    const lines = terrainWire(grid, Math.max(2, Math.round(grid.width / 24)));
    layers.push(new PathLayer({
      id: 'terrain-wire', data: lines, getPath: (l: [number, number, number][]) => l,
      getColor: [255, 255, 255, 80], getWidth: 1, widthUnits: 'pixels',
    }));
  }

  if (terrain) {
    // The outdoor paths and the outline of every ground floor, laid on the ground.
    const outdoorEdges = Object.values(state.edges).filter((e) => state.nodes[e.props.from]?.props.building_id === null && state.nodes[e.props.to]?.props.building_id === null);
    const paths = outdoorEdges.map((e) => ({ path: drapePath(edgeCoords(state, e), ground), color: rgb(WAY_COLORS[e.props.highway as keyof typeof WAY_COLORS] ?? WAY_COLORS.other) }));
    layers.push(
      new PathLayer({ id: 'terrain-paths-casing', data: paths, getPath: (d: (typeof paths)[number]) => d.path, getColor: [255, 255, 255, 230], getWidth: 7, widthUnits: 'pixels', capRounded: true, jointRounded: true }),
      new PathLayer({ id: 'terrain-paths', data: paths, getPath: (d: (typeof paths)[number]) => d.path, getColor: (d: (typeof paths)[number]) => d.color, getWidth: 4, widthUnits: 'pixels', capRounded: true, jointRounded: true }),
    );
    const footprints = Object.values(state.buildings).flatMap((b) =>
      (b.props.ground_levels.length > 0 ? b.props.ground_levels : [1]).map((level) => drapePath(outlineOfLevel(b, level)[0] ?? [], ground, 3, 0.3)));
    layers.push(new PathLayer({
      id: 'terrain-footprints', data: footprints.filter((f) => f.length > 1), getPath: (f: [number, number, number][]) => f,
      getColor: rgb(STACK_COLORS.edge, 220), getWidth: 2.5, widthUnits: 'pixels', jointRounded: true,
    }));
  }

  if (buildings) {
    const slabs: Slab[] = [];
    for (const b of Object.values(state.buildings)) {
      const g = buildingGround(b, ground);
      const stack = buildingStack(b, measured(b.id));
      for (const s of stack) {
        const z = g + s.baseM;
        const selected = scope.kind === 'building' && scope.buildingId === b.id && scope.level === s.level;
        slabs.push({
          polygon: s.outline.map((ring) => ring.map((p): [number, number, number] => [p[0], p[1], z])),
          // The floor shown is a plate at its level, so its points and paths stand on it in plain sight.
          height: selected ? SELECTED_PLATE_M : Math.max(0.2, s.topM - s.baseM - SLAB_GAP_M),
          role: selected ? 'selected' : s.level < 0 ? 'below' : 'floor',
        });
      }
      // Where a building has basements: a thin translucent plate at its ground, between them and floor 1.
      if (stack.some((s) => s.level < 0)) slabs.push({ polygon: b.polygon.map((ring) => ring.map((p): [number, number, number] => [p[0], p[1], g - 0.15])), height: 0.3, role: 'ground' });
    }
    const slabLayer = (role: Slab['role'], color: string, opacity: number) => new SolidPolygonLayer({
      id: `building-${role}`, data: slabs.filter((s) => s.role === role), extruded: true, wireframe: true, opacity,
      getPolygon: (s: Slab) => s.polygon, getElevation: (s: Slab) => s.height,
      getFillColor: rgb(color), getLineColor: rgb(STACK_COLORS.edge, 120),
    });
    layers.push(
      slabLayer('below', STACK_COLORS.below, 0.4),
      slabLayer('ground', STACK_COLORS.ground, 0.3),
      slabLayer('floor', STACK_COLORS.floor, 0.22),
      slabLayer('selected', STACK_COLORS.selected, 0.75),
    );

    // The building shown: its points and paths at their floors, the floor shown strong, the links between floors upright.
    if (scope.kind === 'building') {
      const z = nodeHeights(state, ground, measured);
      const segments = buildingSegments(state, scope.buildingId, scope.level, z);
      const segColor = (s: Segment3D): RGBA => (s.kind === 'elevator' ? rgb(PICTOGRAM_COLORS.elevator) : s.kind === 'steps' ? rgb(PICTOGRAM_COLORS.stairs)
        : s.strong ? rgb(STACK_COLORS.edge) : rgb(STACK_COLORS.edge, 70));
      layers.push(new LineLayer({
        id: 'indoor-links', data: segments, getSourcePosition: (s: Segment3D) => s.from, getTargetPosition: (s: Segment3D) => s.to,
        getColor: segColor, getWidth: (s: Segment3D) => (s.kind !== 'flat' ? 4 : s.strong ? 3.5 : 1.5), widthUnits: 'pixels', parameters: ON_TOP,
      }));
      const nodes = Object.values(state.nodes).filter((n) => n.props.building_id === scope.buildingId);
      const ends = beltEndIds(state);
      const here = nodes.filter((n) => n.props.level === scope.level);
      const icons = here.flatMap((n) => {
        const kind = pictogramOf(n, ends);
        return kind ? [{ n, kind, url: pictogramDataUrl(kind, n.props.node_type === 'restroom' ? n.props.wheelchair ?? 'unknown' : null) }] : [];
      });
      const iconIds = new Set(icons.map((i) => i.n.id));
      const pos = (id: string, coord: readonly number[]): [number, number, number] => [coord[0]!, coord[1]!, (z.get(id) ?? 0) + 0.2];
      layers.push(
        new ScatterplotLayer({
          id: 'indoor-dots-other', data: nodes.filter((n) => n.props.level !== scope.level), getPosition: (n: (typeof nodes)[number]) => pos(n.id, n.coord),
          getRadius: 2.5, radiusUnits: 'pixels', getFillColor: rgb('#5b6875', 170), stroked: false, parameters: ON_TOP,
        }),
        new ScatterplotLayer({
          id: 'indoor-dots-here', data: here.filter((n) => !iconIds.has(n.id)), getPosition: (n: (typeof nodes)[number]) => pos(n.id, n.coord),
          getRadius: 4.5, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 255], stroked: true, getLineColor: rgb(STACK_COLORS.edge), getLineWidth: 2, lineWidthUnits: 'pixels', parameters: ON_TOP,
        }),
        new IconLayer({
          id: 'indoor-icons', data: icons, getPosition: (i: (typeof icons)[number]) => pos(i.n.id, i.n.coord),
          getIcon: (i: (typeof icons)[number]) => ({ url: i.url, id: i.url, width: 64, height: 64 }), getSize: 26, sizeUnits: 'pixels', billboard: true, parameters: ON_TOP,
        }),
      );
    }
  }
  return layers;
}
