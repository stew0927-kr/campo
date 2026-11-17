// The magnet of 현장 기록 불러오기: which surveyed points and stretches follow a way the map already has.
// Judged point by point, never per building: one end of a walk can follow an existing corridor while the other opens a new one.
//   indoors   the ways are the flat edges of the same building and floor, within INDOOR_SNAP_M
//   outdoors  the ways are the outdoor edges, within OUTDOOR_SNAP_M
// Reading only. The one change it prepares is joinStep: a new stretch's end is put onto the way it meets (splitEdgeAt).
import {
  addEdge, edgeCoords, footOnLine, mergeNodes, metres, scopeOf, scopeOfNode, splitEdgeAt,
  type Action, type CampoFeature, type Changeset, type EdgeFeature, type EdgeProperties, type EditContext, type EditEdge, type EditState,
  type NodeFeature, type Position, type Survey, type SurveyAttachment, type VerticalMeasurement,
} from '@campo/core';
import type { Step } from './plan.ts';

/** Indoors a surveyed point within this distance of an existing way of its floor belongs to that way (a 5m wide band). */
export const INDOOR_SNAP_M = 2.5;
/** Outdoors: a 10m wide band, the phone's map being coarser there. */
export const OUTDOOR_SNAP_M = 5;

const OUTDOOR_SCOPE = scopeOf({ building_id: null, level: null });
export const snapRadius = (scope: string): number => (scope === OUTDOOR_SCOPE ? OUTDOOR_SNAP_M : INDOOR_SNAP_M);

/** A way a walk can follow: an outdoor edge, or a flat edge inside one floor. Stairs between floors, rides, belts, portals and bridges are not. */
function wayScope(state: EditState, e: EditEdge): string | null {
  const [a, b] = [state.nodes[e.props.from], state.nodes[e.props.to]];
  if (!a || !b || scopeOfNode(a) !== scopeOfNode(b)) return null;
  return isWay(e.props, scopeOfNode(a)) ? scopeOfNode(a) : null;
}

function isWay(p: Pick<EdgeProperties, 'edge_type' | 'highway' | 'conveying'>, scope: string): boolean {
  if (p.conveying !== undefined) return false;
  return scope === OUTDOOR_SCOPE ? p.edge_type === 'outdoor' : p.edge_type === 'indoor' && (p.highway === 'corridor' || p.highway === 'ramp');
}

interface Way {
  edge: EditEdge;
  coords: Position[];
}

/** The existing ways by scope, leaving out `skip` (the edges the survey itself made). */
function waysOf(state: EditState, skip: ReadonlySet<string> = new Set()): Map<string, Way[]> {
  const out = new Map<string, Way[]>();
  for (const edge of Object.values(state.edges)) {
    if (skip.has(edge.id)) continue;
    const scope = wayScope(state, edge);
    if (scope === null) continue;
    out.set(scope, [...(out.get(scope) ?? []), { edge, coords: edgeCoords(state, edge) }]);
  }
  return out;
}

/** The nearest way of `scope` within its radius of `coord`. */
function nearestWay(ways: ReadonlyMap<string, Way[]>, scope: string, coord: Position, not?: (e: EditEdge) => boolean): { way: Way; dist: number } | undefined {
  let best: { way: Way; dist: number } | undefined;
  for (const way of ways.get(scope) ?? []) {
    if (not?.(way.edge)) continue;
    const dist = footOnLine(way.coords, coord).pointDistance;
    if (dist <= snapRadius(scope) && (!best || dist < best.dist)) best = { way, dist };
  }
  return best;
}

