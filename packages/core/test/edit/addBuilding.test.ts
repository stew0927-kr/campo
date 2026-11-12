import { describe, expect, it } from 'vitest';
import { addBuilding, addNode, checkInvariants, serialize, type NewBuilding, type Position } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

const ring: Position[][] = [[[127.002, 37.001], [127.003, 37.001], [127.003, 37.002], [127.002, 37.002], [127.002, 37.001]]];
const base: NewBuilding = { polygon: ring, code: 'Z', name: 'Z동', levels: [3, 1, 2, -1] };

describe('addBuilding', () => {
  it('adds the building with bldg_ id, rev 1, sorted levels and ground level 1', async () => {
    const next = addBuilding(base).apply(await fixtureState());
    const b = next.buildings['Z']!;
    expect(b.id).toBe('bldg_Z');
    expect(b.polygon).toEqual(ring);
    expect(b.props).toMatchObject({ kind: 'building', name: 'Z동', code: 'Z', levels: [-1, 1, 2, 3], ground_levels: [1], rev: 1, source: 'estimate' });
    expect(checkInvariants(next)).toEqual([]);
  });

  it('takes the lowest level as ground when the building has no 1F, and an explicit ground_levels list', async () => {
    const s = await fixtureState();
    expect(addBuilding({ ...base, levels: [2, 3] }).apply(s).buildings['Z']!.props.ground_levels).toEqual([2]);
    expect(addBuilding({ ...base, ground_levels: [-1, 1] }).apply(s).buildings['Z']!.props.ground_levels).toEqual([-1, 1]);
  });

  it('a footbridge building has one level', async () => {
    const s = await fixtureState();
    expect(addBuilding({ ...base, building_type: 'bridge', levels: [1, 2] }).disabled(s)).toMatch(/구름다리/);
    expect(addBuilding({ ...base, building_type: 'bridge', levels: [1] }).apply(s).buildings['Z']!.props.building_type).toBe('bridge');
  });

  it('refuses bad input with a reason', async () => {
    const s = await fixtureState();
    expect(addBuilding({ ...base, code: 'A' }).disabled(s)).toMatch(/이미 있는 건물 코드/);
    expect(addBuilding({ ...base, code: 'Z 1' }).disabled(s)).toMatch(/영문자와 숫자/);
    expect(addBuilding({ ...base, name: '  ' }).disabled(s)).toMatch(/이름/);
    expect(addBuilding({ ...base, levels: [] }).disabled(s)).toMatch(/층을 하나 이상/);
    expect(addBuilding({ ...base, levels: [0, 1] }).disabled(s)).toMatch(/0이 아닌 정수/);
    expect(addBuilding({ ...base, levels: [1, 1] }).disabled(s)).toMatch(/두 번/);
    expect(addBuilding({ ...base, ground_levels: [9] }).disabled(s)).toMatch(/ground_levels/);
    expect(addBuilding({ ...base, polygon: [[[0, 0], [1, 0], [1, 1]]] }).disabled(s)).toMatch(/닫힌 고리/);
    expect(addBuilding(base).apply(s)).not.toBe(s);
    expect(addBuilding({ ...base, code: 'A' }).apply(s)).toBe(s);
  });

  it('does not touch a frozen input, and undo / redo restore it', async () => {
    const s = await fixtureState();
    expectInputUntouched(s, addBuilding(base));
    expectUndoRedo(s, addBuilding(base));
  });

  it('the new building takes nodes on its levels and is saved as buildings/Z/building.geojson', async () => {
    const s = await fixtureState();
    const withBuilding = addBuilding(base).apply(s);
    const node = addNode({ coord: [127.0025, 37.0015], props: { kind: 'node', node_type: 'corridor', building_id: 'bldg_Z', level: 2, source: 'x' } }, ctx(1));
    expect(node.disabled(withBuilding)).toBe(false);
    expect(addNode({ coord: [127.0025, 37.0015], props: { kind: 'node', node_type: 'corridor', building_id: 'bldg_Z', level: 9, source: 'x' } }, ctx(1)).disabled(withBuilding)).toMatch(/levels/);
    const files = serialize(node.apply(withBuilding));
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(['buildings/Z/building.geojson', 'buildings/Z/L2.geojson']));
  });
});
