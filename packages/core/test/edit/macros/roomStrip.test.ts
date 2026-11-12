import { describe, expect, it } from 'vitest';
import {
  annotationOf,
  checkInvariants,
  createHistory,
  createIdGen,
  refAfter,
  roomStrip,
  roomStripAction,
  stripDoors,
  type RoomStripOptions,
} from '../../../src/index.ts';
import { ctx, expectInputUntouched, newIds } from '../helpers.ts';
import { toXY, world, xy } from './world.ts';

const strip: RoomStripOptions = {
  corridorEdgeIds: ['e_s'],
  side: 'left',
  startRef: '101',
  refStep: 2,
  count: 3,
  doorsPerRoom: 2,
  firstDoor: xy(5, 2),
  lastDoor: xy(35, 2),
};

describe('roomStrip', () => {
  it('3 rooms × 2 doors between the two clicks, numbers 101, 103, 105, front = farther along the corridor', () => {
    const s = world();
    const r = roomStrip(s, strip, ctx(6));
    if (!r.ok) throw new Error(r.reason);
    expect(r.rooms.map((x) => x.room_ref)).toEqual(['101', '103', '105']);
    expect(r.doorIds).toHaveLength(6);
    // room width w = 30 / 2.6; doors at i·w and i·w + 0.6·w from x = 5
    const w = 30 / 2.6;
    r.rooms.forEach((room, i) => {
      const [front, back] = room.doorIds.map((id) => r.state.nodes[id]!);
      expect(front!.props).toMatchObject({ node_type: 'door', room_ref: room.room_ref, door_role: 'front' });
      expect(back!.props).toMatchObject({ room_ref: room.room_ref, door_role: 'back' });
      expect(toXY(back!.coord)[0]).toBeCloseTo(5 + i * w, 3);
      expect(toXY(front!.coord)[0]).toBeCloseTo(5 + i * w + 0.6 * w, 3);
      expect(toXY(front!.coord)[1]).toBeCloseTo(2, 3);
    });
    expect(checkInvariants(r.state)).toEqual([]);
    expect(annotationOf(r.action, s)).toBe('강의실 3개 문 6개 놓기');
  });

  it('side right puts the doors on the other side', () => {
    const s = world();
    const plan = stripDoors(s, { ...strip, side: 'right' });
    if (typeof plan === 'string') throw new Error(plan);
    for (const d of plan.doors) expect(toXY(d.coord)[1]).toBeCloseTo(-2, 3);
    expect(roomStrip(s, { ...strip, side: 'right' }, ctx()).ok).toBe(true);
  });

  it('bent chain, one door per room, numbers keep their prefix and zeros', () => {
    const s = world();
    // chain (60,0) → (80,0) → (80,20); clicks at 5 m and 25 m along it, 2 m to the left
    const r = roomStrip(s, {
      corridorEdgeIds: ['e_c1', 'e_c2'], side: 'left', startRef: 'B099', count: 3, doorsPerRoom: 1, firstDoor: xy(65, 2), lastDoor: xy(78, 5),
    }, ctx(2));
    if (!r.ok) throw new Error(r.reason);
    expect(r.rooms.map((x) => x.room_ref)).toEqual(['B099', 'B100', 'B101']);
    expect(r.doorIds.map((id) => toXY(r.state.nodes[id]!.coord).map((v) => Math.round(v * 10) / 10))).toEqual([[65, 2], [75, 2], [78, 5]]);
    expect(r.doorIds.every((id) => r.state.nodes[id]!.props.door_role === 'front')).toBe(true);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('only the chosen corridor edges are used', () => {
    const s = world();
    // e_u (level 2) and other level-1 corridors are never candidates; the pieces split off e_s are
    const r = roomStrip(s, strip, ctx());
    if (!r.ok) throw new Error(r.reason);
    for (const id of ['e_b', 'e_c1', 'e_c2', 'e_k', 'e_t', 'e_u']) expect(r.state.edges[id]).toBe(s.edges[id]);
  });

  it('reasons', () => {
    const s = world();
    expect(roomStripAction({ ...strip, count: 0 }, ctx()).disabled(s)).toMatch(/count/);
    expect(roomStripAction({ ...strip, startRef: '삼백' }, ctx()).disabled(s)).toMatch(/startRef/);
    expect(roomStripAction({ ...strip, firstDoor: xy(5, 0.5), lastDoor: xy(35, 0.5) }, ctx()).disabled(s)).toMatch(/1m 넘게/);
    expect(roomStripAction({ ...strip, corridorEdgeIds: ['e_t'] }, ctx()).disabled(s)).toMatch(/복도\(corridor\)/);
    expect(roomStripAction({ ...strip, firstDoor: xy(5, 12), lastDoor: xy(35, 12) }, ctx()).disabled(s)).toMatch(/8m 안/);
  });

  it('refAfter', () => {
    expect(refAfter('301', 4)).toBe('305');
    expect(refAfter('B099', 2)).toBe('B101');
    expect(refAfter('A-07', 1)).toBe('A-08');
    expect(refAfter('room', 1)).toBeUndefined();
  });

  it('one history entry for 6 doors; undo restores the start with I1–I5 intact', () => {
    const s = world();
    const h = createHistory(s);
    const after = h.perform(roomStripAction(strip, ctx()));
    expect(h.size()).toBe(1);
    expect(newIds(s, after)).toHaveLength(24);
    expect(h.undo()).toEqual(s);
    expect(checkInvariants(h.current())).toEqual([]);
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toEqual(after);
  });

  it('frozen input, same seed same ids', () => {
    const s = world();
    expectInputUntouched(s, roomStripAction(strip, ctx()));
    const run = () => {
      const r = roomStrip(s, strip, { ids: createIdGen(31) });
      return r.ok ? newIds(s, r.state) : [];
    };
    expect(run()).toEqual(run());
  });
});
