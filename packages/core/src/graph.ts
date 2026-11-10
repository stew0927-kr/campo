// Routing graph (docs/SPEC.md §6).
//
// IMPORTANT: the graph follows edge connections only. Floor numbers are never
// compared to decide what connects to what (AGENTS.md); a test enforces this.
import createGraph, { type Graph } from 'ngraph.graph';
import distance from '@turf/distance';
import length from '@turf/length';
import {
  ELEVATOR_BOARDING_COST,
  PROFILES,
  elevatorFloors,
  elevatorRideCost,
  walkCost,
  type Profile,
} from './costs.ts';
import type { BuildingFeature, EdgeFeature, LoadedCampus, NodeFeature, Position } from './types.ts';

export interface GraphNodeData {
  /** The campus node this graph node stands for (an elevator car maps to its stop). */
  nodeId: string;
  position: Position;
}

export type GraphLinkData =
  /** Walking along a footway / steps / corridor / ramp edge. */
  | { kind: 'walk'; edge: EdgeFeature; lengthM: number; cost: Record<Profile, number> }
  /** Getting into the elevator car at a stop: pays the wait once per ride. */
  | { kind: 'board'; cost: Record<Profile, number> }
  /** Getting out of the car. */
  | { kind: 'alight'; cost: Record<Profile, number> }
  /** Riding the car along an elevator edge. */
  | { kind: 'ride'; edge: EdgeFeature; floors: number; cost: Record<Profile, number> };

export interface CampusGraph {
  graph: Graph<GraphNodeData, GraphLinkData>;
  nodes: Map<string, NodeFeature>;
  buildings: Map<string, BuildingFeature>;
}

/** Graph id of the elevator car standing at stop `nodeId`. Campus ids never contain ':'. */
export function carId(nodeId: string): string {
  return `car:${nodeId}`;
}

const both = (cost: number): Record<Profile, number> => ({ shortest: cost, step_free: cost });

/**
 * Build the routing graph from a loaded campus. Uses every feature that has the
 * shape routing needs; it does not run the full schema check (that is
 * validateCampus's job), so the editor can preview routes on unfinished data.
 * Edges whose from/to node is missing are skipped.
 */
export function buildGraph(campus: LoadedCampus): CampusGraph {
  const graph = createGraph<GraphNodeData, GraphLinkData>({ multigraph: true });
  const nodes = new Map<string, NodeFeature>();
  const buildings = new Map<string, BuildingFeature>();
  const edges: EdgeFeature[] = [];

  for (const { feature } of campus.features) {
    if (isNode(feature)) nodes.set(feature.id, feature);
    else if (isEdge(feature)) edges.push(feature);
    else if (isBuilding(feature)) buildings.set(feature.id, feature);
  }
  for (const node of nodes.values()) {
    graph.addNode(node.id, { nodeId: node.id, position: node.geometry.coordinates });
  }

  /** Never let a link cost less than the straight-line distance, so the A* heuristic stays admissible. */
  const link = (a: string, b: string, data: GraphLinkData) => {
    const floor = straight(graph.getNode(a)!.data.position, graph.getNode(b)!.data.position);
    for (const profile of PROFILES) data.cost[profile] = Math.max(data.cost[profile], floor);
    graph.addLink(a, b, data);
  };

  const ensureCar = (stopId: string): string => {
    const id = carId(stopId);
    if (!graph.hasNode(id)) {
      graph.addNode(id, { nodeId: stopId, position: nodes.get(stopId)!.geometry.coordinates });
      link(stopId, id, { kind: 'board', cost: both(ELEVATOR_BOARDING_COST) });
      link(id, stopId, { kind: 'alight', cost: both(0) });
    }
    return id;
  };

  for (const edge of edges) {
    const { from, to, bidirectional, highway } = edge.properties;
    if (!nodes.has(from) || !nodes.has(to)) continue;

    if (highway === 'elevator') {
      const floors = elevatorFloors(edge.properties);
      const [a, b] = [ensureCar(from), ensureCar(to)];
      link(a, b, { kind: 'ride', edge, floors, cost: both(elevatorRideCost(floors)) });
      if (bidirectional) link(b, a, { kind: 'ride', edge, floors, cost: both(elevatorRideCost(floors)) });
      continue;
    }

    const lengthM = length(edge, { units: 'meters' });
    const costs = () => ({
      shortest: walkCost(edge.properties, lengthM, 'shortest'),
      step_free: walkCost(edge.properties, lengthM, 'step_free'),
    });
    link(from, to, { kind: 'walk', edge, lengthM, cost: costs() });
    if (bidirectional) link(to, from, { kind: 'walk', edge, lengthM, cost: costs() });
  }

  return { graph, nodes, buildings };
}

/** Geodesic straight-line distance in metres. Also the A* heuristic. */
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
  return hasKind(f, 'node', 'Point');
}
function isEdge(f: unknown): f is EdgeFeature {
  return hasKind(f, 'edge', 'LineString') && typeof f.properties?.['from'] === 'string' &&
    typeof f.properties['to'] === 'string' && (f.geometry!.coordinates as unknown[]).length >= 2;
}
function isBuilding(f: unknown): f is BuildingFeature {
  return hasKind(f, 'building', 'Polygon');
}
