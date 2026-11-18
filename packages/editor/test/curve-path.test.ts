// 곡선 길 as a plan (planCurvePath): nodes at the control points only, each edge bent by its segment's samples (`vertices`).
import { describe, expect, it } from 'vitest';
import { buildGraph, edgeCoords, validateCampus, type EditState, type Position } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { planDrawnPath } from '../src/model/connect.ts';
import { curveSegments } from '../src/model/curve.ts';
import { isError, runPlan, type Plan, type PlanResult } from '../src/model/plan.ts';
import { stateToCampus } from '../src/model/session.ts';
import { OUTDOOR, type Scope } from '../src/model/scope.ts';
import { planCurvePath, planOutdoorPath, type PathVertex } from '../src/model/tools.ts';

const ok = (r: PlanResult | null): Plan => {
  if (!r || isError(r)) throw new Error(r ? r.error : 'no plan');
  return r;
};
const errorOf = (r: PlanResult | null): string => {
  if (!r || !isError(r)) throw new Error('expected an error');
  return r.error;
};
const P: Position[] = [[127.01, 37.01], [127.0103, 37.0104], [127.0107, 37.0103], [127.011, 37.0107]];
const at = (list: Position[]): PathVertex[] => list.map((position) => ({ position }));
const added = (before: EditState, after: EditState) => ({
  nodes: Object.values(after.nodes).filter((n) => !(n.id in before.nodes)),
  edges: Object.values(after.edges).filter((e) => !(e.id in before.edges)),
});

describe('곡선 길 (planCurvePath)', () => {
  it('makes a node per control point and an edge per pair; every edge carries its bend points', () => {
    const s = fixtureSession();
    const before = s.history.current();
    expect(runPlan(s.history, ok(planCurvePath(before, s.ctx, at(P), 'flat', OUTDOOR)))).toEqual({ ok: true, warnings: [] });
    const after = s.history.current();
    const made = added(before, after);
    expect(made.nodes).toHaveLength(P.length);
    expect(made.edges).toHaveLength(P.length - 1);
    const segs = curveSegments(P);
    for (const [i, e] of made.edges.entries()) {
      expect(e.vertices.length).toBeGreaterThan(0);
      expect(e.vertices).toEqual(segs[i]);
      expect(e.props).toMatchObject({ highway: 'footway', edge_type: 'outdoor', source: 'estimate', rev: 1 });
    }
    // The drawn line of an edge is [from, ...vertices, to] (core edgeCoords).
    const line = edgeCoords(after, made.edges[0]!);
    expect(line[0]).toEqual(P[0]);
    expect(line[line.length - 1]).toEqual(P[1]);
  });

  it('one history entry: one Undo takes the whole curve back, Redo brings it again', () => {
    const s = fixtureSession();
    const before = s.history.current();
    runPlan(s.history, ok(planCurvePath(before, s.ctx, at(P), 'flat', OUTDOOR)));
    expect(s.history.size()).toBe(1);
    const drawn = s.history.current();
    s.history.undo();
    expect(s.history.current()).toEqual(before);
    expect(s.history.canUndo()).toBe(false);
    s.history.redo();
    expect(s.history.current()).toEqual(drawn);
  });

  it('uses a snapped nodeId at the ends, and closes a loop on the first new node', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const from = st.nodes['n_out_0003']!.coord;
    const plan = ok(planCurvePath(st, s.ctx, [{ nodeId: 'n_out_0003' }, { position: [from[0] + 0.0003, from[1] + 0.0004] }, { position: [from[0] + 0.0006, from[1] + 0.0001] }, { nodeId: 'n_out_0001' }], 'flat', OUTDOOR));
    runPlan(s.history, plan);
    const made = added(st, s.history.current());
    expect(made.nodes).toHaveLength(2);
    expect(made.edges).toHaveLength(3);
    expect(made.edges[0]!.props.from).toBe('n_out_0003');
    expect(made.edges[2]!.props.to).toBe('n_out_0001');
    expect(made.edges[0]!.vertices.length).toBeGreaterThan(0);

    const s2 = fixtureSession(2);
    const loop = ok(planCurvePath(s2.history.current(), s2.ctx, at([[127.1, 37.1], [127.1003, 37.1], [127.1003, 37.1003], [127.1, 37.1]]), 'flat', OUTDOOR));
    runPlan(s2.history, loop);
    const m2 = added(st, s2.history.current());
    expect(m2.nodes).toHaveLength(3);
    expect(m2.edges).toHaveLength(3);
  });

  it('is the straight path when there are only two points (no bend), and nothing for one click', () => {
    const s = fixtureSession();
    const st = s.history.current();
    runPlan(s.history, ok(planCurvePath(st, s.ctx, at([P[0]!, P[1]!]), 'flat', OUTDOOR)));
    expect(added(st, s.history.current()).edges[0]!.vertices).toEqual([]);
    expect(planCurvePath(st, s.ctx, at([P[0]!]), 'flat', OUTDOOR)).toBeNull();
  });

  it('reaching an entrance makes that edge a portal; two entrances in a row are refused', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const door = st.nodes['n_A_1_main']!.coord;
    const plan = ok(planCurvePath(st, s.ctx, [{ position: [door[0] - 0.0004, door[1] - 0.0003] }, { position: [door[0] - 0.0002, door[1] - 0.0004] }, { nodeId: 'n_A_1_main' }], 'flat', OUTDOOR));
    runPlan(s.history, plan);
    const made = added(st, s.history.current()).edges;
    expect(made.map((e) => e.props.edge_type)).toEqual(['outdoor', 'portal']);
    expect(made[1]!.props.highway).toBe('footway');
    expect(made[1]!.vertices.length).toBeGreaterThan(0);
    expect(errorOf(planCurvePath(st, s.ctx, [{ nodeId: 'n_A_1_main' }, { nodeId: 'n_B_1_main' }], 'flat', OUTDOOR))).toMatch(/출입구/);
  });

  it('steps and ramps outdoors keep their kind; indoors a curved corridor or ramp is fine but steps are an error', () => {
    const s = fixtureSession();
    const st = s.history.current();
    runPlan(s.history, ok(planCurvePath(st, s.ctx, at(P), 'steps', OUTDOOR)));
    expect(added(st, s.history.current()).edges.every((e) => e.props.highway === 'steps' && e.props.step_free === false)).toBe(true);

    const floor: Scope = { kind: 'building', buildingId: 'bldg_A', level: 1 };
    const room: Position[] = [[127.00062, 37.00046], [127.00064, 37.00049], [127.00068, 37.00048]];
    expect(errorOf(planCurvePath(st, s.ctx, at(room), 'steps', floor))).toMatch(/계단/);
    const s2 = fixtureSession(3);
    const st2 = s2.history.current();
    runPlan(s2.history, ok(planCurvePath(st2, s2.ctx, at(room), 'flat', floor)));
    const made = added(st2, s2.history.current());
    expect(made.edges.every((e) => e.props.highway === 'corridor' && e.props.edge_type === 'indoor' && e.vertices.length > 0)).toBe(true);
    expect(made.nodes.every((n) => n.props.node_type === 'corridor' && n.props.building_id === 'bldg_A' && n.props.level === 1)).toBe(true);
  });

  it('refuses a node of another scope, like the straight path', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const floor: Scope = { kind: 'building', buildingId: 'bldg_A', level: 1 };
    expect(errorOf(planCurvePath(st, s.ctx, [{ nodeId: 'n_out_0001' }, { position: [127.0006, 37.0005] }], 'flat', floor))).toMatch(/붙일 수 없/);
  });

  it('refuses two different points on the same spot (the bend points could not be told apart)', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const [a, b] = [st.nodes['n_out_0001']!.coord, st.nodes['n_out_0002']!.coord];
    void b;
    // An existing node and a new position at exactly its place are two controls on one spot.
    expect(errorOf(planCurvePath(st, s.ctx, [{ nodeId: 'n_out_0001' }, { position: [a[0], a[1]] }, { position: [127.0005, 37.0005] }], 'flat', OUTDOOR))).toMatch(/겹친/);
  });

  it('keeps the straight path as it was: no bend points', () => {
    const s = fixtureSession();
    const st = s.history.current();
    runPlan(s.history, ok(planOutdoorPath(st, s.ctx, at(P), 'flat')));
    expect(added(st, s.history.current()).edges.every((e) => e.vertices.length === 0)).toBe(true);
  });

  it('planDrawnPath takes the shape: a curve gives bend points, straight does not', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const curved = ok(planDrawnPath(st, s.ctx, at(P), 'flat', OUTDOOR, 'curve'));
    runPlan(s.history, curved);
    expect(added(st, s.history.current()).edges.every((e) => e.vertices.length > 0)).toBe(true);
    const s2 = fixtureSession(2);
    runPlan(s2.history, ok(planDrawnPath(st, s2.ctx, at(P), 'flat', OUTDOOR)));
    expect(added(st, s2.history.current()).edges.every((e) => e.vertices.length === 0)).toBe(true);
  });
});

