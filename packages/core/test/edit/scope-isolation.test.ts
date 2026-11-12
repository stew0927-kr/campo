// Points of different floors never join, even at the same coordinate (SPEC-v0.2 4.1 mergeNodes, 5.2 snap, 6.1 attachDoor).
// The editor's "다른 층에 복사" relies on this: copies on different floors share coordinates but must stay apart.
import { describe, expect, it } from 'vitest';
import { addNode, attachDoor, attachDoorAction, checkInvariants, mergeNodes, previewAttachDoor, type EditState } from '../../src/index.ts';
import { ctx } from './helpers.ts';
import { B, world, xy } from './macros/world.ts';

/** world(): level 1 has the corridor e_s (0,0)-(40,0); level 2 has e_u (0,3.5)-(40,3.5). */
const without = (s: EditState, edgeIds: string[], nodeIds: string[]): EditState => ({
  ...s,
  edges: Object.fromEntries(Object.entries(s.edges).filter(([id]) => !edgeIds.includes(id))),
  nodes: Object.fromEntries(Object.entries(s.nodes).filter(([id]) => !nodeIds.includes(id))),
});

describe('scope isolation: floors stay apart', () => {
  it('mergeNodes refuses two points at the same coordinate on different floors', () => {
    const s = addNode({ id: 'n_twin', coord: xy(0, 0), props: { kind: 'node', node_type: 'corridor', building_id: B, level: 2, source: 'x' } }).apply(world());
    expect(s.nodes['n_twin']!.coord).toEqual(s.nodes['n_s1']!.coord);
    const reason = mergeNodes(['n_s1', 'n_twin']).disabled(s);
    expect(reason).toMatch(/범위/);
    expect(Object.keys(s.nodes)).toContain('n_twin');
    expect(checkInvariants(s)).toEqual([]);
  });

  it('attachDoor never joins a door to a corridor of another floor', () => {
    // Floor 2 has no corridor of its own here: only floor 1's e_s lies right under the door.
    const s0 = without(world(), ['e_u'], ['n_u1', 'n_u2']);
    const s = addNode({ id: 'n_door2', coord: xy(10, 0.5), props: { kind: 'node', node_type: 'door', building_id: B, level: 2, source: 'x' } }).apply(s0);
    expect(previewAttachDoor(s, xy(10, 0.5), { building_id: B, level: 2 })).toMatchObject({ ok: false });
    const byId = attachDoor(s, 'n_door2', {}, ctx(5));
    expect(byId.ok).toBe(false);
    if (!byId.ok) expect(byId.reason).toMatch(/복도 구간이 없습니다/);
    expect(attachDoorAction('n_door2', {}, ctx(5)).disabled(s)).toMatch(/복도 구간이 없습니다/);
    const byCoord = attachDoor(s, xy(10, 0.5), { building_id: B, level: 2 }, ctx(5));
    expect(byCoord.ok).toBe(false);
  });

  it('attachDoor joins the corridor of its own floor even when another floor is closer', () => {
    // e_s (floor 1) is 0.5 m from the door, e_u (floor 2) 3 m: the link must still go to floor 2.
    const s = addNode({ id: 'n_door2', coord: xy(10, 0.5), props: { kind: 'node', node_type: 'door', building_id: B, level: 2, source: 'x' } }).apply(world());
    const r = attachDoor(s, 'n_door2', {}, ctx(6));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corridorEdgeId).toBe('e_u');
    expect(r.state.nodes[r.footId]!.props.level).toBe(2);
    expect(r.state.edges['e_s']).toEqual(s.edges['e_s']); // floor 1 untouched
    for (const e of Object.values(r.state.edges)) {
      const levels = new Set([r.state.nodes[e.props.from]!.props.level, r.state.nodes[e.props.to]!.props.level]);
      if (e.props.highway !== 'steps') expect(levels.size).toBe(1);
    }
    expect(checkInvariants(r.state)).toEqual([]);
  });
});
