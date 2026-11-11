import { describe, expect, it } from 'vitest';
import { addRoom, deleteRooms, doorsOfRoom, type EditState } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

const ring = [[[127.00045, 37.00055], [127.00055, 37.00055], [127.00055, 37.00068], [127.00045, 37.00068], [127.00045, 37.00055]]] as [number, number][][];

async function withRooms(): Promise<EditState> {
  let s = await fixtureState();
  s = addRoom({ id: 'r_A_4_408', polygon: ring, props: { kind: 'room', building_id: 'bldg_A', level: 4, room_ref: '408', source: 'estimate' } }).apply(s);
  s = addRoom({ id: 'r_A_3_408', polygon: ring, props: { kind: 'room', building_id: 'bldg_A', level: 3, room_ref: '408', source: 'estimate' } }).apply(s);
  return s;
}

describe('deleteRooms', () => {
  it('deletes rooms; their doors stay', async () => {
    const s = await withRooms();
    const next = deleteRooms(['r_A_4_408']).apply(s);
    expect(next.rooms['r_A_4_408']).toBeUndefined();
    expect(next.rooms['r_A_3_408']).toBeDefined();
    expect(next.nodes['n_A_4_408door']).toEqual(s.nodes['n_A_4_408door']);
  });

  it('doorsOfRoom: doors with the same room_ref in the same building and level', async () => {
    const s = await withRooms();
    expect(doorsOfRoom(s, 'r_A_4_408').map((n) => n.id)).toEqual(['n_A_4_408door']);
    expect(doorsOfRoom(s, 'r_A_3_408')).toEqual([]);
    expect(doorsOfRoom(s, 'r_nope')).toEqual([]);
  });

  it('is disabled for no ids or a missing room', async () => {
    const s = await withRooms();
    expect(deleteRooms([]).disabled(s)).toMatch(/하나 이상/);
    expect(deleteRooms(['r_nope']).disabled(s)).toMatch(/r_nope/);
  });

  it('warns about an override on a deleted room', async () => {
    const s = await withRooms();
    expect(deleteRooms(['r_A_4_408'], ctx(1, { overrideIds: new Set(['r_A_4_408']) })).warnings!(s)).toEqual([
      '"r_A_4_408"에 override가 있습니다. overrides.json에서 이 항목을 지우세요.',
    ]);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await withRooms(), deleteRooms(['r_A_4_408', 'r_A_3_408']));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await withRooms(), deleteRooms(['r_A_4_408', 'r_A_3_408']));
  });
});
