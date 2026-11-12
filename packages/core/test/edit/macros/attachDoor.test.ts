import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addNode,
  attachDoor,
  attachDoorAction,
  checkInvariants,
  createHistory,
  createIdGen,
  edgeCoords,
  lineLength,
  observationMessage,
  previewAttachDoor,
  type EditState,
} from '../../../src/index.ts';
import { ctx, expectInputUntouched, newIds } from '../helpers.ts';
import { B, toXY, world, xy } from './world.ts';

const L1 = { building_id: B, level: 1 };

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify((r as { reason?: string }).reason)}`);
  return r as Extract<T, { ok: true }>;
}

const near = (p: [number, number], q: [number, number], digits = 3) => {
  expect(p[0]).toBeCloseTo(q[0], digits);
  expect(p[1]).toBeCloseTo(q[1], digits);
};

describe('attachDoor', () => {
  it('straight corridor: new door, split at the foot, door → foot corridor link', () => {
    const s = world();
    const r = ok(attachDoor(s, xy(10, 3), { ...L1, room_ref: '101', door_role: 'front' }, ctx(3)));
    expect(r.createdDoor).toBe(true);
    expect(r.reusedNode).toBe(false);
    expect(r.corridorEdgeId).toBe('e_s');
    const door = r.state.nodes[r.doorId]!;
    expect(door.props).toEqual({ kind: 'node', node_type: 'door', building_id: B, level: 1, room_ref: '101', door_role: 'front', source: 'estimate', rev: 1 });
    near(toXY(door.coord), [10, 3]);
    const foot = r.state.nodes[r.footId]!;
    expect(foot.props.node_type).toBe('corridor');
    near(toXY(foot.coord), [10, 0]);
    expect(r.state.edges[r.linkEdgeId]!.props).toEqual({
      kind: 'edge', highway: 'corridor', edge_type: 'indoor', from: r.doorId, to: r.footId, bidirectional: true, step_free: null, source: 'estimate', rev: 1,
    });
    // the longer piece (10 → 40) keeps e_s
    expect(r.state.edges['e_s']!.props).toMatchObject({ from: r.footId, to: 'n_s2' });
    expect(r.splitEdgeIds).toHaveLength(1);
    expect(r.state.edges[r.splitEdgeIds[0]!]!.props).toMatchObject({ from: 'n_s1', to: r.footId });
    const total = [...r.splitEdgeIds, 'e_s'].reduce((sum, id) => sum + lineLength(edgeCoords(r.state, r.state.edges[id]!)), 0);
    expect(total).toBeCloseTo(40, 6);
    expect(newIds(s, r.state)).toHaveLength(4);
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('bent corridor: the foot lands on the second segment and the bend stays on the right piece', () => {
    const s = world();
    const r = ok(attachDoor(s, xy(23, 40), L1, ctx(4)));
    expect(r.corridorEdgeId).toBe('e_b');
    near(toXY(r.state.nodes[r.footId]!.coord), [20, 40]);
    // from side (0,30) → (20,30) → (20,40) is 30 m, the other 10 m: e_b keeps the from side and the bend
    const kept = r.state.edges['e_b']!;
    expect(kept.props).toMatchObject({ from: 'n_b1', to: r.footId });
    expect(kept.vertices).toEqual([xy(20, 30)]);
    expect(r.state.edges[r.splitEdgeIds[0]!]!).toMatchObject({ vertices: [], props: { from: r.footId, to: 'n_b2' } });
    expect(checkInvariants(r.state)).toEqual([]);
  });

  it('door past the corridor end: the end node is reused, nothing is split', () => {
    const s = world();
    const r = ok(attachDoor(s, xy(43, 1), L1, ctx()));
    expect(r.reusedNode).toBe(true);
    expect(r.footId).toBe('n_s2');
    expect(r.splitEdgeIds).toEqual([]);
    expect(r.state.edges['e_s']).toBe(s.edges['e_s']);
    expect(newIds(s, r.state)).toEqual([r.doorId, r.linkEdgeId].sort());
  });

  it('no corridor within 8 m: state unchanged, ok false with a reason', () => {
    const s = world();
    const r = attachDoor(s, xy(49, 0), L1, ctx());
    expect(r.ok).toBe(false);
    expect(r.state).toBe(s);
    if (!r.ok) expect(r.reason).toBe('8m 안에 같은 층 복도 구간이 없습니다.');
    const action = attachDoorAction(xy(49, 0), L1, ctx());
    expect(action.disabled(s)).toMatch(/8m 안/);
    expect(action.apply(s)).toBe(s);
    expect(ok(attachDoor(s, xy(49, 0), { ...L1, maxDist: 12 }, ctx())).footId).toBe('n_s2');
  });

  it('foot 0.5 m from an existing node: that node is reused', () => {
    const s = world();
    // n_c2 at (80,0) joins e_c1 and e_c2; the foot of (79.5,-3) on e_c1 is (79.5,0)
    const r = ok(attachDoor(s, xy(79.5, -3), L1, ctx()));
    expect(r.footId).toBe('n_c2');
    expect(r.reusedNode).toBe(true);
    expect(Object.keys(r.state.nodes)).toHaveLength(Object.keys(s.nodes).length + 1);
  });

  it('a nearer corridor on another level is ignored', () => {
    const s = world();
    // e_u (level 2) is 0.5 m from the door, e_s (level 1) is 3 m
    const r = ok(attachDoor(s, xy(10, 3), L1, ctx()));
    expect(r.corridorEdgeId).toBe('e_s');
    expect(r.state.edges['e_u']).toBe(s.edges['e_u']);
    expect(ok(attachDoor(s, xy(10, 3), { building_id: B, level: 2 }, ctx())).corridorEdgeId).toBe('e_u');
  });

  it('never splits steps: a corridor farther away is used and the steps edge is untouched', () => {
    const s = world();
    // e_t (steps) is 1 m away, e_k (corridor) 4 m
    const r = ok(attachDoor(s, xy(75, 41), L1, ctx()));
    expect(r.corridorEdgeId).toBe('e_k');
    expect(r.state.edges['e_t']).toBe(s.edges['e_t']);
  });

  it('existing door id: links it; a second attach to the same foot is refused', () => {
    const base = world();
    const s = addNode({ id: 'n_door', coord: xy(20, 2), props: { kind: 'node', node_type: 'door', building_id: B, level: 1, room_ref: '102', source: 'x' } }).apply(base);
    const r = ok(attachDoor(s, 'n_door', {}, ctx()));
    expect(r.createdDoor).toBe(false);
    expect(r.doorId).toBe('n_door');
    expect(r.state.nodes['n_door']).toBe(s.nodes['n_door']);
    expect(r.state.edges[r.linkEdgeId]!.props.from).toBe('n_door');
    const again = attachDoor(r.state, 'n_door', {}, ctx());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/이미/);
  });

  it('a stub to another door is not a corridor to attach to', () => {
    const s = world();
    const first = ok(attachDoor(s, xy(10, 6), L1, ctx(1)));
    // right next to the first door's link (x=10, y 0..6), 0.5 m away; e_s is 4 m away
    const second = ok(attachDoor(first.state, xy(10.5, 4), L1, ctx(2)));
    expect(second.corridorEdgeId).not.toBe(first.linkEdgeId);
    expect(second.state.edges[first.linkEdgeId]).toBe(first.state.edges[first.linkEdgeId]);
  });

  it('disabled reasons', () => {
    const s = world();
    expect(attachDoorAction(xy(10, 3), {}, ctx()).disabled(s)).toMatch(/building_id/);
    expect(attachDoorAction(xy(10, 3), { building_id: B, level: 7 }, ctx()).disabled(s)).toMatch(/7층/);
    expect(attachDoorAction('n_nope', {}, ctx()).disabled(s)).toMatch(/없습니다/);
  });

  it('Turf units are metres: 3 m from a node is a split (not reused as 0.003), 10 m is out of reach (not 0.01 within 8)', () => {
    const s = world();
    const split = ok(attachDoor(s, xy(77, -3), L1, ctx()));
    expect(split.reusedNode).toBe(false);
    near(toXY(split.state.nodes[split.footId]!.coord), [77, 0]);
    expect(attachDoor(s, xy(70, 20), L1, ctx()).ok).toBe(false);
    const preview = previewAttachDoor(s, xy(77, -3), L1);
    expect(preview.ok && preview.distanceM).toBeCloseTo(3, 3);
  });

  it('every Turf call in the macro sources passes { units: "meters" }', () => {
    const dir = fileURLToPath(new URL('../../../src/edit/macros/', import.meta.url));
    const calls: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(dir + f, 'utf8');
      for (const m of src.matchAll(/\b(along|nearestPointOnLine|length|distance|lineSliceAlong)\(/g)) {
        // the call up to its closing parenthesis
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === '(') depth++;
          else if (src[end] === ')' && --depth === 0) break;
        }
        calls.push(`${f}: ${src.slice(m.index, end + 1)}`);
      }
    }
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toContain("units: 'meters'");
  });

  it('one macro = one history entry; undo gives the start back with I1–I5 intact', () => {
    const s = world();
    const h = createHistory(s);
    const after = h.perform(attachDoorAction(xy(10, 3), L1, ctx()));
    expect(h.size()).toBe(1);
    expect(Object.keys(after.nodes).length).toBe(Object.keys(s.nodes).length + 2);
    expect(h.undo()).toEqual(s);
    expect(checkInvariants(h.current())).toEqual([]);
    expect(h.canUndo()).toBe(false);
    expect(h.redo()).toEqual(after);
  });

  it('warnings: splitting a measured corridor warns, also through the macro result', () => {
    const s = world();
    const c = ctx(1, { observationTargets: new Set(['edge:e_s']) });
    const r = ok(attachDoor(s, xy(10, 3), L1, c));
    expect(r.warnings).toEqual([observationMessage('e_s')]);
    expect(attachDoorAction(xy(10, 3), L1, c).warnings!(s)).toEqual([observationMessage('e_s')]);
    // reused node: no split, no warning
    expect(ok(attachDoor(s, xy(43, 1), L1, c)).warnings).toEqual([]);
  });

  it('does not touch a frozen input', () => {
    const s = world();
    expectInputUntouched(s, attachDoorAction(xy(10, 3), L1, ctx()));
    expectInputUntouched(s, attachDoorAction(xy(23, 40), L1, ctx()));
  });

  it('same seed, same ids; the same action applied twice gives the same state', () => {
    const s = world();
    const run = () => newIds(s, ok(attachDoor(s, xy(10, 3), L1, { ids: createIdGen(77) })).state);
    expect(run()).toEqual(run());
    const ids = run();
    expect(ids.filter((id) => id.startsWith('n_T_1_door_'))).toHaveLength(1);
    expect(ids.filter((id) => id.startsWith('n_T_1_corridor_'))).toHaveLength(1);
    expect(ids.filter((id) => /^e_T_1_[0-9a-z]{6}$/.test(id))).toHaveLength(2);
    const action = attachDoorAction(xy(10, 3), L1, ctx(9));
    expect(action.apply(s)).toEqual(action.apply(s));
  });
});

describe('previewAttachDoor', () => {
  it('returns the foot and the edge without changing the state', () => {
    const s = world();
    const before: EditState = JSON.parse(JSON.stringify(s));
    const p = previewAttachDoor(s, xy(10, 3), L1);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.edgeId).toBe('e_s');
    near(toXY(p.foot), [10, 0]);
    expect(p.nodeId).toBeUndefined();
    expect(s).toEqual(before);
    // the preview foot is where attachDoor puts the corridor node
    const r = ok(attachDoor(s, xy(10, 3), L1, ctx()));
    expect(r.state.nodes[r.footId]!.coord).toEqual(p.foot);
  });

  it('reports a reused node, and the reason when there is no corridor', () => {
    const s = world();
    const p = previewAttachDoor(s, xy(79.5, -3), L1);
    expect(p.ok && p.nodeId).toBe('n_c2');
    expect(p.ok && p.foot).toEqual(s.nodes['n_c2']!.coord);
    const none = previewAttachDoor(s, xy(49, 0), L1);
    expect(none).toEqual({ ok: false, reason: '8m 안에 같은 층 복도 구간이 없습니다.' });
  });
});