/** Points along a line no farther apart than `step` metres, both ends included. */
function samples(coords: readonly Position[], step: number): Position[] {
  const out: Position[] = [coords[0]!];
  for (let i = 0; i + 1 < coords.length; i++) {
    const [a, b] = [coords[i]!, coords[i + 1]!];
    const n = Math.max(1, Math.ceil(metres(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const isNode = (f: CampoFeature): f is NodeFeature => f.properties.kind === 'node';
const isEdge = (f: CampoFeature): f is EdgeFeature => f.properties.kind === 'edge';
/** The points a walk leaves behind on a way: they can stand for a place on an existing way. A door or an elevator stop cannot. */
const isWalkPoint = (f: NodeFeature): boolean => f.properties.node_type === 'corridor' || f.properties.node_type === 'outdoor';

export interface SurveySnap {
  /** The changeset without what follows existing ways, or null when nothing is left. */
  changeset: Changeset | null;
  /** New points that lie on an existing way and carry a new stretch: joinStep puts each onto its way. */
  joins: string[];
  droppedNodes: string[];
  droppedEdges: string[];
  /** Every edge the survey made (dropped or not): a join never targets one of them. */
  createdEdgeIds: ReadonlySet<string>;
}

/** Sort the new points and stretches of `cs` into those that follow existing ways of `state` and those that are new. */
export function snapChangeset(state: EditState, cs: Changeset): SurveySnap {
  const created = cs.changes.flatMap((c) => (c.op === 'create' ? [c.feature] : []));
  const newNodes = new Map(created.filter(isNode).map((f) => [f.id, f]));
  const newEdges = created.filter(isEdge);
  const createdEdgeIds = new Set(newEdges.map((e) => e.id));
  const ways = waysOf(state);
  const scopeById = (id: string): string | undefined => {
    const made = newNodes.get(id);
    if (made) return scopeOf(made.properties);
    return state.nodes[id] ? scopeOfNode(state.nodes[id]!) : undefined;
  };

  const onWay = new Set<string>(); // new walk points within reach of an existing way
  for (const n of newNodes.values()) {
    if (isWalkPoint(n) && nearestWay(ways, scopeOf(n.properties), n.geometry.coordinates)) onWay.add(n.id);
  }
  /** An end already on the network: a new point on a way, or an existing point with a way at it. */
  const joined = (id: string, scope: string): boolean =>
    onWay.has(id) || (id in state.nodes && (ways.get(scope) ?? []).some((w) => w.edge.props.from === id || w.edge.props.to === id));

  const droppedEdges = newEdges.filter((e) => {
    const { from, to } = e.properties;
    const scope = scopeById(from);
    if (scope === undefined || scope !== scopeById(to) || !isWay(e.properties, scope)) return false;
    if (!joined(from, scope) || !joined(to, scope)) return false;
    // Both ends near ways is not enough: a shortcut between two ways is a new way. Every stretch of it must follow one.
    return samples(e.geometry.coordinates, snapRadius(scope)).every((p) => nearestWay(ways, scope, p) !== undefined);
  }).map((e) => e.id);
  const gone = new Set(droppedEdges);
  const kept = newEdges.filter((e) => !gone.has(e.id));
  const carries = (id: string) => kept.some((e) => e.properties.from === id || e.properties.to === id);
  const droppedNodes = [...onWay].filter((id) => !carries(id));
  const joins = [...onWay].filter(carries).sort();
  for (const id of droppedNodes) gone.add(id);

  const changes = cs.changes.filter((c) => c.op !== 'create' || !gone.has(c.feature.id));
  return { changeset: changes.length > 0 ? { ...cs, changes } : null, joins, droppedNodes: droppedNodes.sort(), droppedEdges: droppedEdges.sort(), createdEdgeIds };
}

/**
 * Put the new point `nodeId` onto the existing way it lies beside: the way is cut there and the point becomes the cut
 * (it moves by less than the snap radius, and its own edges follow). Where the way cannot be cut (within 1m of an end)
 * the point is merged into that end, or joined to it by a short edge when the two cannot be merged.
 */
export function joinStep(nodeId: string, surveyEdges: ReadonlySet<string>, ctx: EditContext): Step {
  return (state): Action | null => {
    const node = state.nodes[nodeId];
    if (!node) return null;
    const scope = scopeOfNode(node);
    const near = nearestWay(waysOf(state, surveyEdges), scope, node.coord, (e) => e.props.from === nodeId || e.props.to === nodeId);
    if (!near) return null;
    const { edge } = near.way;
    const split = splitEdgeAt(edge.id, node.coord, { nodeId }, ctx);
    if (split.disabled(state) === false) return split;
    const end = [state.nodes[edge.props.from]!, state.nodes[edge.props.to]!].sort((a, b) => metres(a.coord, node.coord) - metres(b.coord, node.coord))[0]!;
    const merge = mergeNodes([nodeId, end.id], ctx);
    if (merge.disabled(state) === false) return merge;
    const link = addEdge({
      props: {
        kind: 'edge', highway: scope === OUTDOOR_SCOPE ? 'footway' : 'corridor', edge_type: scope === OUTDOOR_SCOPE ? 'outdoor' : 'indoor',
        from: nodeId, to: end.id, bidirectional: true, step_free: null, source: node.props.source,
      },
    }, ctx);
    return link.disabled(state) === false ? link : null;
  };
}

/** A record of a surveyed Feature that is shown on the existing way it follows. */
export interface MovedRecord {
  recordedAt: string;
  attachment?: SurveyAttachment;
  vertical?: VerticalMeasurement;
}

/**
 * The records of `survey` that belong on the existing way `edgeId`: those of Features the survey made that are not on
 * the map and lie within the snap radius of this way, nearer to it than to any other. A height measured along a stretch
 * walked against the way's direction is turned round, so it still reads from the way's start to its end.
 */
export function snappedOnto(state: EditState, survey: Survey, edgeId: string): MovedRecord[] {
  const created = (survey.changeset?.changes ?? []).flatMap((c) => (c.op === 'create' ? [c.feature] : []));
  const newNodes = new Map(created.filter(isNode).map((f) => [f.id, f]));
  const ways = waysOf(state, new Set(created.filter(isEdge).map((e) => e.id)));
  const target = state.edges[edgeId];
  if (!target) return [];
  const out: MovedRecord[] = [];
  for (const f of created) {
    if (f.id in state.nodes || f.id in state.edges) continue;
    const attachment = survey.attachments[f.id];
    const measured = isEdge(f) ? survey.vertical.find((v) => v.edge_id === f.id) : undefined;
    if (!attachment && !measured) continue;
    let scope: string | undefined;
    let at: Position;
    let along: [Position, Position] | undefined;
    if (isNode(f)) {
      scope = scopeOf(f.properties);
      at = f.geometry.coordinates;
    } else if (isEdge(f)) {
      const from = newNodes.get(f.properties.from);
      scope = from ? scopeOf(from.properties) : state.nodes[f.properties.from] ? scopeOfNode(state.nodes[f.properties.from]!) : undefined;
      const line = f.geometry.coordinates;
      const [a, b] = [line[0]!, line[line.length - 1]!];
      at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      along = [a, b];
    } else continue;
    if (scope === undefined || nearestWay(ways, scope, at)?.way.edge.id !== edgeId) continue;
    let vertical = measured;
    if (vertical && along) {
      const coords = edgeCoords(state, target);
      // The surveyed start lies farther along the way than its end: it was walked against the way.
      const against = footOnLine(coords, along[0]).totalDistance > footOnLine(coords, along[1]).totalDistance;
      vertical = {
        ...vertical,
        edge_id: edgeId,
        ...(against ? {
          pressure_start_hpa: vertical.pressure_end_hpa, pressure_end_hpa: vertical.pressure_start_hpa, height_m: -vertical.height_m,
          ...(vertical.grade_pct !== undefined ? { grade_pct: -vertical.grade_pct } : {}),
        } : {}),
      };
    }
    out.push({ recordedAt: f.id, ...(attachment ? { attachment } : {}), ...(vertical ? { vertical } : {}) });
  }
  return out;
}
