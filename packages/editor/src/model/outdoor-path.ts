// "바깥 길" tool (SPEC §8): a drawn polyline becomes outdoor node and edge Features (SPEC §4).
import type { EdgeFeature, EdgeProperties, NodeFeature, Position } from '@campo/core';
import { withFeatures, type CampusDoc } from './document.ts';
import { edgeIdFor } from './ids.ts';

export const OUTDOOR_KINDS = ['flat', 'steps', 'ramp'] as const;
export type OutdoorKind = (typeof OUTDOOR_KINDS)[number];

const EDGE_BY_KIND: Record<OutdoorKind, Pick<EdgeProperties, 'highway' | 'step_free'>> = {
  // SPEC §6: outdoor footways default to step_free true; a person flips it for a sill.
  flat: { highway: 'footway', step_free: true },
  steps: { highway: 'steps', step_free: false },
  ramp: { highway: 'ramp', step_free: true },
};

/** A clicked point: either snapped onto an existing node, or a new position. */
export type PathVertex = { nodeId: string } | { position: Position };

export interface PathResult {
  doc: CampusDoc;
  nodeIds: string[];
  edgeIds: string[];
}

/** Default source for data drawn in the editor until someone checks it on site (SPEC §4.1). */
export const DRAWN_SOURCE = 'estimate';

export function addOutdoorPath(doc: CampusDoc, vertices: readonly PathVertex[], kind: OutdoorKind): PathResult {
  const taken = new Set(doc.features.keys());
  let nextOut = nextOutdoorNumber(taken);
  const created: (NodeFeature | EdgeFeature)[] = [];
  const nodeById = new Map<string, NodeFeature>();
  const lookup = (id: string): NodeFeature | undefined => {
    const f = nodeById.get(id) ?? doc.features.get(id);
    return f?.properties.kind === 'node' ? (f as NodeFeature) : undefined;
  };

  // 1. Resolve every click to a node id, creating outdoor nodes for new positions.
  const path: string[] = [];
  const newAt = new Map<string, string>(); // "lng,lat" → id, so closing a loop reuses the first new node
  for (const v of vertices) {
    let id: string;
    if ('nodeId' in v) {
      if (!lookup(v.nodeId)) throw new Error(`no node ${v.nodeId}`);
      id = v.nodeId;
    } else if (newAt.has(`${v.position[0]},${v.position[1]}`)) {
      id = newAt.get(`${v.position[0]},${v.position[1]}`)!;
    } else {
      id = outdoorId(nextOut++);
      while (taken.has(id)) id = outdoorId(nextOut++);
      const node: NodeFeature = {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [v.position[0], v.position[1]] },
        properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: DRAWN_SOURCE },
      };
      taken.add(id);
      newAt.set(`${v.position[0]},${v.position[1]}`, id);
      nodeById.set(id, node);
      created.push(node);
    }
    if (path[path.length - 1] !== id) path.push(id); // clicking the same node twice is not a segment
  }

  // 2. One edge per consecutive pair.
  const edgeIds: string[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const from = lookup(path[i]!)!;
    const to = lookup(path[i + 1]!)!;
    const id = edgeIdFor(taken, from.id, to.id);
    taken.add(id);
    const edge: EdgeFeature = {
      type: 'Feature',
      id,
      geometry: { type: 'LineString', coordinates: [from.geometry.coordinates, to.geometry.coordinates] },
      properties: {
        kind: 'edge',
        ...EDGE_BY_KIND[kind],
        edge_type: 'outdoor',
        from: from.id,
        to: to.id,
        bidirectional: true,
        source: DRAWN_SOURCE,
      },
    };
    created.push(edge);
    edgeIds.push(id);
  }

  if (edgeIds.length === 0) return { doc, nodeIds: [], edgeIds: [] }; // a lone click draws nothing
  return { doc: withFeatures(doc, created), nodeIds: path, edgeIds };
}

/** SPEC §4.4: n_out_{4 digits}. */
export function outdoorId(n: number): string {
  return `n_out_${String(n).padStart(4, '0')}`;
}

function nextOutdoorNumber(ids: Iterable<string>): number {
  let max = 0;
  for (const id of ids) {
    const m = /^n_out_(\d+)$/.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
