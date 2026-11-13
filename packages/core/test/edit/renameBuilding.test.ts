import { describe, expect, it } from 'vitest';
import {
  addRoom, annotationOf, checkInvariants, createHistory, parseCampus, renameBuilding, serialize, setBuildingLevels, validateCampus,
  type EditState,
} from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixture, fixtureState } from './helpers.ts';

const square = [[[127.00045, 37.00055], [127.00055, 37.00055], [127.00055, 37.00068], [127.00045, 37.00068], [127.00045, 37.00055]]] as [number, number][][];

async function withRoom(): Promise<EditState> {
  const s = await fixtureState();
  return addRoom({ id: 'r_A_4_408', polygon: square, props: { kind: 'room', building_id: 'bldg_A', level: 4, room_ref: '408', source: 'estimate' } }, ctx()).apply(s);
}

describe('renameBuilding', () => {
  it('changes the code everywhere the building is referenced, and nothing else', async () => {
    const s = await withRoom();
    const next = expectInputUntouched(s, renameBuilding('A', 'ENG1'));
    expect(next.buildings['A']).toBeUndefined();
    expect(next.buildings['ENG1']).toMatchObject({ id: 'bldg_ENG1', props: { code: 'ENG1', name: s.buildings['A']!.props.name, rev: s.buildings['A']!.props.rev + 1 } });
    // nothing still points at the old building id
    expect(JSON.stringify(next)).not.toContain('bldg_A"');
    expect(Object.values(next.nodes).filter((n) => n.props.building_id === 'bldg_A')).toEqual([]);
    const inside = Object.values(s.nodes).filter((n) => n.props.building_id === 'bldg_A');
    expect(inside.length).toBeGreaterThan(5);
    for (const n of inside) expect(next.nodes[n.id]!.props.building_id).toBe('bldg_ENG1'); // Feature ids stay (overrides, measurements and reports point at them)
    expect(next.rooms['r_A_4_408']!.props.building_id).toBe('bldg_ENG1');
    // bridges between A and B / C keep the other end and follow the new id
    expect(next.edges['e_A_3_bridge__B_2_bridge']!.props).toMatchObject({ building_from: 'bldg_ENG1', building_to: 'bldg_B' });
    expect(next.edges['e_A_3_north__C_5_bridge']!.props).toMatchObject({ building_from: 'bldg_ENG1', building_to: 'bldg_C' });
    // the buildings that were not renamed are untouched
    expect(next.buildings['B']).toEqual(s.buildings['B']);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('renames elevator_id with the code and keeps each elevator\'s stops together', async () => {
    const s = await fixtureState();
    const before = Object.values(s.nodes).filter((n) => n.props.elevator_id !== undefined && n.props.building_id === 'bldg_A');
    expect(before.length).toBeGreaterThan(0);
    const next = renameBuilding('A', 'ENG1').apply(s);
    for (const n of before) expect(next.nodes[n.id]!.props.elevator_id).toBe(n.props.elevator_id!.replace(/^A(?=[-_]|$)/, 'ENG1'));
    expect(new Set(before.map((n) => next.nodes[n.id]!.props.elevator_id)).size).toBe(new Set(before.map((n) => n.props.elevator_id)).size);
  });

  it('bumps rev of every Feature it touches and of no other', async () => {
    const s = await fixtureState();
    const next = renameBuilding('A', 'ENG1').apply(s);
    for (const n of Object.values(s.nodes)) {
      const touched = n.props.building_id === 'bldg_A';
      expect(next.nodes[n.id]!.props.rev).toBe(n.props.rev + (touched ? 1 : 0));
    }
    for (const e of Object.values(s.edges)) {
      const touched = e.props.building_from === 'bldg_A' || e.props.building_to === 'bldg_A';
      expect(next.edges[e.id]!.props.rev).toBe(e.props.rev + (touched ? 1 : 0));
    }
  });

  it('is one history entry: one undo restores everything', async () => {
    const s = await withRoom();
    const after = expectUndoRedo(s, renameBuilding('A', 'ENG1'));
    const h = createHistory(s);
    h.perform(renameBuilding('A', 'ENG1'));
    expect(h.undo()).toEqual(s);
    expect(after.buildings['ENG1']).toBeDefined();
  });

  it('moves the files: the folder follows the code, the old one is no longer written', async () => {
    const { loaded, state } = await fixture();
    const next = renameBuilding('A', 'ENG1').apply(state);
    const oldPaths = serialize(state, loaded.meta).map((f) => f.path).filter((p) => p.startsWith('buildings/A/'));
    const paths = serialize(next, loaded.meta).map((f) => f.path);
    expect(oldPaths.length).toBeGreaterThan(2);
    expect(paths.some((p) => p.startsWith('buildings/A/'))).toBe(false);
    for (const p of oldPaths) expect(paths).toContain(p.replace('buildings/A/', 'buildings/ENG1/'));
  });

  it('the renamed campus still passes validation', async () => {
    const { loaded, state } = await fixture();
    const check = (st: EditState) => validateCampus(parseCampus(serialize(st, loaded.meta))).errors.map((e) => e.code);
    const before = check(state);
    const next = renameBuilding('A', 'ENG1').apply(state);
    expect(check(next)).toEqual(before);
  });

  it('refuses a code that is taken, not letters and digits, empty or unchanged, and an unknown building', async () => {
    const s = await fixtureState();
    expect(renameBuilding('A', 'B').disabled(s)).toMatch(/이미 있는 건물 코드/);
    expect(renameBuilding('A', 'b-1').disabled(s)).toMatch(/영문자와 숫자/);
    expect(renameBuilding('A', '').disabled(s)).toMatch(/영문자와 숫자/);
    expect(renameBuilding('A', 'A').disabled(s)).toMatch(/같습니다/);
    expect(renameBuilding('Z', 'ENG1').disabled(s)).toMatch(/없습니다/);
    expect(renameBuilding('A', 'ENG1').disabled(s)).toBe(false);
  });

  it('refuses when an elevator_id it would produce is already used by another building', async () => {
    const s = await fixtureState();
    const a = Object.values(s.nodes).find((n) => n.props.building_id === 'bldg_A' && n.props.elevator_id)!;
    const b = Object.values(s.nodes).find((n) => n.props.building_id === 'bldg_B')!;
    const clash: EditState = { ...s, nodes: { ...s.nodes, [b.id]: { ...b, props: { ...b.props, elevator_id: a.props.elevator_id!.replace(/^A/, 'ENG1') } } } };
    expect(renameBuilding('A', 'ENG1').disabled(clash)).toMatch(/elevator_id/);
  });

  it('warns about measurements of a renamed elevator, and names the new code in the annotation', async () => {
    const s = await fixtureState();
    const id = Object.values(s.nodes).find((n) => n.props.building_id === 'bldg_A' && n.props.elevator_id)!.props.elevator_id!;
    const warn = renameBuilding('A', 'ENG1', ctx(1, { observationTargets: new Set([`elevator:${id}`]) })).warnings!(s);
    expect(warn.join(' ')).toContain(id);
    expect(renameBuilding('A', 'ENG1').warnings!(s)).toEqual([]);
    expect(annotationOf(renameBuilding('A', 'ENG1'), s)).toBe('건물 코드 A → ENG1');
  });
});

describe('setBuildingLevels', () => {
  it('adds levels and keeps the rest', async () => {
    const s = await fixtureState();
    const next = expectUndoRedo(s, setBuildingLevels('B', [1, 2, 3, -1]));
    expect(next.buildings['B']!.props.levels).toEqual([-1, 1, 2, 3]);
    expect(next.buildings['B']!.props.rev).toBe(s.buildings['B']!.props.rev + 1);
  });

  it('refuses to remove a level that has points, and says which ones and how many', async () => {
    const s = await fixtureState();
    const reason = setBuildingLevels('A', [1, 2, 3]).disabled(s);
    expect(reason).toMatch(/4층/);
    expect(reason).toMatch(/지점 \d+개/);
    expect(setBuildingLevels('A', [1, 2, 3, 4, 5]).disabled(s)).toBe(false);
  });

  it('refuses a level with only a room, and removes an empty one (and its ground-level mark)', async () => {
    const s = await fixtureState();
    const empty = setBuildingLevels('B', [1, 2, 3]).apply(s);
    const withRoomOnThree = addRoom({ id: 'r_B_3_1', polygon: square, props: { kind: 'room', building_id: 'bldg_B', level: 3, room_ref: '301', source: 'estimate' } }, ctx()).apply(empty);
    expect(setBuildingLevels('B', [1, 2]).disabled(withRoomOnThree)).toMatch(/3층/);
    expect(setBuildingLevels('B', [1, 2]).apply(empty).buildings['B']!.props.levels).toEqual([1, 2]);
  });

  it('keeps ground_levels inside levels', async () => {
    const s = await fixtureState();
    const grown = setBuildingLevels('B', [-1, 1, 2]).apply(s);
    const drop = setBuildingLevels('B', [1, 2]).apply(grown);
    expect(drop.buildings['B']!.props.ground_levels.every((l) => drop.buildings['B']!.props.levels.includes(l))).toBe(true);
  });

  it('refuses no levels, level 0, a repeat, and an unknown building', async () => {
    const s = await fixtureState();
    expect(setBuildingLevels('B', []).disabled(s)).toMatch(/하나 이상/);
    expect(setBuildingLevels('B', [0, 1]).disabled(s)).toMatch(/0이 아닌 정수/);
    expect(setBuildingLevels('B', [1, 1]).disabled(s)).toMatch(/두 번/);
    expect(setBuildingLevels('Z', [1]).disabled(s)).toMatch(/없습니다/);
  });
});
