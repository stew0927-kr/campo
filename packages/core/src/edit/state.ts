// Edit state of the edit engine (SPEC-v0.2 §4). Plain objects, never mutated: actions return a new state.
// Edges reference their end nodes and keep only the bend points between them (iD way model),
// so moving a node can never leave an edge end behind.
import type {
  BuildingProperties,
  EdgeProperties,
  NodeProperties,
  Position,
  RoomProperties,
} from '../types.ts';

export interface EditNode {
  id: string;
  coord: Position;
  props: NodeProperties;
}

export interface EditEdge {
  id: string;
  /** Bend points between the from and the to node. The end coordinates come from the nodes. */
  vertices: Position[];
  /** `props.from` / `props.to` are the references. They stay inside props so the saved key order survives a round trip. */
  props: EdgeProperties;
}

export interface EditBuilding {
  /** Feature id, e.g. "bldg_A". The record key is `props.code`. */
  id: string;
  polygon: Position[][];
  props: BuildingProperties;
}

export interface EditRoom {
  id: string;
  polygon: Position[][];
  props: RoomProperties;
}

export interface EditState {
  nodes: Record<string, EditNode>;
  edges: Record<string, EditEdge>;
  /** Keyed by building code. */
  buildings: Record<string, EditBuilding>;
  rooms: Record<string, EditRoom>;
}

export type Collection = keyof EditState;
export const COLLECTIONS: readonly Collection[] = ['nodes', 'edges', 'buildings', 'rooms'];

export function emptyState(): EditState {
  return { nodes: {}, edges: {}, buildings: {}, rooms: {} };
}

/** Read-only view shared by states and Immer drafts. */
export type StateLike = EditState;

/** "outdoor" or "{building_id}/{level}". Used by checks (I4) and file placement only, never by routing. */
export type Scope = string;

export function scopeOf(props: { building_id: string | null; level: number | null }): Scope {
  return props.building_id === null ? 'outdoor' : `${props.building_id}/${String(props.level)}`;
}

export function scopeOfNode(node: EditNode): Scope {
  return scopeOf(node.props);
}

export function sameScope(a: EditNode, b: EditNode): boolean {
  return scopeOfNode(a) === scopeOfNode(b);
}

/** The full LineString of an edge: from-node coordinate, bend points, to-node coordinate. */
export function edgeCoords(state: StateLike, edge: EditEdge): Position[] {
  const from = state.nodes[edge.props.from];
  const to = state.nodes[edge.props.to];
  if (!from || !to) throw new Error(`edge ${edge.id} points at a missing node`);
  return [copy(from.coord), ...edge.vertices.map(copy), copy(to.coord)];
}

/** Edges whose from or to is `nodeId`, in id order. */
export function edgesAt(state: StateLike, nodeId: string): EditEdge[] {
  return sortedValues(state.edges).filter((e) => e.props.from === nodeId || e.props.to === nodeId);
}

/** Flat edges (footway / corridor) must stay inside one scope unless they are a portal or a bridge (I4). */
export function isScopeBound(props: Pick<EdgeProperties, 'highway' | 'edge_type'>): boolean {
  return (props.highway === 'footway' || props.highway === 'corridor') && props.edge_type !== 'portal' && props.edge_type !== 'bridge';
}

export function buildingById(state: StateLike, buildingId: string): EditBuilding | undefined {
  for (const b of Object.values(state.buildings)) if (b.id === buildingId) return b;
  return undefined;
}

/** Building code for a building id: the building's code, or the id without its "bldg_" prefix when the building is gone. */
export function codeOf(state: StateLike, buildingId: string): string {
  return buildingById(state, buildingId)?.props.code ?? buildingId.replace(/^bldg_/, '');
}

/** Every Feature id in the state (buildings by their Feature id, not their code). */
export function allIds(state: StateLike): string[] {
  return [
    ...Object.keys(state.nodes),
    ...Object.keys(state.edges),
    ...Object.values(state.buildings).map((b) => b.id),
    ...Object.keys(state.rooms),
  ];
}

export function idTaken(state: StateLike, id: string): boolean {
  return id in state.nodes || id in state.edges || id in state.rooms || buildingById(state, id) !== undefined;
}

/** Find a Feature by id in any collection. Returns the record key too (the code for buildings). */
export function findFeature(state: StateLike, id: string): { collection: Collection; key: string } | undefined {
  if (id in state.nodes) return { collection: 'nodes', key: id };
  if (id in state.edges) return { collection: 'edges', key: id };
  if (id in state.rooms) return { collection: 'rooms', key: id };
  const b = buildingById(state, id);
  if (b) return { collection: 'buildings', key: b.props.code };
  return undefined;
}

export function sortedValues<T>(record: Record<string, T>): T[] {
  return Object.keys(record).sort().map((k) => record[k]!);
}

export function copy(p: Position): Position {
  return [p[0], p[1]];
}

export function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function isPosition(p: unknown): p is Position {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** Deep equality on JSON-like values, ignoring key order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => k in rb && deepEqual(ra[k], rb[k]));
}

/** JSON deep copy (structuredClone is not in the ES lib this package compiles against). */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
