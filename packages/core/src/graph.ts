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
  isClosedFor,
  penaltySec,
  perProfile,
  portalSec,
  stairsTimeSec,
  walkTimeSec,
  type Profile,
} from './costs.ts';
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
   * The A* heuristic is straight-line distance / this. WALK_SPEED_MPS for valid
   * data. If stops of one elevator are apart in plan (an I5 error) a hop covers
   * that distance in ELEVATOR_HOP_SEC; the heuristic then uses that faster speed
   * so it never overestimates. Costs are not changed.
   */
  heuristicSpeedMps: number;
}

export interface BuildGraphOptions {
  /** overrides.json entries, unvalidated (SPEC-v0.2 2.5). Default: campus.overrides. */
  overrides?: unknown;
  /** The clock that decides which overrides are still active. Default: new Date(). */
  now?: Date;
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
 * data error for validation (E4) and does not change the route, and every link
 * costs at least straight-line distance / WALK_SPEED_MPS, so the heuristic is
 * admissible without clamping any cost.
 */
export function buildGraph(campus: LoadedCampus, options: BuildGraphOptions = {}): CampusGraph {
  const graph = createGraph<GraphNodeData, GraphLinkData>({ multigraph: true });
  const nodes = new Map<string, NodeFeature>();
  const buildings = new Map<string, BuildingFeature>();
  const edges: EdgeFeature[] = [];
  const closed = activeClosures(options.overrides !== undefined ? options.overrides : campus.overrides, options.now ?? new Date());
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

  const ensureCar = (stopId: string): string => {
    const id = carId(stopId);
    if (!graph.hasNode(id)) {
      graph.addNode(id, { nodeId: stopId, position: at(stopId) });
      const stopClosed = closed.has(stopId);
      graph.addLink(stopId, id, { kind: 'board', stopId, ...costs(ELEVATOR_BOARD_SEC, null, stopClosed) });
      graph.addLink(id, stopId, { kind: 'alight', stopId, ...costs(ELEVATOR_ALIGHT_SEC, null, stopClosed) });
    }
    return id;
  };

  const hop = (fromStop: string, toStop: string, edge: EdgeFeature) => {
    graph.addLink(ensureCar(fromStop), ensureCar(toStop), { kind: 'hop', edge, ...costs(ELEVATOR_HOP_SEC, edge.properties, closed.has(edge.id)) });
    // Hops are the only links whose time does not come from their own length.
    const planM = straight(at(fromStop), at(toStop));
    if (planM > 0) heuristicSpeedMps = Math.max(heuristicSpeedMps, planM / ELEVATOR_HOP_SEC);
  };

  const walk = (from: string, to: string, edge: EdgeFeature) => {
    const lengthM = straight(at(from), at(to));
    const timeSec = edge.properties.highway === 'steps'
      ? stairsTimeSec({
        edge: edge.properties,
        endNodeTypes: [nodes.get(from)!.properties.node_type, nodes.get(to)!.properties.node_type],
        planLengthM: lengthM,
      }) + portalSec(edge.properties)
      : walkTimeSec(edge.properties, lengthM);
    const isClosed = closed.has(edge.id) || closed.has(from) || closed.has(to);
    graph.addLink(from, to, { kind: 'walk', edge, lengthM, ...costs(timeSec, edge.properties, isClosed) });
  };

  for (const edge of edges) {
    const { from, to, bidirectional, highway } = edge.properties;
    if (!nodes.has(from) || !nodes.has(to)) continue;
    const add = highway === 'elevator' ? hop : walk;
    add(from, to, edge);
    if (bidirectional) add(to, from, edge);
  }

  return { graph, nodes, buildings, closed, heuristicSpeedMps };
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
