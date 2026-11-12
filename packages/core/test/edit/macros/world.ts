// A small synthetic building for the macro tests, laid out in metres near [0, 0] so distances are easy to read.
import type { EdgeProperties, EditEdge, EditNode, EditState, Highway, NodeType, Position } from '../../../src/index.ts';
import { deepFreeze } from '../helpers.ts';

/** Degrees per metre at the equator with Turf's earth radius (6371008.8 m). */
export const M = 1 / ((6371008.8 * Math.PI) / 180);

/** Metres east / north of [0, 0] as [lng, lat]. */
export const xy = (x: number, y: number): Position => [x * M, y * M];

/** [lng, lat] back to metres. */
export const toXY = (p: Position): [number, number] => [p[0] / M, p[1] / M];

export const B = 'bldg_T';

export function node(id: string, at: [number, number], level: number, node_type: NodeType = 'corridor'): EditNode {
  return { id, coord: xy(...at), props: { kind: 'node', node_type, building_id: B, level, source: 'x', rev: 1 } };
}

export function edge(id: string, from: string, to: string, vertices: [number, number][] = [], extra: Partial<EdgeProperties> & { highway?: Highway } = {}): EditEdge {
  return {
    id,
    vertices: vertices.map((v) => xy(...v)),
    props: { kind: 'edge', highway: 'corridor', edge_type: 'indoor', from, to, bidirectional: true, step_free: null, source: 'x', rev: 1, ...extra },
  };
}

const ring = (x0: number, y0: number, x1: number, y1: number): Position[] => [xy(x0, y0), xy(x1, y0), xy(x1, y1), xy(x0, y1), xy(x0, y0)];

/**
 * Level 1:
 * - straight corridor e_s: (0,0) → (40,0)
 * - bent corridor e_b: (0,30) → bend (20,30) → (20,50)
 * - chain e_c1: (60,0) → (80,0), e_c2: (80,20) → (80,0) (drawn towards the shared node)
 * - steps e_t: (60,40) → (90,40), and a corridor e_k 5m north of it: (60,45) → (90,45)
 * - room r_T_1_101: x 5..15, y 2..10 (north of e_s)
 * Level 2:
 * - corridor e_u: (0,3.5) → (40,3.5), right above e_s and closer to doors put north of e_s
 */
export function world(): EditState {
  const nodes = [
    node('n_s1', [0, 0], 1), node('n_s2', [40, 0], 1),
    node('n_b1', [0, 30], 1), node('n_b2', [20, 50], 1),
    node('n_c1', [60, 0], 1), node('n_c2', [80, 0], 1), node('n_c3', [80, 20], 1),
    node('n_t1', [60, 40], 1, 'stair_landing'), node('n_t2', [90, 40], 1, 'stair_landing'),
    node('n_k1', [60, 45], 1), node('n_k2', [90, 45], 1),
    node('n_u1', [0, 3.5], 2), node('n_u2', [40, 3.5], 2),
  ];
  const edges = [
    edge('e_s', 'n_s1', 'n_s2'),
    edge('e_b', 'n_b1', 'n_b2', [[20, 30]]),
    edge('e_c1', 'n_c1', 'n_c2'),
    edge('e_c2', 'n_c3', 'n_c2'),
    edge('e_t', 'n_t1', 'n_t2', [], { highway: 'steps', step_free: false, step_count: 20 }),
    edge('e_k', 'n_k1', 'n_k2'),
    edge('e_u', 'n_u1', 'n_u2'),
  ];
  return deepFreeze({
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: Object.fromEntries(edges.map((e) => [e.id, e])),
    buildings: {
      T: {
        id: B,
        polygon: [ring(-10, -10, 110, 110)],
        props: { kind: 'building', name: '시험동', code: 'T', levels: [1, 2], ground_levels: [1], source: 'x', rev: 1 },
      },
    },
    rooms: {
      r_T_1_101: { id: 'r_T_1_101', polygon: [ring(5, 2, 15, 10)], props: { kind: 'room', building_id: B, level: 1, room_ref: '101', source: 'x', rev: 1 } },
    },
  });
}

export { ring };
