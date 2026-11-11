import { describe, expect, it } from 'vitest';
import { addRoom, annotationOf, checkInvariants, deleteBuilding, previewDeleteBuilding, type EditState } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

const square = [[[127.00045, 37.00055], [127.00055, 37.00055], [127.00055, 37.00068], [127.00045, 37.00068], [127.00045, 37.00055]]] as [number, number][][];

async function withRoom(): Promise<EditState> {
  const s = await fixtureState();
  return addRoom({ id: 'r_A_4_408', polygon: square, props: { kind: 'room', building_id: 'bldg_A', level: 4, room_ref: '408', source: 'estimate' } }, ctx()).apply(s);
}

describe('deleteBuilding', () => {
  it('deletes the building, its nodes, every edge on them (portals, bridges) and its rooms', async () => {
    const s = await withRoom();
    const next = deleteBuilding('A').apply(s);
    expect(next.buildings['A']).toBeUndefined();
    expect(Object.values(next.nodes).filter((n) => n.props.building_id === 'bldg_A')).toEqual([]);
    for (const id of ['e_portal_A_1_main', 'e_portal_A_4_north', 'e_A_3_bridge__B_2_bridge', 'e_A_3_north__C_5_bridge', 'e_A_1_hall__A_1_esc']) {
      expect(next.edges[id]).toBeUndefined();
    }
    expect(next.rooms['r_A_4_408']).toBeUndefined();
    // the far ends stay
    expect(next.nodes['n_out_0002']).toBeDefined();
    expect(next.nodes['n_B_2_bridge']).toBeDefined();
    expect(next.buildings['B']).toBeDefined();
    expect(checkInvariants(next)).toEqual([]);
  });

  it('previews the counts and puts them in the annotation', async () => {
    const s = await withRoom();
    const nodes = Object.values(s.nodes).filter((n) => n.props.building_id === 'bldg_A').length;
    const p = previewDeleteBuilding(s, 'A');
    expect(p).toEqual({ nodes, edges: 30, rooms: 1 });
    expect(nodes).toBe(21);
    const removed = deleteBuilding('A').apply(s);
    expect(Object.keys(s.edges).length - Object.keys(removed.edges).length).toBe(p.edges);
    expect(Object.keys(s.nodes).length - Object.keys(removed.nodes).length).toBe(p.nodes);
    expect(annotationOf(deleteBuilding('A'), s)).toBe('건물 A 삭제(지점 21개, 구간 30개, 강의실 영역 1개)');
    expect(previewDeleteBuilding(s, 'Z')).toEqual({ nodes: 0, edges: 0, rooms: 0 });
  });

  it('is disabled for a missing building', async () => {
    expect(deleteBuilding('Z').disabled(await fixtureState())).toMatch(/없습니다/);
  });

  it('warns about overrides on anything it deletes', async () => {
    const s = await fixtureState();
    const w = deleteBuilding('C', ctx(1, { overrideIds: new Set(['e_portal_C_5_main', 'bldg_C', 'n_out_0007']) })).warnings!(s);
    expect(w).toEqual([
      '"bldg_C"에 override가 있습니다. overrides.json에서 이 항목을 지우세요.',
      '"e_portal_C_5_main"에 override가 있습니다. overrides.json에서 이 항목을 지우세요.',
    ]);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await withRoom(), deleteBuilding('A'));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await withRoom(), deleteBuilding('A'));
  });
});
