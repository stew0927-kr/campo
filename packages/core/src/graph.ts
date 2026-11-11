// Routing graph (SPEC-v0.2 3.1-3.3).
//
// IMPORTANT: the graph follows edge connections only. Floor numbers are never
// read here (AGENTS.md); a test checks this file for the word.
import createGraph, { type Graph } from 'ngraph.graph';
import distance from '@turf/distance';
import {
  ELEVATOR_ALIGHT_SEC,
  ELEVATOR_BOARD_SEC,
  ELEVATOR_HOP_SEC,
  WALK_SPEED_MPS,
  conveyingOf,
  isClosedFor,
  penaltySec,
  perProfile,
  portalSec,
  stairsTimeSec,
  walkTimeSec,
  type Profile,
} from './costs.ts';
import { edgeTargetKey, elevatorTargetKey, measuredTimes } from './routing/measured.ts';
import { activeClosures } from './routing/overrides.ts';
import type { BuildingFeature, EdgeFeature, EdgeProperties, LoadedCampus, NodeFeature, Position } from './types.ts';

export interface GraphNodeData {
  /** The campus node this graph node stands for (an elevator car maps to its stop). */
  nodeId: string;
  position: Position;
}

interface LinkCosts {
  /** Expected travel time in seconds (SPEC-v0.2 3.1). */
  timeSec: number;
  /** Search cost per profile: timeSec plus that profile's preference penalty. */
  cost: Record<Profile, number>;
  /** Closed to that profile (ngraph `blocked`), by the profile's rules or by an active override. */
  blocked: Record<Profile, boolean>;
}

/** Walking along a footway / steps / corridor / ramp edge, in link direction. */
export interface WalkLinkData extends LinkCosts {
  kind: 'walk';
  edge: EdgeFeature;
  /** Geodesic distance between the edge's from / to node positions. */
  lengthM: number;
}
/** Stop → its car: waiting and getting in. Paid once per ride. */
export interface BoardLinkData extends LinkCosts {
  kind: 'board';
  stopId: string;
}
/** Car → car along one elevator edge. */
export interface HopLinkData extends LinkCosts {
  kind: 'hop';
  edge: EdgeFeature;
}
/** Car → its stop: getting out. */
export interface AlightLinkData extends LinkCosts {
  kind: 'alight';
  stopId: string;
}
/** Matching node → findNearest's virtual target. Exists only inside findNearest, never in CampusGraph.graph. */
export interface SinkLinkData extends LinkCosts {
  kind: 'sink';
}

export type GraphLinkData = WalkLinkData | BoardLinkData | HopLinkData | AlightLinkData | SinkLinkData;

export interface CampusGraph {
  graph: Graph<GraphNodeData, GraphLinkData>;
  nodes: Map<string, NodeFeature>;
  buildings: Map<string, BuildingFeature>;
  /** Feature ids closed by an active override when the graph was built. */
  closed: ReadonlySet<string>;
  /**
   * The A* heuristic is straight-line distance / this: the larger of
   * WALK_SPEED_MPS and the fastest plan speed (plan distance / timeSec) of any
   * link. Stairs can beat walking speed (24 steps over 34.5 m take 13.2 s), and
   * so can a hop between elevator stops that are apart in plan (an I5 error).
   * Using the fastest link keeps the heuristic admissible and consistent.
   * Costs are not changed.
   */
  heuristicSpeedMps: number;
}

export interface BuildGraphOptions {
  /** overrides.json entries, unvalidated (SPEC-v0.2 2.5). Default: campus.overrides. */
  overrides?: unknown;
  /** The clock that decides which overrides are still active. Default: new Date(). */
  now?: Date;
  /**
   * calibration.json, unvalidated (SPEC-v0.2 3.9). Default: campus.calibration.
   * Pass {} to build with the predicted times only (what predictedTimeSec should read).
   */
  calibration?: unknown;
}

/** Graph id of the elevator car standing at stop `nodeId`. Campus ids never contain '~'. */
export function carId(nodeId: string): string {
  return `~car:${nodeId}`;
}

