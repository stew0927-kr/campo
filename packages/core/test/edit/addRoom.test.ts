import { describe, expect, it } from 'vitest';
import { addRoom, checkInvariants, createIdGen, type NewRoom } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState, newIds } from './helpers.ts';

const room: NewRoom = {
  polygon: [[[127.00045, 37.00055], [127.00055, 37.00055], [127.00055, 37.00068], [127.00045, 37.00068], [127.00045, 37.00055]]],
  props: { kind: 'room', building_id: 'bldg_A', level: 4, room_ref: '408', name: '408호', source: 'estimate' },
};

describe('addRoom', () => {
  it('adds a room at rev 1 with an r_{code}_{level}_ id', async () => {
    const s = await fixtureState();
    const next = addRoom(room, ctx(8)).apply(s);
    const [id] = newIds(s, next);
    expect(id).toMatch(/^r_A_4_[0-9a-z]{6}$/);
    expect(next.rooms[id!]!.props.rev).toBe(1);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('needs a real building and level, a free id and a closed ring', async () => {
    const s = await fixtureState();
    expect(addRoom({ ...room, props: { ...room.props, building_id: 'bldg_Z' } }, ctx()).disabled(s)).toMatch(/건물/);
    expect(addRoom({ ...room, props: { ...room.props, level: 7 } }, ctx()).disabled(s)).toMatch(/levels/);
    expect(addRoom({ ...room, id: 'bldg_A' }).disabled(s)).toMatch(/이미 있는 id/);
    expect(addRoom({ ...room, polygon: [[[127, 37], [127.1, 37], [127.1, 37.1]]] }, ctx()).disabled(s)).toMatch(/닫힌 고리/);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), addRoom(room, ctx()));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), addRoom(room, ctx()));
  });

  it('same seed, same id', async () => {
    const s = await fixtureState();
    expect(newIds(s, addRoom(room, { ids: createIdGen(21) }).apply(s))).toEqual(newIds(s, addRoom(room, { ids: createIdGen(21) }).apply(s)));
  });
});
