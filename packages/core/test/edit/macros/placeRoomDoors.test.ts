import { describe, expect, it } from 'vitest';
import {
  annotationOf,
  checkInvariants,
  createHistory,
  createIdGen,
  metres,
  placeRoomDoors,
  placeRoomDoorsAction,
  roomDoorSpots,
  type EditState,
  type Position,
} from '../../../src/index.ts';
import { ctx, deepFreeze, expectInputUntouched, newIds } from '../helpers.ts';
import { B, edge, ring, toXY, world, xy } from './world.ts';

const near = (p: Position, q: [number, number]) => {
  const [x, y] = toXY(p);
  expect(x).toBeCloseTo(q[0], 3);
  expect(y).toBeCloseTo(q[1], 3);
};

describe('placeRoomDoors', () => {
  it('both doors on the side facing the corridor, 20% / 80% and 0.3 m inside; front = farther along e_s', () => {
    const s = world();
    const r = placeRoomDoors(s, 'r_T_1_101', { doors: 'both' }, ctx(4));
    if (!r.ok) throw new Error(r.reason);
    expect(r.side.map((p) => toXY(p).map(Math.round))).toEqual([[5, 2], [15, 2]]);
    const [front, back] = r.doorIds.map((id) => r.state.nodes[id]!);
    near(front!.coord, [13, 2.3]);
    near(back!.coord, [7, 2.3]);
    expect(front!.props).toMatchObject({ node_type: 'door', room_ref: '101', door_role: 'front', building_id: B, level: 1 });
    expect(back!.props).toMatchObject({ room_ref: '101', door_role: 'back' });
    // each door is linked to a new node on e_s
    for (const d of [front!, back!]) {
      const link = Object.values(r.state.edges).find((e) => e.props.from === d.id)!;
      expect(toXY(r.state.nodes[link.props.to]!.coord)[1]).toBeCloseTo(0, 6);
    }
    expect(checkInvariants(r.state)).toEqual([]);
    expect(annotationOf(r.action, s)).toBe('강의실 앞문·뒷문 놓기');
  });

  it('inset is 0.3 m (metres, not kilometres)', () => {
    const s = world();
    const where = roomDoorSpots(s, s.rooms['r_T_1_101']!.polygon, { building_id: B, level: 1 });
    if (typeof where === 'string') throw new Error(where);
    // the side is y = 2 m
    for (const spot of where.spots) expect(metres(spot.coord, [spot.coord[0], xy(0, 2)[1]])).toBeCloseTo(0.3, 3);
  });

  it('a polygon drawn the other way round gives the same doors', () => {
    const s = world();
    const cw = [[...ring(5, 2, 15, 10)].reverse()];
    const a = roomDoorSpots(s, cw, { building_id: B, level: 1 });
    const b = roomDoorSpots(s, s.rooms['r_T_1_101']!.polygon, { building_id: B, level: 1 });
    if (typeof a === 'string' || typeof b === 'string') throw new Error('no spots');
    a.spots.forEach((spot, i) => {
      expect(spot.door_role).toBe(b.spots[i]!.door_role);
      expect(metres(spot.coord, b.spots[i]!.coord)).toBeLessThan(1e-6);
    });
  });

  it('a corridor drawn the other way flips front and back', () => {
    const base = world();
    const s: EditState = deepFreeze({ ...base, edges: { ...base.edges, e_s: edge('e_s', 'n_s2', 'n_s1') } });
    const r = placeRoomDoors(s, 'r_T_1_101', { doors: 'front' }, ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.doorIds).toHaveLength(1);
    near(r.state.nodes[r.doorIds[0]!]!.coord, [7, 2.3]);
  });

  it('a polygon needs a building and a level; room_ref comes from the options', () => {
    const s = world();
    const poly = [ring(20, 2, 30, 10)];
    expect(placeRoomDoorsAction(poly, { doors: 'back' }, ctx()).disabled(s)).toMatch(/building_id/);
    const r = placeRoomDoors(s, poly, { doors: 'back', building_id: B, level: 1, room_ref: '103' }, ctx());
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.nodes[r.doorIds[0]!]!.props).toMatchObject({ room_ref: '103', door_role: 'back' });
    expect(placeRoomDoorsAction('r_nope', { doors: 'both' }, ctx()).disabled(s)).toMatch(/없습니다/);
    // a room on level 2 sees only e_u
    const up = placeRoomDoors(s, poly, { doors: 'front', building_id: B, level: 2 }, ctx());
    expect(up.ok && up.state.nodes[up.doorIds[0]!]!.props.level).toBe(2);
  });

  it('one history entry; undo restores the start with I1–I5 intact', () => {
    const s = world();
    const h = createHistory(s);
    const after = h.perform(placeRoomDoorsAction('r_T_1_101', { doors: 'both' }, ctx()));
    expect(h.size()).toBe(1);
    expect(newIds(s, after)).toHaveLength(8);
    expect(h.undo()).toEqual(s);
    expect(checkInvariants(h.current())).toEqual([]);
    expect(h.redo()).toEqual(after);
  });

  it('frozen input, same seed same ids', () => {
    const s = world();
    expectInputUntouched(s, placeRoomDoorsAction('r_T_1_101', { doors: 'both' }, ctx()));
    const run = () => {
      const r = placeRoomDoors(s, 'r_T_1_101', { doors: 'both' }, { ids: createIdGen(8) });
      return r.ok ? newIds(s, r.state) : [];
    };
    expect(run()).toEqual(run());
  });
});
