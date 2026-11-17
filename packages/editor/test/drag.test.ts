import { describe, expect, it } from 'vitest';
import { edgeCoords, edgesAt, type Position } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { NodeDrag } from '../src/model/drag.ts';
import { dragGeoJSON, dragMembers } from '../src/map/layers.ts';
import { footOnSegment, nearestWithin } from '../src/model/snap.ts';
import { parseLevels } from '../src/model/building.ts';
import { planCopyToFloors } from '../src/model/copy.ts';
import { isError, runPlan } from '../src/model/plan.ts';

const FAR: Position = [127.0004, 37.0012];

describe('지점 끌기 (NodeDrag, iD drag_node)', () => {
  it('the edges follow the node; one drag is one undo (and one redo)', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const drag = new NodeDrag(s.history, s.ctx, 'n_out_0002');
    drag.start();
    for (let i = 1; i <= 5; i++) drag.move([127.0002 + i * 0.00001, 37.0004]); // five frames
    const mid = s.history.current();
    expect(mid.nodes['n_out_0002']!.coord).toEqual([127.0002 + 5 * 0.00001, 37.0004]);
    for (const e of edgesAt(mid, 'n_out_0002')) {
      const line = edgeCoords(mid, e);
      expect(e.props.from === 'n_out_0002' ? line[0] : line[line.length - 1]).toEqual(mid.nodes['n_out_0002']!.coord);
    }
    expect(drag.finish([127.0003, 37.0004], null)).toEqual({ ok: true, kind: 'move', warnings: [] });
    expect(s.history.size()).toBe(1);
    const moved = s.history.current();
    expect(moved.nodes['n_out_0002']!.props.rev).toBe(before.nodes['n_out_0002']!.props.rev + 1); // +1 once, not per frame
    expect(moved.edges['e_out_0001__out_0002']!.props.rev).toBe(before.edges['e_out_0001__out_0002']!.props.rev + 1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
    s.history.redo();
    expect(s.history.current()).toEqual(moved);
  });

  it('a point with a sync_group drags its counterparts on the other floors with it; one drag is one undo', () => {
    const s = fixtureSession(3);
    const copy = planCopyToFloors(s.history.current(), s.ctx, ['n_A_3_bridge'], [4]);
    if (isError(copy)) throw new Error(copy.error);
    expect(runPlan(s.history, copy)).toMatchObject({ ok: true });
    const synced = s.history.current();
    const mate = Object.values(synced.nodes).find((n) => n.props.sync_group === synced.nodes['n_A_3_bridge']!.props.sync_group && n.id !== 'n_A_3_bridge')!;
    expect(mate.props.level).toBe(4);
    const size = s.history.size();
    const drag = new NodeDrag(s.history, s.ctx, 'n_A_3_bridge');
    drag.start();
    const to: Position = [synced.nodes['n_A_3_bridge']!.coord[0] + 0.00002, synced.nodes['n_A_3_bridge']!.coord[1]];
    drag.move(to);
    expect(s.history.current().nodes[mate.id]!.coord).toEqual(to); // the preview moves it too
    expect(drag.finish(to, null)).toEqual({ ok: true, kind: 'move', warnings: [] });
    expect(s.history.size()).toBe(size + 1);
    expect(s.history.current().nodes[mate.id]!.coord).toEqual(to);
    s.history.undo();
    expect(s.history.current()).toEqual(synced);
  });

  it('shows the node and its edges in the temporary source', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const members = dragMembers(st, 'n_out_0002');
    expect(members.nodes.map((n) => n.id)).toEqual(['n_out_0002']);
    expect(members.edgeIds).toEqual(['e_out_0001__out_0002', 'e_out_0002__out_0003', 'e_out_0002__out_0003_esc', 'e_out_0002__out_0004', 'e_portal_A_1_main']);
    const fc = dragGeoJSON(st, 'n_out_0002', [127, 37]);
    expect(fc.features.filter((f) => f.properties!['role'] === 'edge')).toHaveLength(5);
    expect(fc.features.filter((f) => f.properties!['role'] === 'target')).toHaveLength(1);
  });

  it('an elevator stop drags its whole shaft', () => {
    const s = fixtureSession();
    const drag = new NodeDrag(s.history, s.ctx, 'n_A_elevA_L1');
    drag.start();
    drag.move([127.00085, 37.0005]);
    const stops = Object.values(s.history.current().nodes).filter((n) => n.props.elevator_id === 'A_elevA');
    expect(stops.length).toBeGreaterThan(1);
    expect(stops.every((n) => n.coord[0] === 127.00085)).toBe(true);
    drag.cancel();
  });

  it('dropped on a node of the same scope it merges (the node dropped on stays)', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const drag = new NodeDrag(s.history, s.ctx, 'n_out_0007');
    drag.start();
    drag.move([127.0001, 37.00111]);
    const r = drag.finish([127.0001, 37.00111], { kind: 'node', id: 'n_out_0005' });
    expect(r).toMatchObject({ ok: true, kind: 'merge' });
    const st = s.history.current();
    expect('n_out_0007' in st.nodes).toBe(false);
    expect(st.nodes['n_out_0005']!.coord).toEqual(before.nodes['n_out_0005']!.coord);
    expect(s.history.size()).toBe(1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('dropped on an edge of the same scope it splits it and takes the place between', () => {
    const s = fixtureSession();
    s.ctx.observationTargets = new Set(['edge:e_out_0001__out_0006']);
    const before = s.history.current();
    const drag = new NodeDrag(s.history, s.ctx, 'n_out_0007');
    drag.start();
    drag.move([127.0005, 37.0001]);
    const r = drag.finish([127.0005, 37.00012], { kind: 'edge', id: 'e_out_0001__out_0006' });
    expect(r).toMatchObject({ ok: true, kind: 'split' });
    expect(r.ok && r.warnings[0]).toContain('측정');
    const touching = edgesAt(s.history.current(), 'n_out_0007').filter((e) => e.props.edge_type !== 'portal');
    expect(touching).toHaveLength(2);
    expect(touching.map((e) => (e.props.from === 'n_out_0007' ? e.props.to : e.props.from)).sort()).toEqual(['n_out_0001', 'n_out_0006']);
    expect(s.history.size()).toBe(1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('a drop core refuses puts the node back where it was, with the reason', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const drag = new NodeDrag(s.history, s.ctx, 'n_out_0007');
    drag.start();
    drag.move(FAR);
    const r = drag.finish(FAR, { kind: 'edge', id: 'e_out_0002__out_0003_esc' }); // an escalator cannot be split
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toContain('나눌 수 없습니다');
    expect(s.history.current()).toEqual(before);
    expect(s.history.canUndo()).toBe(false);
  });

  it('refuses a merge across scopes and puts the node back', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const drag = new NodeDrag(s.history, s.ctx, 'n_out_0007');
    drag.start();
    const r = drag.finish([127.0006, 37.0005], { kind: 'node', id: 'n_A_1_hall' });
    expect(r.ok).toBe(false);
    expect(s.history.current()).toEqual(before);
  });
});

describe('화면 도우미', () => {
  it('footOnSegment is the closest point on the segment, clamped at the ends', () => {
    expect(footOnSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ point: { x: 5, y: 0 }, dist: 3 });
    expect(footOnSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ point: { x: 0, y: 0 }, dist: 5 });
  });

  it('nearestWithin picks the nearest candidate within the distance', () => {
    const c = (id: string, x: number, y: number) => ({ id, screen: { x, y } });
    expect(nearestWithin([c('a', 104, 100), c('b', 102, 101)], { x: 100, y: 100 })?.id).toBe('b');
    expect(nearestWithin([c('a', 104, 104)], { x: 100, y: 100 })).toBeUndefined(); // 5.7px
  });

  it('parseLevels reads ranges and lists, skipping 0, and refuses junk in Korean', () => {
    expect(parseLevels('-1~2')).toEqual({ levels: [-1, 1, 2] });
    expect(parseLevels('0')).toMatchObject({ error: expect.stringContaining('0층') });
  });
});
