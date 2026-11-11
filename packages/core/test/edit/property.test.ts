// D2: whatever the edits, I1–I5 hold after every step, and undoing everything gives the start back (I6).
// Also checks the rev rule: against the base state each Feature is base rev (unchanged) or base rev + 1 (changed), new ones are 1.
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  addRoom,
  checkInvariants,
  createHistory,
  createIdGen,
  deleteBuilding,
  deleteEdges,
  deleteNodes,
  deleteRooms,
  mergeNodes,
  moveNode,
  scopeOfNode,
  setProps,
  splitEdgeAt,
  toFeatures,
  type Action,
  type EditContext,
  type EditState,
  type Highway,
  type EdgeType,
  type Position,
  type PropsPatch,
} from '../../src/index.ts';
import { fixtureState } from './helpers.ts';

const KINDS = [
  'addNode', 'addEdge', 'deleteNodes', 'deleteEdges', 'deleteBuilding', 'moveNode', 'mergeNodes',
  'splitEdgeAt', 'setProps', 'addRoom', 'deleteRooms', 'undo', 'redo',
] as const;
type Kind = (typeof KINDS)[number];

interface Op {
  kind: Kind;
  a: number;
  b: number;
  t: number;
  flag: boolean;
}

const opArb: fc.Arbitrary<Op> = fc.record({
  // deleteBuilding wipes a third of the fixture, so it is rare. fast-check leans to the first option, so it goes last.
  kind: fc.oneof(
    { weight: 30, arbitrary: fc.constantFrom<Kind>(...KINDS.filter((k) => k !== 'deleteBuilding')) },
    { weight: 1, arbitrary: fc.constant<Kind>('deleteBuilding') },
  ),
  a: fc.nat(1000),
  b: fc.nat(1000),
  // 0.01..0.99: fc.double leans to its bounds, which would put most split points on an edge end
  t: fc.integer({ min: 1, max: 99 }).map((x) => x / 100),
  flag: fc.boolean(),
});

const HIGHWAYS: Highway[] = ['corridor', 'footway', 'steps', 'ramp'];
const EDGE_TYPES: EdgeType[] = ['indoor', 'outdoor', 'portal'];
const PATCHES: PropsPatch[] = [
  { name: '이름' },
  { name: undefined },
  { needs_check: true },
  { step_free: null },
  { elevator_id: 'A_elevA' },
  { elevator_id: undefined },
  { node_type: 'elevator_stop', elevator_id: 'A_elevA' },
  { edge_type: 'outdoor' },
  { highway: 'corridor' },
  { step_count: 5 },
  { room_ref: '408' },
];

const pick = <T,>(xs: readonly T[], n: number): T | undefined => (xs.length === 0 ? undefined : xs[n % xs.length]);
const offset = (p: Position, t: number, k = 1): Position => [p[0] + (t - 0.5) * 2e-4 * k, p[1] + (0.5 - t) * 1e-4 * k];

function along(coords: Position[], t: number, side: number): Position {
  const segs = coords.length - 1;
  const i = Math.min(segs - 1, Math.floor(t * segs));
  const f = t * segs - i;
  const a = coords[i]!;
  const b = coords[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f + side * 2e-6];
}