describe('곡선 길: 스키마와 길이', () => {
  it('the saved document validates, with only allowed highway / edge_type pairs and [lng, lat] bend points', () => {
    const s = fixtureSession();
    const st = s.history.current();
    runPlan(s.history, ok(planCurvePath(st, s.ctx, at(P), 'ramp', OUTDOOR)));
    const after = s.history.current();
    const campus = stateToCampus(after, s.meta, s.passthrough, s.extras);
    expect(validateCampus(campus).errors).toEqual([]);
    for (const e of added(st, after).edges) {
      expect(`${e.props.highway}/${e.props.edge_type}`).toBe('ramp/outdoor');
      expect(e.vertices.every((v) => v.length === 2 && v.every(Number.isFinite))).toBe(true);
    }
  });

  it('the line of an edge with bend points (edgeCoords) is longer than the straight distance between its ends, and only a little', () => {
    const s = fixtureSession();
    const st = s.history.current();
    runPlan(s.history, ok(planCurvePath(st, s.ctx, at(P), 'flat', OUTDOOR)));
    const after = s.history.current();
    const meters = (a: Position, b: Position) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos((37.01 * Math.PI) / 180), (b[1] - a[1]) * 110574);
    for (const e of added(st, after).edges) {
      const line = edgeCoords(after, e);
      const along = line.slice(1).reduce((sum, p, i) => sum + meters(line[i]!, p), 0);
      const chord = meters(after.nodes[e.props.from]!.coord, after.nodes[e.props.to]!.coord);
      expect(along).toBeGreaterThan(chord);
      expect(along).toBeLessThan(chord * 1.3);
    }
    // The graph still builds from the bent edges (it reads node positions: elevation needs no recompute for the bends).
    const graph = buildGraph(stateToCampus(after, s.meta, s.passthrough, s.extras));
    const ids = new Set(added(st, after).edges.map((e) => e.id));
    let walks = 0;
    graph.graph.forEachLink((l) => {
      if (l.data.kind === 'walk' && ids.has(l.data.edge.id)) walks++;
    });
    expect(walks).toBeGreaterThanOrEqual(P.length - 1);
  });
});