/**
 * Build the routing graph from a loaded campus. Uses every feature that has the
 * shape routing needs; it does not run the full schema check (that is
 * validateCampus's job), so the editor can preview routes on unfinished data.
 * Edges whose from/to node is missing are skipped.
 *
 * Every walk link's length is the distance between its from / to node
 * positions. The edge's line is not read: a line that misses its nodes is a
 * data error for validation (E4) and does not change the route. No cost is
 * clamped; heuristicSpeedMps adapts to the fastest link instead.
 *
 * Edges with conveying get links by conveying only: forward from → to,
 * backward to → from, reversible both (SPEC-v0.2 2.7); the rest by bidirectional.
 *
 * Measured times (options.calibration, SPEC-v0.2 3.9) replace the predicted
 * timeSec of a walk link (key "edge:<id>" as drawn, "edge:<id>#backward"
 * against it) and of the board links of an elevator ("elevator:<elevator_id>",
 * read from the stop's elevator_id). The preference penalty is still added:
 * cost = timeSec + penalty. Hop and alight links are not calibrated.
 */
export function buildGraph(campus: LoadedCampus, options: BuildGraphOptions = {}): CampusGraph {
  const graph = createGraph<GraphNodeData, GraphLinkData>({ multigraph: true });
  const nodes = new Map<string, NodeFeature>();
  const buildings = new Map<string, BuildingFeature>();
  const edges: EdgeFeature[] = [];
  const closed = activeClosures(options.overrides !== undefined ? options.overrides : campus.overrides, options.now ?? new Date());
  const measured = measuredTimes(options.calibration !== undefined ? options.calibration : campus.calibration);
  let heuristicSpeedMps = WALK_SPEED_MPS;

  for (const { feature } of campus.features) {
    if (isNode(feature)) nodes.set(feature.id, feature);
    else if (isEdge(feature)) edges.push(feature);
    else if (isBuilding(feature)) buildings.set(feature.id, feature);
  }
  for (const node of nodes.values()) {
    graph.addNode(node.id, { nodeId: node.id, position: node.geometry.coordinates });
  }
  const at = (id: string): Position => nodes.get(id)!.geometry.coordinates;

  /** One directed link. `edge` is null for board / alight (no step_free of their own). */
  const costs = (timeSec: number, edge: EdgeProperties | null, isClosed: boolean): LinkCosts => ({
    timeSec,
    cost: perProfile((p) => timeSec + penaltySec(edge, p)),
    blocked: perProfile((p) => isClosed || isClosedFor(edge, p)),
  });

  /**
   * Add one directed link and keep the heuristic admissible: no link may cover
   * its plan distance faster than heuristicSpeedMps (cost >= timeSec, so the
   * time bound is enough). A link with plan distance but no time makes it Infinity
   * (heuristic 0, plain Dijkstra).
   */
  const link = (from: string, to: string, data: GraphLinkData) => {
    graph.addLink(from, to, data);
    const planM = straight(graph.getNode(from)!.data.position, graph.getNode(to)!.data.position);
    if (planM > 0) heuristicSpeedMps = Math.max(heuristicSpeedMps, data.timeSec > 0 ? planM / data.timeSec : Infinity);
  };

  const ensureCar = (stopId: string): string => {
    const id = carId(stopId);
    if (!graph.hasNode(id)) {
      graph.addNode(id, { nodeId: stopId, position: at(stopId) });
      const stopClosed = closed.has(stopId);
      const elevatorId = nodes.get(stopId)!.properties.elevator_id;
      const boardSec = (typeof elevatorId === 'string' ? measured.get(elevatorTargetKey(elevatorId)) : undefined) ?? ELEVATOR_BOARD_SEC;
      link(stopId, id, { kind: 'board', stopId, ...costs(boardSec, null, stopClosed) });
      link(id, stopId, { kind: 'alight', stopId, ...costs(ELEVATOR_ALIGHT_SEC, null, stopClosed) });
    }
    return id;
  };

  const hop = (fromStop: string, toStop: string, edge: EdgeFeature) => {
    link(ensureCar(fromStop), ensureCar(toStop), { kind: 'hop', edge, ...costs(ELEVATOR_HOP_SEC, edge.properties, closed.has(edge.id)) });
  };

  /** A measured time replaces the predicted one (SPEC-v0.2 3.9); penalties are added on top by costs(). */
  const walk = (from: string, to: string, edge: EdgeFeature) => {
    const lengthM = straight(at(from), at(to));
    const traversal = from === edge.properties.from ? 'along' : 'against';
    const predicted = edge.properties.highway === 'steps'
      ? stairsTimeSec({
        edge: edge.properties,
        endNodeTypes: [nodes.get(from)!.properties.node_type, nodes.get(to)!.properties.node_type],
        planLengthM: lengthM,
        traversal,
      }) + portalSec(edge.properties)
      : walkTimeSec(edge.properties, lengthM);
    const timeSec = measured.get(edgeTargetKey(edge.id, traversal)) ?? predicted;
    const isClosed = closed.has(edge.id) || closed.has(from) || closed.has(to);
    link(from, to, { kind: 'walk', edge, lengthM, ...costs(timeSec, edge.properties, isClosed) });
  };

  for (const edge of edges) {
    const { from, to, bidirectional, highway } = edge.properties;
    if (!nodes.has(from) || !nodes.has(to)) continue;
    const add = highway === 'elevator' ? hop : walk;
    // A moving belt (escalator, moving walkway) runs where conveying says; bidirectional is not read (SPEC-v0.2 2.7).
    const conveying = conveyingOf(edge.properties);
    const along = conveying !== 'backward';
    const against = conveying === null ? bidirectional : conveying !== 'forward';
    if (along) add(from, to, edge);
    if (against) add(to, from, edge);
  }

  return { graph, nodes, buildings, closed, heuristicSpeedMps };
}

