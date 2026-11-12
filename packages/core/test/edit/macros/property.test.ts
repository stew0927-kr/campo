// D2 for the macros: random sequences of macros (with undo / redo) keep I1–I5 after every step,
// each macro is one history entry, and undoing everything gives the start back (I6).
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  attachDoorAction,
  checkInvariants,
  createHistory,
  createIdGen,
  densifyCorridorAction,
  edgeCoords,
  isScopeBound,
  placeRoomDoorsAction,
  roomStripAction,
  type Action,
  type EditContext,
  type EditState,
  type Position,
} from '../../../src/index.ts';
import { lineLength, pointAlong, segmentAt, sideways } from '../../../src/edit/macros/geo.ts';
import { fixtureState } from '../helpers.ts';
import { world } from './world.ts';

const KINDS = ['attach', 'attachExisting', 'densify', 'room', 'strip', 'undo', 'redo'] as const;
type Kind = (typeof KINDS)[number];

interface Op {
  kind: Kind;
  a: number;
  t: number;
  u: number;
  off: number;
  flag: boolean;
}

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<Kind>(...KINDS),
  a: fc.nat(1000),
  t: fc.integer({ min: 1, max: 99 }).map((x) => x / 100),
  u: fc.integer({ min: 1, max: 99 }).map((x) => x / 100),
  off: fc.integer({ min: 5, max: 90 }).map((x) => x / 10),
  flag: fc.boolean(),
});

const pick = <T,>(xs: readonly T[], n: number): T | undefined => (xs.length === 0 ? undefined : xs[n % xs.length]);

/** Indoor corridor edges inside one scope (what the macros work on). */
function corridors(s: EditState): string[] {
  return Object.values(s.edges)
    .sort((x, y) => (x.id < y.id ? -1 : 1))
    .filter((e) => e.props.highway === 'corridor' && isScopeBound(e.props) && s.nodes[e.props.from]!.props.building_id !== null)
    .map((e) => e.id);
}

function beside(s: EditState, edgeId: string, t: number, off: number, left: boolean): Position {
  const coords = edgeCoords(s, s.edges[edgeId]!);
  const d = lineLength(coords) * t;
  const [p, q] = segmentAt(coords, d);
  return sideways(p, q, pointAlong(coords, d), off, left ? 'left' : 'right');
}

function toAction(s: EditState, op: Op, ctx: EditContext): Action | null {
  const list = corridors(s);
  const id = pick(list, op.a);
  const scope = id ? s.nodes[s.edges[id]!.props.from]!.props : undefined;
  switch (op.kind) {
    case 'attach': {
      if (!id || !scope) return null;
      return attachDoorAction(beside(s, id, op.t, op.off, op.flag), { building_id: scope.building_id!, level: scope.level!, room_ref: String(op.a) }, ctx);
    }
    case 'attachExisting': {
      const doors = Object.keys(s.nodes).sort().filter((n) => s.nodes[n]!.props.node_type === 'door');
      const door = pick(doors, op.a);
      return door ? attachDoorAction(door, {}, ctx) : null;
    }
    case 'densify':
      return id ? densifyCorridorAction([id], op.flag ? { interval: 1 + op.off } : { count: 1 + (op.a % 4) }, ctx) : null;
    case 'room': {
      const rooms = Object.keys(s.rooms).sort();
      const room = pick(rooms, op.a);
      const doors = (['front', 'back', 'both'] as const)[op.a % 3]!;
      if (room && op.flag) return placeRoomDoorsAction(room, { doors }, ctx);
      if (!id || !scope) return null;
      // a 4 m square room next to a corridor
      const p = beside(s, id, op.t, op.off, op.flag);
      const d = 4e-5;
      const ring: Position[] = [p, [p[0] + d, p[1]], [p[0] + d, p[1] + d], [p[0], p[1] + d], p];
      return placeRoomDoorsAction([ring], { doors, building_id: scope.building_id!, level: scope.level! }, ctx);
    }
    case 'strip': {
      if (!id) return null;
      return roomStripAction({
        corridorEdgeIds: [id],
        side: op.flag ? 'left' : 'right',
        startRef: String(100 + op.a),
        refStep: 1 + (op.a % 2),
        count: 1 + (op.a % 4),
        doorsPerRoom: op.a % 2 === 0 ? 1 : 2,
        firstDoor: beside(s, id, Math.min(op.t, op.u), op.off, op.flag),
        lastDoor: beside(s, id, Math.max(op.t, op.u), op.off, op.flag),
      }, ctx);
    }
    default:
      return null;
  }
}

let starts: EditState[];
beforeAll(async () => {
  starts = [world(), await fixtureState()];
});

describe('macro properties (fast-check)', () => {
  it('I1–I5 after every macro, one entry per macro, undo to the start gives the start (I6)', () => {
    const performed: Record<string, number> = {};
    fc.assert(
      fc.property(fc.nat(1), fc.integer({ min: 1, max: 1e6 }), fc.array(opArb, { minLength: 1, maxLength: 6 }), (which, seed, ops) => {
        const start = starts[which]!;
        const ctx: EditContext = { ids: createIdGen(seed) };
        const h = createHistory(start);
        for (const op of ops) {
          if (op.kind === 'undo') h.undo();
          else if (op.kind === 'redo') h.redo();
          else {
            const action = toAction(h.current(), op, ctx);
            if (!action || action.disabled(h.current()) !== false) continue;
            const before = h.current();
            const after = h.perform(action);
            performed[op.kind] = (performed[op.kind] ?? 0) + 1;
            // one macro = one entry: a single undo takes all of it back, a single redo brings it again
            expect(h.undo()).toEqual(before);
            expect(h.redo()).toEqual(after);
          }
          expect(checkInvariants(h.current())).toEqual([]);
        }
        while (h.canUndo()) {
          h.undo();
          expect(checkInvariants(h.current())).toEqual([]);
        }
        expect(h.current()).toEqual(start);
      }),
      { numRuns: 1000, seed: 20261112 },
    );
    // every macro really ran, not only its disabled path
    for (const k of ['attach', 'attachExisting', 'densify', 'room', 'strip']) expect(performed[k] ?? 0, k).toBeGreaterThan(50);
  }, 120_000);
});
