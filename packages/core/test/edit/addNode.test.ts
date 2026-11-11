import { describe, expect, it } from 'vitest';
import { addNode, checkInvariants, createIdGen, type NewNode } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState, newIds } from './helpers.ts';

const door: NewNode = {
  coord: [127.00058, 37.00052],
  props: { kind: 'node', node_type: 'door', building_id: 'bldg_A', level: 3, room_ref: '301', door_role: 'front', source: 'estimate' },
};

describe('addNode', () => {
  it('adds a node at rev 1 with a readable prefix', async () => {
    const s = await fixtureState();
    const next = addNode(door, ctx(7)).apply(s);
    const [id] = newIds(s, next);
    expect(id).toMatch(/^n_A_3_door_[0-9a-z]{6}$/);
    expect(next.nodes[id!]!.props.rev).toBe(1);
    expect(Object.keys(next.nodes[id!]!.props).at(-1)).toBe('rev');
    expect(next.nodes[id!]!.coord).toEqual(door.coord);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('outdoor nodes get n_out_', async () => {
    const s = await fixtureState();
    const next = addNode({ coord: [127.0001, 37.0001], props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate' } }, ctx(3)).apply(s);
    expect(newIds(s, next)[0]).toMatch(/^n_out_[0-9a-z]{6}$/);
  });

  it('is disabled for a taken id, a missing building or level, and outdoor with a level', async () => {
    const s = await fixtureState();
    expect(addNode({ ...door, id: 'n_A_1_hall' }).disabled(s)).toMatch(/이미 있는 id/);
    expect(addNode({ ...door, props: { ...door.props, building_id: 'bldg_Z' } }, ctx()).disabled(s)).toMatch(/건물/);
    expect(addNode({ ...door, props: { ...door.props, level: 9 } }, ctx()).disabled(s)).toMatch(/levels/);
    expect(addNode({ ...door, props: { ...door.props, building_id: null } }, ctx()).disabled(s)).toMatch(/level도 null/);
    expect(addNode({ ...door, id: 'n_A_1_hall' }).apply(s)).toBe(s);
  });

  it('is disabled for an elevator stop away from its shaft (I5), allowed on it', async () => {
    const s = await fixtureState();
    const stop = (coord: [number, number]): NewNode => ({ coord, props: { kind: 'node', node_type: 'elevator_stop', building_id: 'bldg_A', level: 3, elevator_id: 'A_elevA', source: 'estimate' } });
    expect(addNode(stop([127.0009, 37.0006]), ctx()).disabled(s)).toMatch(/A_elevA/);
    expect(addNode(stop([127.0008, 37.0005]), ctx()).disabled(s)).toBe(false);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await fixtureState(), addNode(door, ctx()));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await fixtureState(), addNode(door, ctx()));
  });

  it('same seed, same id; applying one action twice gives one id', async () => {
    const s = await fixtureState();
    const a = newIds(s, addNode(door, { ids: createIdGen(99) }).apply(s));
    const b = newIds(s, addNode(door, { ids: createIdGen(99) }).apply(s));
    expect(a).toEqual(b);
    const action = addNode(door, ctx(5));
    expect(newIds(s, action.apply(s))).toEqual(newIds(s, action.apply(s)));
  });

  it('needs an id generator when no id is given', () => {
    expect(() => addNode(door)).toThrow();
  });
});