/**
 * The time the graph gives a calibration target (SPEC-v0.2 3.9), for
 * npm run calibrate's prior. Pass a graph built with { calibration: {} } to get
 * the prediction; on a calibrated graph this reads the calibrated time.
 * - "edge:<edge id>": timeSec of the walk link over that edge, travelled as
 *   drawn ('forward', the default) or against it ('backward'). undefined when
 *   there is no such link: no such edge, a one-way edge or belt the other way,
 *   or an elevator edge (elevators are timed per elevator, below).
 * - "elevator:<elevator_id>": timeSec of the board link (the wait) at a stop
 *   with that elevator_id; undefined when no stop has it.
 * Anything else is undefined.
 */
export function predictedTimeSec(g: CampusGraph, target: string, direction: 'forward' | 'backward' = 'forward'): number | undefined {
  let found: number | undefined;
  if (target.startsWith('edge:')) {
    const edgeId = target.slice('edge:'.length);
    if (edgeId === '') return undefined;
    g.graph.forEachLink((l) => {
      if (l.data.kind !== 'walk' || l.data.edge.id !== edgeId) return false;
      const along = l.fromId === l.data.edge.properties.from;
      if (along !== (direction === 'forward')) return false;
      found = l.data.timeSec;
      return true;
    });
  } else if (target.startsWith('elevator:')) {
    const elevatorId = target.slice('elevator:'.length);
    if (elevatorId === '') return undefined;
    g.graph.forEachLink((l) => {
      if (l.data.kind !== 'board' || g.nodes.get(l.data.stopId)?.properties.elevator_id !== elevatorId) return false;
      found = l.data.timeSec;
      return true;
    });
  }
  return found;
}

/** Geodesic straight-line distance in metres. */
export function straight(a: Position, b: Position): number {
  return distance(a, b, { units: 'meters' });
}

// Shape checks: just enough structure for routing.

type Loose = { id?: unknown; geometry?: { type?: unknown; coordinates?: unknown }; properties?: Record<string, unknown> };

function hasKind(f: unknown, kind: string, geometry: string): f is Loose {
  const l = f as Loose | null;
  return typeof l === 'object' && l !== null && typeof l.id === 'string' &&
    l.properties?.['kind'] === kind && l.geometry?.type === geometry && Array.isArray(l.geometry.coordinates);
}
function isNode(f: unknown): f is NodeFeature {
  if (!hasKind(f, 'node', 'Point')) return false;
  const c = f.geometry!.coordinates as unknown[];
  return c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);
}
function isEdge(f: unknown): f is EdgeFeature {
  return hasKind(f, 'edge', 'LineString') && typeof f.properties?.['from'] === 'string' &&
    typeof f.properties['to'] === 'string';
}
function isBuilding(f: unknown): f is BuildingFeature {
  return hasKind(f, 'building', 'Polygon');
}
