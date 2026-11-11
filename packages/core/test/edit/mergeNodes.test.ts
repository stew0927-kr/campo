import { describe, expect, it } from 'vitest';
import { addNode, checkInvariants, mergeNodes, mergeSurvivor, type EditState } from '../../src/index.ts';
import { ctx, expectInputUntouched, expectUndoRedo, fixtureState } from './helpers.ts';

/** Fixture + an extra corridor node "n_extra" on A/4 named "복도 끝". */
async function withExtra(): Promise<EditState> {
  const s = await fixtureState();
  return addNode({ id: 'n_extra', coord: [127.00061, 37.00051], props: { kind: 'node', node_type: 'corridor', building_id: 'bldg_A', level: 4, name: '복도 끝', source: 'estimate' } }).apply(s);
}

describe('mergeNodes', () => {
  it('the last id survives; edges move onto it; edges between them are deleted; empty props are filled', async () => {
    const s = await withExtra();
    const next = mergeNodes(['n_extra', 'n_A_4_hall']).apply(s);
    expect(next.nodes['n_extra']).toBeUndefined();
    const hall = next.nodes['n_A_4_hall']!;
    expect(hall.props.name).toBe('복도 끝');
    expect(hall.props.rev).toBe(2);
    expect(checkInvariants(next)).toEqual([]);

    const merged = mergeNodes(['n_A_4_hall', 'n_A_4_stair']).apply(s);
    expect(merged.nodes['n_A_4_hall']).toBeUndefined();
    // the hall–stair edge would be a loop: gone
    expect(merged.edges['e_A_4_hall__A_4_stair']).toBeUndefined();
    expect(merged.edges['e_A_4_hall__A_4_408door']!.props).toMatchObject({ from: 'n_A_4_stair', to: 'n_A_4_408door', rev: 2 });
    expect(merged.edges['e_A_3_stair__A_4_stair']!.props.rev).toBe(1);
    expect(checkInvariants(merged)).toEqual([]);
  });

  it('an important node survives even when it is not last', async () => {
    const s = await withExtra();
    expect(mergeSurvivor(s, ['n_A_4_wc_m', 'n_extra'])).toBe('n_A_4_wc_m');
    const next = mergeNodes(['n_A_4_wc_m', 'n_extra']).apply(s);
    expect(next.nodes['n_extra']).toBeUndefined();
    expect(next.nodes['n_A_4_wc_m']!.props.name).toBe('A동 4층 남자 화장실');
  });

  it('refuses nodes on different levels (another scope) and two important nodes', async () => {
    const s = await fixtureState();
    expect(mergeNodes(['n_A_3_hall', 'n_A_4_hall']).disabled(s)).toMatch(/범위/);
    expect(mergeNodes(['n_out_0002', 'n_A_1_main']).disabled(s)).toMatch(/범위/);
    expect(mergeNodes(['n_A_4_wc_f', 'n_A_4_wc_m']).disabled(s)).toMatch(/둘 이상/);
    expect(mergeNodes(['n_A_4_hall']).disabled(s)).toMatch(/두 개 이상/);
    expect(mergeNodes(['n_A_4_hall', 'n_nope']).disabled(s)).toMatch(/n_nope/);
  });

  it('warns about an override on a merged-away node and names the survivor', async () => {
    const s = await withExtra();
    const w = mergeNodes(['n_extra', 'n_A_4_hall'], ctx(1, { overrideIds: new Set(['n_extra']) })).warnings!(s);
    expect(w).toEqual(['"n_extra"에 override가 있습니다(남는 지점 n_A_4_hall). overrides.json에서 이 항목을 지우세요.']);
  });

  it('does not touch a frozen input', async () => {
    expectInputUntouched(await withExtra(), mergeNodes(['n_A_4_hall', 'n_A_4_stair']));
  });

  it('perform → undo → redo', async () => {
    expectUndoRedo(await withExtra(), mergeNodes(['n_A_4_hall', 'n_A_4_stair', 'n_extra']));
  });
});
