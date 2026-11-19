// The 3D views drawn with deck.gl over MapLibre (MapView adds a MapboxOverlay): 지형 3D (the height grid as a surface,
// the outdoor paths and the ground-floor outlines laid on it) and 건물 3D (every building's floors as slabs standing on
// that ground, and for the building shown its indoor points, paths and the vertical links between floors), and the
// routes of 경로 테스트 over both. Every height is multiplied by 높이 과장 (`exaggeration`).
// Nothing here is pickable: clicks, drags and hovers stay with the 2D editor underneath (MapView finds the relief under
// the cursor itself, model/terrain3d.ts pickSurface).
import type { Layer } from '@deck.gl/core';
import { IconLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { PICTOGRAM_COLORS, STACK_COLORS, beltEndIds, buildingById, edgeCoords, outlineOfLevel, pictogramOf, stackLayout, type EditState, type Level, type Position, type StackMode } from '@campo/core';
import type { Scope } from '../model/scope.ts';
import {
  ROUTE_LIFT_M, buildingGround, buildingSegments, drapePath, floorBases, groundOf, nodeHeights, plazaGround, plazaHeight, plazaSkirt,
  routePath3D, terrainBase, terrainMesh, terrainWire, wallCells, wallMesh, type Ground, type PlazaFlat, type PlazaSurface, type RouteRef,
  type Segment3D, type TerrainGrid, type TerrainWall, type WallTriangle,
} from '../model/terrain3d.ts';
import { fineGround, plazaFootprints, terrainSurface, type TerrainTile } from '../model/terrainFootprint.ts';
import type { SlopeLine } from '../model/elevation.ts';
import { pictogramDataUrl, routePinDataUrl } from './iconUrls.ts';
import { ELEVATION_COLORS, PLAZA_COLORS, ROUTE_COLORS, ROUTE_PIN_COLORS, WAY_COLORS, type RouteLine } from './layers.ts';

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
/** A wall's section floats this far (× 높이 과장) over the relief, so where the two overlap they do not flicker. */
const WALL_LIFT_M = 0.03;
/** The face of a wall: concrete grey, apart from the relief's sage-sand-clay. */
const WALL_FACE = rgb('#8d8f8c');
/**
 * 평지: how far (× 높이 과장) the plane floats over the relief. 0: the relief is pressed CARVE_GAP_M (2 cm, display m) under
 * every plaza (model/terrainFootprint.ts terrainSurface), so the plane needs no lift and is drawn at its own height.
 * (No depthBias / polygonOffset / depthCompare either: what keeps the plane out of the relief is the geometry.)
 */
const PLAZA_LIFT_M = 0;
/** The lift of the old way (exactFootprints: false: the relief clamped to the plane within 0.75 cell, the plane 3 cm over it). */
const LEGACY_PLAZA_LIFT_M = 0.03;
/** The plaza's outline floats a little higher still, over its own plane. */
const PLAZA_OUTLINE_LIFT_M = 0.08;

export interface Deck3DInput {
  state: EditState;
  scope: Scope;
  /** The height grid, or null (flat ground). */
  grid: TerrainGrid | null;
  /** 옹벽: the 1 m sections across the drawn walls that came with the grid (none: the relief as it is). */
  walls?: readonly TerrainWall[];
  terrain: boolean;
  buildings: boolean;
  measured: (buildingId: string) => ReadonlyMap<Level, number>;
  /** 높이 과장: every height (relief, floors, routes) × this. */
  exaggeration: number;
  /** 경로 테스트: the routes, their pins and dashed feet as the 2D map draws them, and their caution / steep parts. */
  routes: readonly RouteLine[];
  slopes: readonly SlopeLine[];
  /** 평지 (id and rings) and the heights the solver held them at (/terrain plazaHeights; a plaza missing there takes the relief's median). */
  plazas?: readonly Pick<PlazaSurface, 'id' | 'rings'>[];
  plazaHeights?: Readonly<Record<string, number>>;
  /** 평지 tiles: the grid again at 1 m round each plaza (/terrain tiles; none from an older server or before a recompute). */
  tiles?: readonly TerrainTile[];
  /**
   * true (default): the relief pressed under every plaza (terrainSurface, from the tiles where there are some, else the
   * coarse cells), the plane drawn at its height. false: the old way (the relief clamped within 0.75 cell, the plane lifted).
   */
  exactFootprints?: boolean;
}

interface Slab {
  polygon: [number, number, number][][];
  height: number;
  role: 'floor' | 'below' | 'selected' | 'ground' | 'plinth';
}

export function deckLayers({
  state, scope, grid, walls = [], terrain, buildings, measured, exaggeration: k, routes, slopes, plazas = [], plazaHeights = {},
  tiles = [], exactFootprints = true,
}: Deck3DInput): Layer[] {
  const layers: Layer[] = [];
  // 평지: each plane at (H − the grid's lowest height) × k; paths, buildings and routes stand on it (plazaGround).
  const flats: PlazaFlat[] = [];
  if (terrain && grid) {
    const base = terrainBase(grid);
    for (const p of plazas) {
      const h = plazaHeight(grid, { id: p.id, rings: p.rings, h: plazaHeights[p.id] ?? null });
      if (h !== null) flats.push({ id: p.id, rings: p.rings, z: (h - base) * k });
    }
  }
  const exact = exactFootprints && terrain && grid !== null && flats.length > 0;
  // The ground things stand on: the 1 m tiles where there are some (the exact way), else the coarse relief.
  const bare: Ground = !terrain ? () => 0 : exact ? fineGround(grid, tiles, k) : groundOf(grid, k);
  const ground: Ground = plazaGround(bare, flats);
  const mode: StackMode = terrain ? 'terrain' : 'flat';

  if (terrain && grid) {
    // The thinned cells a wall crosses are left out: the wall's 1 m section is drawn there instead.
    const cut = walls.length > 0 ? wallCells(grid, walls) : undefined;
    // Exact: the relief pressed under every plaza (never above its plane, I5); the wire stays off the cells drawn from a
    // tile or pressed (its coarse line would float over them). Old way: the relief clamped to the plane within 0.75 cell.
    const surface = exact ? terrainSurface(grid, tiles, k, plazaFootprints(flats), cut) : null;
    const cells = surface ? surface.cells : terrainMesh(grid, 1, k, cut, flats);
    const wireSkip = surface ? new Set([...(cut ?? []), ...surface.skippedCells, ...surface.carvedCells]) : cut;
    const top = Math.max(1, ...cells.map((c) => c.z));
    layers.push(new SolidPolygonLayer({
      id: 'terrain-mesh', data: cells, _full3d: true, filled: true, extruded: false, opacity: 0.93,
      getPolygon: (c: (typeof cells)[number]) => c.polygon, getFillColor: (c: (typeof cells)[number]) => reliefColor(c.z / top),
    }));
    if (walls.length > 0) {
      // Each wall a hair higher than the one before, so crossing sections do not flicker either.
      const tris = walls.flatMap((w, i) => wallMesh(grid, [w], k, (WALL_LIFT_M + 0.01 * i) * k));
      const strip = tris.filter((t) => t.role === 'strip');
      const face = tris.filter((t) => t.role === 'face');
      layers.push(
        new SolidPolygonLayer({
          id: 'terrain-wall-strip', data: strip, _full3d: true, filled: true, extruded: false, opacity: 0.93,
          getPolygon: (t: WallTriangle) => t.polygon, getFillColor: (t: WallTriangle) => reliefColor(t.z / top),
        }),
        new SolidPolygonLayer({
          id: 'terrain-wall-face', data: face, _full3d: true, filled: true, extruded: false, opacity: 1,
          getPolygon: (t: WallTriangle) => t.polygon, getFillColor: WALL_FACE,
        }),
      );
    }
    // A light wire every few cells: the eye reads slope from how the lines bend.
    const lines = terrainWire(grid, Math.max(2, Math.round(grid.width / 24)), k, wireSkip, surface ? undefined : flats);
    layers.push(new PathLayer({
      id: 'terrain-wire', data: lines, getPath: (l: [number, number, number][]) => l,
      getColor: [255, 255, 255, 80], getWidth: 1, widthUnits: 'pixels',
    }));
    if (flats.length > 0) {
      // The plane as its own exact mesh: deck.gl's SolidPolygonLayer cuts the holes ([outer, ...holes]) itself.
      const lift = (exact ? PLAZA_LIFT_M : LEGACY_PLAZA_LIFT_M) * k;
      // The fill side's cliff reaches the ground under it (the tiles' where there are some); the cut side has none.
      const skirts = flats.flatMap((f) => plazaSkirt(f, bare));
      layers.push(
        new SolidPolygonLayer({
          id: 'plaza-skirt', data: skirts, _full3d: true, filled: true, extruded: false, opacity: 1,
          getPolygon: (q: (typeof skirts)[number]) => q.polygon, getFillColor: WALL_FACE,
        }),
        new SolidPolygonLayer({
          id: 'plaza-surface', data: flats, _full3d: true, filled: true, extruded: false, opacity: 0.95,
          getPolygon: (f: PlazaFlat) => f.rings.map((ring) => ring.map((p): [number, number, number] => [p[0], p[1], f.z + lift])),
          getFillColor: rgb(PLAZA_COLORS.fill),
        }),
        new PathLayer({
          id: 'plaza-outline', data: flats.flatMap((f) => f.rings.map((ring) => ({ path: ring.map((p): [number, number, number] => [p[0], p[1], f.z + PLAZA_OUTLINE_LIFT_M * k]) }))),
          getPath: (d: { path: [number, number, number][] }) => d.path, getColor: rgb(PLAZA_COLORS.line, 230), getWidth: 2, widthUnits: 'pixels', jointRounded: true,
        }),
      );
    }
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
      // Terrain off: no plinth, 1F on the map, basements below. Terrain on: the plinth as one block, the floors on it.
      const { plinth, floors: stack } = stackLayout(b, measured(b.id), mode);
      if (plinth) {
        slabs.push({
          polygon: plinth.outline.map((ring) => ring.map((p): [number, number, number] => [p[0], p[1], g + plinth.baseM * k])),
          height: Math.max(0.2, (plinth.topM - plinth.baseM) * k - SLAB_GAP_M),
          role: 'plinth',
        });
      }
      for (const s of stack) {
        const z = g + s.baseM * k;
        const selected = scope.kind === 'building' && scope.buildingId === b.id && scope.level === s.level;
        slabs.push({
          polygon: s.outline.map((ring) => ring.map((p): [number, number, number] => [p[0], p[1], z])),
          // The floor shown is a plate at its level, so its points and paths stand on it in plain sight.
          height: selected ? SELECTED_PLATE_M : Math.max(0.2, (s.topM - s.baseM) * k - SLAB_GAP_M),
          role: selected ? 'selected' : s.level < 0 ? 'below' : 'floor',
        });
      }
      // Where a building has basements: a thin translucent plate at its ground, between them and floor 1 (on a plinth the
      // ground is under the plinth, so no plate).
      if (!plinth && stack.some((s) => s.level < 0)) slabs.push({ polygon: b.polygon.map((ring) => ring.map((p): [number, number, number] => [p[0], p[1], g - 0.15])), height: 0.3, role: 'ground' });
    }
    // A role with no slab gets no layer: an empty extruded SolidPolygonLayer draws its sides with -1 instances (a GL warning every frame).
    const slabLayer = (role: Slab['role'], color: string, opacity: number): Layer[] => {
      const data = slabs.filter((s) => s.role === role);
      return data.length === 0 ? [] : [new SolidPolygonLayer({
        id: `building-${role}`, data, extruded: true, wireframe: true, opacity,
        getPolygon: (s: Slab) => s.polygon, getElevation: (s: Slab) => s.height,
        getFillColor: rgb(color), getLineColor: rgb(STACK_COLORS.edge, 120),
      })];
    };
    layers.push(
      ...slabLayer('plinth', STACK_COLORS.plinth, 0.55),
      ...slabLayer('below', STACK_COLORS.below, 0.4),
      ...slabLayer('ground', STACK_COLORS.ground, 0.3),
      ...slabLayer('floor', STACK_COLORS.floor, 0.22),
      ...slabLayer('selected', STACK_COLORS.selected, 0.75),
    );

    // The building shown: its points and paths at their floors, the floor shown strong, the links between floors upright.
    if (scope.kind === 'building') {
      const z = nodeHeights(state, ground, measured, k, mode);
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
  layers.push(...routeLayers(state, ground, measured, k, mode, routes, slopes));
  return layers;
}

/** A route over the 3D views: a white casing and the profile's colour, drawn over whatever is in front so it stays readable. */
const ROUTE_STYLE = { widthUnits: 'pixels' as const, capRounded: true, jointRounded: true, parameters: ON_TOP };
const PIN_W = 96;
const PIN_H = 64;

type Line3D = { path: [number, number, number][]; color: RGBA };
type Pin3D = { at: [number, number, number]; end: 'start' | 'end' };

function routeLayers(
  state: EditState, ground: Ground, measured: (buildingId: string) => ReadonlyMap<Level, number>, k: number, mode: StackMode,
  routes: readonly RouteLine[], slopes: readonly SlopeLine[],
): Layer[] {
  if (routes.length === 0 && slopes.length === 0) return [];
  // Each building's floors at their (exaggerated) heights, worked out once for each building a route goes through.
  const bases = new Map<string, Map<Level, number>>();
  const floorZ = (buildingId: string, level: Level): number | undefined => {
    let m = bases.get(buildingId);
    if (!m) {
      const b = buildingById(state, buildingId);
      m = b ? floorBases(b, ground, measured(b.id), k, mode) : new Map<Level, number>();
      bases.set(buildingId, m);
    }
    return m.get(level);
  };
  const lines: Line3D[] = [];
  const snaps: Line3D[] = [];
  const pins: Pin3D[] = [];
  for (const r of routes) {
    const path = routePath3D(state, r.coordinates, r.refs, ground, floorZ);
    if (r.profile === 'start' || r.profile === 'end') {
      if (path[0]) pins.push({ at: path[0], end: r.profile });
    } else if (path.length >= 2) {
      if (r.profile === 'snap') snaps.push({ path, color: rgb('#1e2933', 220) });
      else lines.push({ path, color: rgb(ROUTE_COLORS[r.profile], 235) });
    }
  }
  const slopeLines = slopes.map((s): Line3D => ({ path: slopePath3D(state, s, ground, floorZ), color: rgb(s.cls === 'steep' ? ELEVATION_COLORS.steep : ELEVATION_COLORS.caution) }));
  const getPath = (d: Line3D) => d.path;
  const getColor = (d: Line3D) => d.color;
  return [
    new PathLayer({ id: 'route-casing', data: lines, getPath, getColor: [255, 255, 255, 235], getWidth: 10, ...ROUTE_STYLE }),
    new PathLayer({ id: 'route-line', data: lines, getPath, getColor, getWidth: 6, ...ROUTE_STYLE }),
    new PathLayer({ id: 'route-slope', data: slopeLines, getPath, getColor, getWidth: 6, ...ROUTE_STYLE }),
    new PathLayer({ id: 'route-snap', data: snaps, getPath, getColor, getWidth: 2.5, ...ROUTE_STYLE }),
    // A short stem from the ground or the floor up to the pin, so the height it stands at reads.
    new LineLayer({
      id: 'route-pin-stem', data: pins, getSourcePosition: (p: Pin3D) => [p.at[0], p.at[1], p.at[2] - ROUTE_LIFT_M],
      getTargetPosition: (p: Pin3D) => p.at, getColor: [30, 41, 51, 200], getWidth: 2, widthUnits: 'pixels', parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'route-pin-dot', data: pins, getPosition: (p: Pin3D) => p.at, getRadius: 4, radiusUnits: 'pixels',
      getFillColor: (p: Pin3D) => rgb(ROUTE_PIN_COLORS[p.end]), stroked: true, getLineColor: [255, 255, 255, 255], getLineWidth: 1.5,
      lineWidthUnits: 'pixels', parameters: ON_TOP,
    }),
    new IconLayer({
      id: 'route-pins', data: pins, getPosition: (p: Pin3D) => p.at,
      getIcon: (p: Pin3D) => {
        const url = routePinDataUrl(p.end === 'start' ? '출발' : '도착', ROUTE_PIN_COLORS[p.end]);
        return { url, id: url, width: PIN_W, height: PIN_H, anchorY: PIN_H };
      },
      getSize: PIN_H / 2, sizeUnits: 'pixels', billboard: true, parameters: ON_TOP,
    }),
  ];
}

/**
 * A caution / steep part of a route in 3D: outdoors on the relief like the route; where an end is indoors (a ramp in a
 * building) the edge's bends at heights straight between its two ends.
 */
function slopePath3D(state: EditState, s: SlopeLine, ground: Ground, floorZ: (b: string, level: Level) => number | undefined): [number, number, number][] {
  if (!s.ends) return routePath3D(state, s.coordinates, undefined, ground, floorZ);
  const [from, to] = s.ends;
  const outdoors = state.nodes[from]?.props.building_id == null && state.nodes[to]?.props.building_id == null;
  if (outdoors) return routePath3D(state, s.coordinates, undefined, ground, floorZ);
  const refs: RouteRef[] = [{ node: from }, { node: to }];
  const ends = routePath3D(state, [s.coordinates[0]!, s.coordinates.at(-1)!], refs, ground, floorZ);
  const [z0, z1] = [ends[0]![2], ends.at(-1)![2]];
  const len: number[] = [0];
  for (let i = 1; i < s.coordinates.length; i++) {
    const [a, b] = [s.coordinates[i - 1]!, s.coordinates[i]!];
    len.push(len[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = len.at(-1)! || 1;
  return s.coordinates.map((p: Position, i): [number, number, number] => [p[0], p[1], z0 + (z1 - z0) * (len[i]! / total)]);
}