/** Turn an op into an action on the current state (ids are picked by index from the state). */
function toAction(s: EditState, op: Op, ctx: EditContext): Action | null {
  const nodes = Object.keys(s.nodes).sort();
  const edges = Object.keys(s.edges).sort();
  const sameScopeAs = (id: string) => nodes.filter((n) => n !== id && scopeOfNode(s.nodes[n]!) === scopeOfNode(s.nodes[id]!));
  switch (op.kind) {
    case 'addNode': {
      const base = s.nodes[pick(nodes, op.a) ?? ''];
      if (!base) return addNode({ coord: [127, 37], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'p' } }, ctx);
      const { building_id, level } = base.props;
      if (op.b % 5 === 0) {
        // an elevator stop: on the shaft or off it (then disabled by I5)
        return addNode({ coord: op.flag ? [127.0008, 37.0005] : offset(base.coord, op.t), props: { kind: 'node', node_type: 'elevator_stop', building_id, level, elevator_id: 'A_elevA', source: 'p' } }, ctx);
      }
      const type = building_id === null ? (op.flag ? 'outdoor' : 'poi') : (op.flag ? 'corridor' : 'door');
      return addNode({ coord: offset(base.coord, op.t), props: { kind: 'node', node_type: type, building_id, level, source: 'p' } }, ctx);
    }
    case 'addEdge': {
      const from = pick(nodes, op.a);
      if (!from) return null;
      const to = op.flag ? pick(sameScopeAs(from), op.b) : pick(nodes, op.b);
      if (!to) return null;
      const highway = HIGHWAYS[op.b % HIGHWAYS.length]!;
      const edge_type = EDGE_TYPES[op.a % EDGE_TYPES.length]!;
      const step = highway === 'steps' ? { step_count: 1 + (op.b % 6) } : {};
      return addEdge({ props: { kind: 'edge', highway, edge_type, from, to, bidirectional: op.t < 0.8, step_free: null, source: 'p', ...step } }, ctx);
    }
    case 'deleteNodes': {
      const ids = [pick(nodes, op.a), op.t < 0.3 ? pick(nodes, op.b) : undefined].filter((x): x is string => x !== undefined);
      return ids.length ? deleteNodes(ids, { heal: op.flag }, ctx) : null;
    }
    case 'deleteEdges': {
      const ids = [pick(edges, op.a), op.flag ? pick(edges, op.b) : undefined].filter((x): x is string => x !== undefined);
      return ids.length ? deleteEdges(ids, ctx) : null;
    }
    case 'deleteBuilding': {
      const code = pick(Object.keys(s.buildings).sort(), op.a);
      return code ? deleteBuilding(code, ctx) : null;
    }
    case 'moveNode': {
      const id = pick(nodes, op.a);
      return id ? moveNode(id, offset(s.nodes[id]!.coord, op.t, 0.3)) : null;
    }
    case 'mergeNodes': {
      const a = pick(nodes, op.a);
      if (!a) return null;
      const b = op.flag ? pick(sameScopeAs(a), op.b) : pick(nodes, op.b);
      return b ? mergeNodes([a, b], ctx) : null;
    }
    case 'splitEdgeAt': {
      const id = pick(edges, op.a);
      if (!id) return null;
      const e = s.edges[id]!;
      const coords = [s.nodes[e.props.from]!.coord, ...e.vertices, s.nodes[e.props.to]!.coord];
      const free = sameScopeAs(e.props.from).filter((n) => n !== e.props.to);
      const nodeId = op.b % 3 === 0 ? pick(free, op.b) : undefined;
      return splitEdgeAt(id, along(coords, op.t, op.flag ? 1 : -1), nodeId === undefined ? {} : { nodeId }, ctx);
    }
    case 'setProps': {
      const all = [...nodes, ...edges, ...Object.values(s.buildings).map((b) => b.id), ...Object.keys(s.rooms).sort()];
      const id = pick(all, op.a);
      return id ? setProps([id], PATCHES[op.b % PATCHES.length]!) : null;
    }
    case 'addRoom': {
      const b = pick(Object.values(s.buildings).sort((x, y) => (x.id < y.id ? -1 : 1)), op.a);
      if (!b) return null;
      const level = op.b % 4 !== 0 ? pick(b.props.levels, op.b)! : 99; // 99: not a level, disabled
      const [x, y] = b.polygon[0]![0]!;
      const ring: Position[] = [[x, y], [x + 1e-5, y], [x + 1e-5, y + 1e-5], [x, y + 1e-5], [x, y]];
      return addRoom({ polygon: [ring], props: { kind: 'room', building_id: b.id, level, room_ref: String(op.b), source: 'p' } }, ctx);
    }
    case 'deleteRooms': {
      const id = pick(Object.keys(s.rooms).sort(), op.a);
      return id ? deleteRooms([id], ctx) : null;
    }
    default:
      return null;
  }
}

/** Canonical JSON (sorted keys) of each saved Feature without rev. */
function contentById(s: EditState): Map<string, { rev: number; content: string }> {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;
  const out = new Map<string, { rev: number; content: string }>();
  for (const f of toFeatures(s)) {
    const { rev, ...props } = f.properties;
    out.set(f.id, { rev, content: JSON.stringify(canon({ geometry: f.geometry, props })) });
  }
  return out;
}

function revProblems(base: EditState, now: EditState): string[] {
  const was = contentById(base);
  const problems: string[] = [];
  for (const [id, { rev, content }] of contentById(now)) {
    const b = was.get(id);
    if (!b) {
      if (rev !== 1) problems.push(`${id}: new but rev ${rev}`);
    } else if (b.content === content ? rev !== b.rev : rev !== b.rev + 1) {
      problems.push(`${id}: base rev ${b.rev}, now ${rev}, content ${b.content === content ? 'same' : 'changed'}`);
    }
  }
  return problems;
}

let start: EditState;
beforeAll(async () => {
  start = await fixtureState();
});

describe('edit engine properties (fast-check)', () => {
  it('I1–I5 hold after every step, revs follow the base, and undoing everything gives the start (I6)', () => {
    const performed = new Map<Kind, number>();
    const refused = new Map<Kind, number>();
    const count = (m: Map<Kind, number>, k: Kind) => m.set(k, (m.get(k) ?? 0) + 1);
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 30 }), (ops) => {
        const ctx: EditContext = {
          ids: createIdGen(4242),
          overrideIds: new Set(['n_A_1_hall', 'e_portal_A_1_main', 'bldg_C']),
          observationTargets: new Set(['edge:e_out_0002__out_0003']),
        };
        const h = createHistory(start);
        for (const op of ops) {
          if (op.kind === 'undo') h.undo();
          else if (op.kind === 'redo') h.redo();
          else {
            const action = toAction(h.current(), op, ctx);
            if (!action) continue;
            const before = h.current();
            if (action.disabled(before) !== false) {
              count(refused, op.kind);
              expect(action.apply(before)).toBe(before);
              continue;
            }
            action.warnings?.(before);
            h.perform(action);
            count(performed, op.kind);
          }
          expect(checkInvariants(h.current())).toEqual([]);
          expect(revProblems(start, h.current())).toEqual([]);
        }
        while (h.canUndo()) h.undo();
        expect(h.current()).toEqual(start);
      }),
      { numRuns: 1000, seed: 20261112 },
    );
    // the generator must actually exercise the actions, not only refuse them
    // The generator must exercise every action, and some refusals too (seeded, so these counts are fixed).
    for (const kind of KINDS.filter((k) => k !== 'undo' && k !== 'redo')) {
      expect(performed.get(kind) ?? 0, kind).toBeGreaterThan(kind === 'deleteRooms' ? 50 : 100);
    }
    expect([...refused.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(300);
  }, 120_000);
});
