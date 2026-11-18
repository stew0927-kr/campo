// 끊긴 지점 찾기 on plazas (평지): a point on a plaza (or within 0.3 m of its boundary) is joined to everything else that
// meets the plaza, so it is not broken while the plaza touches the network. A plaza that touches nothing joins nothing.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addEdge, addNode, addPlaza, compose, localFrame, type Action, type Position } from '@campo/core';
import { brokenIds, findBroken } from '../src/model/broken.ts';
import { createSession } from '../src/model/session.ts';
import { readFolder } from './fixture.ts';

const PLAZA = fileURLToPath(new URL('../../core/test/fixtures/campus-plaza', import.meta.url));
const F = localFrame([127, 37]);
const P = (x: number, y: number): Position => F.toPos(x, y);
const rect = (x0: number, y0: number, x1: number, y1: number): Position[] => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)];

const outdoor = (id: string, at: Position) =>
  addNode({ id, coord: at, props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate' } });
const footway = (id: string, from: string, to: string) =>
  addEdge({ id, props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: true, source: 'estimate' } });
const plaza = (id: string, ring: Position[]) => addPlaza({ id, polygon: [ring], props: { kind: 'plaza', source: 'estimate' } });

/** The campus-plaza fixture (분수 광장 0–40 × 0–30 m with a hole, 잔디 광장 east of it) after `actions`. */
function after(...actions: Action[]) {
  const s = createSession('fixture-plaza', readFolder(PLAZA), 1);
  if (actions.length > 0) s.history.perform(compose(actions, '시험'));
  return s.history.current();
}

describe('findBroken with plazas', () => {
  it('the fixture itself has nothing broken', () => {
    expect(findBroken(after())).toEqual([]);
  });

  it('a point on 분수 광장 is joined through the plaza (it was "isolated, 0.0m 옆에 길")', () => {
    expect(findBroken(after(outdoor('n_on_plaza', P(10, 15))))).toEqual([]);
  });

  it('points 0.2–0.3 m outside the boundary are on the plaza too', () => {
    const items = findBroken(after(outdoor('n_edge_e', P(40.04 + 0.2, 5)), outdoor('n_edge_n', P(5, 29.97 + 0.28)), outdoor('n_hole_rim', P(20, 10.25))));
    expect(items.map((i) => i.nodeId)).toEqual([]);
  });

  it('a point 1 m outside the plaza and away from every way is still isolated', () => {
    const items = findBroken(after(outdoor('n_out_far', P(10, -1))));
    expect(items).toMatchObject([{ kind: 'isolated', nodeId: 'n_out_far', message: '어떤 구간에도 이어지지 않은 지점입니다.' }]);
  });

  it('a point on a plaza that touches no way and no other point is still isolated', () => {
    const items = findBroken(after(plaza('plaza_far', rect(200, 200, 220, 220)), outdoor('n_far', P(210, 210))));
    expect(items).toMatchObject([{ kind: 'isolated', nodeId: 'n_far' }]);
  });

  it('points joined only by a plaza that touches no way are one island, reported once', () => {
    const items = findBroken(after(plaza('plaza_far', rect(200, 200, 220, 220)), outdoor('n_far1', P(205, 205)), outdoor('n_far2', P(215, 215))));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'island', nodeId: 'n_far1', nodeIds: ['n_far1', 'n_far2'] });
    expect(items[0]!.message).toContain('지점 2개가 서로만 이어져 있고');
    expect(brokenIds(items)).toEqual(new Set(['n_far1', 'n_far2']));
  });

  it('an island on a far plaza with a way of its own is joined to its point on the plaza', () => {
    const items = findBroken(after(
      plaza('plaza_far', rect(200, 200, 220, 220)), outdoor('n_far1', P(205, 205)), outdoor('n_road1', P(230, 210)), outdoor('n_road2', P(215, 210)),
      footway('e_far_road', 'n_road1', 'n_road2'),
    ));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'island', nodeIds: ['n_far1', 'n_road1', 'n_road2'] });
  });

  it('near: a point on the plaza is not "near" a way the plaza reaches', () => {
    // 0.4 m beside e_out_w__e, which crosses 분수 광장: joined through the plaza.
    expect(findBroken(after(outdoor('n_on_plaza', P(10, 15.4))))).toEqual([]);
  });

  it('near: a way that does not meet the plaza is still "near" the point on it, and its own island is reported once', () => {
    // e_south runs 0.6 m south of the plaza (outside the 0.3 m tolerance): it meets neither the plaza nor anything else.
    const items = findBroken(after(
      outdoor('n_s1', P(5, -0.6)), outdoor('n_s2', P(35, -0.6)), footway('e_south', 'n_s1', 'n_s2'),
      outdoor('n_on_plaza', P(10, 0.5)),
    ));
    expect(items.find((i) => i.nodeId === 'n_on_plaza')).toMatchObject({ kind: 'near', near: { kind: 'edge', id: 'e_south' } });
    expect(items.filter((i) => i.kind === 'island')).toMatchObject([{ nodeIds: ['n_s1', 'n_s2'] }]);
  });
});

describe('findBroken speed on plazas', () => {
  it('a few hundred points on three linked plazas of 150 corners in all: well under 100 ms', () => {
    const circle = (cx: number, r: number, n: number): Position[] => {
      const ring = Array.from({ length: n }, (_, i) => P(cx + r * Math.cos((2 * Math.PI * i) / n), 400 + r * Math.sin((2 * Math.PI * i) / n)));
      return [...ring, ring[0]!];
    };
    const actions: Action[] = [plaza('pz1', circle(400, 30, 50)), plaza('pz2', circle(455, 30, 50)), plaza('pz3', circle(510, 30, 50))];
    for (let i = 0; i < 300; i++) actions.push(outdoor(`n_pz_${String(i).padStart(3, '0')}`, P(380 + (i % 30) * 5, 390 + Math.floor(i / 30) * 2)));
    const state = after(...actions);
    findBroken(state);
    const t0 = performance.now();
    const items = findBroken(state);
    const ms = performance.now() - t0;
    expect(items.filter((i) => i.kind === 'island')).toHaveLength(1);
    expect(ms).toBeLessThan(100);
  });
});
