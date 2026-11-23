// DraftMap → a FeatureCollection of nodes and edges that passes data/schema/campo.schema.json (0.2), with a summary.
// Every Feature is a draft: source "school-floorplan-ai", rev 1, needs_check true. The app gives them its own ids.
import { placer, type LonLat } from './geometry.ts';
import type { DraftMap, DraftNode, FloorplanSummary, RotationDeg } from './types.ts';

export const SOURCE = 'school-floorplan-ai';
/** A door, stair, elevator or restroom is joined to the nearest corridor point at most this far (0..1000 units, ≈ 12% of the diagonal). */
export const ATTACH_MAX = 120;
/** With no corridor list, corridor points are chained to their nearest neighbour at most this far. */
export const CHAIN_MAX = 200;

export interface AssembleOptions {
  buildingId: string;
  level: number;
  rotationDeg: RotationDeg;
  buildingPolygon: number[][];
  /** Width over height of the photo, when known. */
  aspect?: number;
}

export interface Feature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: LonLat } | { type: 'LineString'; coordinates: LonLat[] };
  properties: Record<string, unknown>;
}

export interface Assembled {
  geojson: { type: 'FeatureCollection'; features: Feature[] };
  summary: FloorplanSummary;
}

const dist = (a: DraftNode, b: DraftNode): number => Math.hypot(a.x - b.x, a.y - b.y);

function nodeProps(n: DraftNode, opts: AssembleOptions): Record<string, unknown> {
  const p: Record<string, unknown> = {
    kind: 'node', source: SOURCE, rev: 1, needs_check: true,
    node_type: n.kind, building_id: opts.buildingId, level: opts.level,
  };
  const name = n.space_name ?? (n.room_ref !== undefined ? `${n.room_ref}호` : undefined);
  if (name !== undefined) p.name = name;
  if (n.kind === 'door') {
    if (n.room_ref !== undefined) p.room_ref = n.room_ref;
    if (n.space_name !== undefined) p.space_name = n.space_name;
    if (n.door_role !== undefined) p.door_role = n.door_role;
  } else if (n.kind === 'elevator_stop') {
    p.elevator_id = n.elevator_id ?? 'EV1';
  } else if (n.kind === 'restroom') {
    // The schema asks for both together; a wheelchair is not something a floor guide tells.
    p.restroom_gender = n.restroom_gender ?? 'unisex';
    p.wheelchair = 'unknown';
    if (n.space_name !== undefined) p.space_name = n.space_name;
  } else if (n.space_name !== undefined) {
    p.space_name = n.space_name;
  }
  return p;
}

/** Corridor point chains: from the leftmost unvisited point, on to the nearest unvisited one within CHAIN_MAX. */
function chainPairs(nodes: readonly DraftNode[]): [number, number][] {
  const left = new Set(nodes.map((n, i) => (n.kind === 'corridor' ? i : -1)).filter((i) => i >= 0));
  const pairs: [number, number][] = [];
  while (left.size > 0) {
    let at = [...left].sort((a, b) => nodes[a]!.x - nodes[b]!.x || nodes[a]!.y - nodes[b]!.y)[0]!;
    left.delete(at);
    for (;;) {
      let best = -1;
      let bestD = CHAIN_MAX;
      for (const j of left) {
        const d = dist(nodes[at]!, nodes[j]!);
        if (d <= bestD) {
          best = j;
          bestD = d;
        }
      }
      if (best < 0) break;
      pairs.push([at, best]);
      left.delete(best);
      at = best;
    }
  }
  return pairs;
}

export function assembleFloorplan(draft: DraftMap, opts: AssembleOptions): Assembled {
  const place = placer(opts.buildingPolygon, { rotationDeg: opts.rotationDeg, ...(opts.aspect !== undefined ? { aspect: opts.aspect } : {}) });
  const warnings = [...draft.warnings];
  const nodeId = (i: number): string => `fp-n-${i + 1}`;
  const coords = draft.nodes.map((n) => place(n.x, n.y));
  const features: Feature[] = draft.nodes.map((n, i) => ({
    type: 'Feature', id: nodeId(i), geometry: { type: 'Point', coordinates: coords[i]! }, properties: nodeProps(n, opts),
  }));

  // ---- edges ----
  let skipped = 0;
  const seen = new Set<string>();
  const pairs: [number, number][] = [];
  const add = (a: number, b: number): void => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (a === b || seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);
    pairs.push([a, b]);
  };

  const corridorIdx = draft.nodes.map((n, i) => (n.kind === 'corridor' ? i : -1)).filter((i) => i >= 0);
  if (draft.corridors.length > 0) for (const c of draft.corridors) add(c.from, c.to);
  else for (const [a, b] of chainPairs(draft.nodes)) add(a, b);

  let far = 0;
  const others = draft.nodes.map((n, i) => (n.kind === 'corridor' ? -1 : i)).filter((i) => i >= 0);
  for (const i of others) {
    let best = -1;
    let bestD = ATTACH_MAX;
    for (const j of corridorIdx) {
      const d = dist(draft.nodes[i]!, draft.nodes[j]!);
      if (d <= bestD) {
        best = j;
        bestD = d;
      }
    }
    if (best < 0) {
      far++;
      continue;
    }
    add(i, best);
  }
  if (others.length > 0 && corridorIdx.length === 0) {
    warnings.push('복도 점을 찾지 못해 문·계단·엘리베이터·화장실을 복도에 잇지 못했습니다.');
  } else if (far > 0) {
    warnings.push(`복도에서 너무 먼 지점 ${far}개는 잇지 않았습니다. 편집기에서 이어 주세요.`);
  }
  if (skipped > 0) warnings.push(`같은 점끼리 잇거나 겹치는 구간 ${skipped}개는 버렸습니다.`);

  pairs.forEach(([a, b], k) => {
    features.push({
      type: 'Feature', id: `fp-e-${k + 1}`, geometry: { type: 'LineString', coordinates: [coords[a]!, coords[b]!] },
      properties: {
        kind: 'edge', source: SOURCE, rev: 1, needs_check: true,
        highway: 'corridor', edge_type: 'indoor', from: nodeId(a), to: nodeId(b),
        bidirectional: true, step_free: null, level_from: opts.level, level_to: opts.level,
        building_from: opts.buildingId, building_to: opts.buildingId,
      },
    });
  });

  const count = (kind: DraftNode['kind']): number => draft.nodes.filter((n) => n.kind === kind).length;
  if (draft.nodes.length === 0) warnings.push('안내도에서 지점을 하나도 읽지 못했습니다.');
  return {
    geojson: { type: 'FeatureCollection', features },
    summary: {
      nodeCount: features.filter((f) => f.geometry.type === 'Point').length,
      edgeCount: features.filter((f) => f.geometry.type === 'LineString').length,
      doors: count('door'),
      restrooms: count('restroom'),
      stairs: count('stair_landing'),
      elevators: count('elevator_stop'),
      skippedEdges: skipped + far,
      warnings,
    },
  };
}

