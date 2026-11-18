// 길 그리기 onto an existing edge: a point clicked on an edge of the same scope splits it there (core splitEdgeAt) and the
// new path joins the node the split makes, so the drawing is on the network at once (both ways), in one history entry.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addEdge, addNode, buildGraph, findRoute, localFrame, type EditState, type Position } from '@campo/core';
import { planDrawnPath } from '../src/model/connect.ts';
import { isError, runPlan, type Plan, type PlanResult } from '../src/model/plan.ts';
import { OUTDOOR } from '../src/model/scope.ts';
import { createSession, stateToCampus, type Session } from '../src/model/session.ts';
import { planCurvePath, planPath, type PathVertex } from '../src/model/tools.ts';
import { readFolder } from './fixture.ts';

const PLAZA = fileURLToPath(new URL('../../core/test/fixtures/campus-plaza', import.meta.url));
const F = localFrame([127, 37]);
const P = (x: number, y: number): Position => F.toPos(x, y);
const X = 200; // the test road lies 200 m east of the fixture's own data

const ok = (r: PlanResult | null): Plan => {
  if (!r || isError(r)) throw new Error(r ? r.error : 'no plan');
  return r;
};

/** The fixture plus a straight 40 m outdoor road A–B with derived elevation values on it. */
function setup(): { s: Session; state: EditState } {
  const s = createSession('fixture-plaza', readFolder(PLAZA), 7);
  const props = { kind: 'node' as const, node_type: 'outdoor' as const, building_id: null, level: null, source: 't' };
  for (const [id, x] of [['road_a', X], ['road_b', X + 40]] as const) s.history.perform(addNode({ id, coord: P(x, 0), props }, s.ctx));
  s.history.perform(addEdge({
    id: 'e_road',
    props: {
      kind: 'edge', highway: 'footway', edge_type: 'outdoor', from: 'road_a', to: 'road_b', bidirectional: true, step_free: true, source: 't',
      elev_diff_m: 1.2, elev_sigma_m: 0.1, grade_pct: 3, flat_exact: false,
    },
  }, s.ctx));
  return { s, state: s.history.current() };
}

const onRoad = (x: number, y = 0.2): PathVertex => ({ edgeId: 'e_road', position: P(X + x, y) });
const free = (x: number, y: number): PathVertex => ({ position: P(X + x, y) });
const added = (before: EditState, after: EditState) => ({
  nodes: Object.values(after.nodes).filter((n) => !(n.id in before.nodes)),
  edges: Object.values(after.edges).filter((e) => !(e.id in before.edges)),
});
const graphOf = (s: Session) => buildGraph(stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras), { overrides: [], calibration: {} });
const metres = (a: Position, b: Position) => Math.hypot(...localFrame(a).toXY(b));

describe('길 그리기 onto an existing edge (planPath / planCurvePath)', () => {
  it('splits the edge with splitEdgeAt and joins the new path to the split node; one entry, connected both ways', () => {
    const { s, state } = setup();
    const plan = ok(planPath(state, s.ctx, [free(20, 15), onRoad(20)], 'flat', OUTDOOR));
    // The plan carries the split action itself.
    const actions: string[] = [];
    let cur = state;
    for (const step of plan.steps) {
      const a = step(cur)!;
      actions.push(a.annotation);
      cur = a.apply(cur);
    }
    expect(actions).toContain('구간 나누기');
    expect(plan.annotation).toMatch(/기존 구간 1곳 나눠 잇기/);
    expect(runPlan(s.history, plan).ok).toBe(true);
    const after = s.history.current();
    const made = added(state, after);
    expect(made.nodes).toHaveLength(2); // the free point and the split node
    expect(made.edges).toHaveLength(2); // the split-off piece and the new path
    const split = made.nodes.find((n) => metres(n.coord, P(X + 20, 0)) < 0.01)!;
    expect(split).toBeDefined();
    const path = made.edges.find((e) => e.props.from !== split.id || e.props.to !== 'road_b');
    const joined = Object.values(after.edges).filter((e) => e.props.from === split.id || e.props.to === split.id);
    expect(joined).toHaveLength(3); // two pieces of the road and the new path
    expect(path).toBeDefined();
    // On the network: the free point reaches both ends of the road, and back.
    const g = graphOf(s);
    const start = made.nodes.find((n) => n.id !== split.id)!.id;
    for (const end of ['road_a', 'road_b']) {
      expect(findRoute(g, start, end, 'shortest').found).toBe(true);
      expect(findRoute(g, end, start, 'shortest').found).toBe(true);
    }
    // One Ctrl+Z takes the split and the path back together.
    s.history.undo();
    expect(s.history.current()).toEqual(state);
  });

  it('the split pieces keep the edge\'s properties and drop its derived elevation (splitEdgeAt rules)', () => {
    const { s, state } = setup();
    runPlan(s.history, ok(planPath(state, s.ctx, [free(20, 15), onRoad(25)], 'flat', OUTDOOR)));
    const pieces = Object.values(s.history.current().edges).filter((e) => e.id === 'e_road' || (!(e.id in state.edges) && e.props.highway === 'footway' && e.props.step_free === true));
    expect(pieces).toHaveLength(2);
    for (const e of pieces) {
      expect(e.props).toMatchObject({ highway: 'footway', edge_type: 'outdoor', step_free: true, source: 't', flat_exact: false });
      expect(e.props.elev_diff_m).toBeUndefined();
      expect(e.props.grade_pct).toBeUndefined();
    }
    expect(s.history.current().edges['e_road']!.props.from).toBe('road_a'); // the longer piece keeps the id
  });

  it('two points on one edge, first and last on it: two splits, no repeated node, no edge along the road', () => {
    const { s, state } = setup();
    runPlan(s.history, ok(planPath(state, s.ctx, [onRoad(10), free(20, 15), onRoad(30)], 'flat', OUTDOOR)));
    const after = s.history.current();
    const made = added(state, after);
    expect(made.nodes).toHaveLength(3); // two split nodes and the free point
    expect(made.edges).toHaveLength(4); // two pieces split off, two path edges
    const ids = made.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(3);
    for (const e of Object.values(after.edges)) expect(metres(after.nodes[e.props.from]!.coord, after.nodes[e.props.to]!.coord)).toBeGreaterThan(0.5);
    // The road is now road_a – s1 – s2 – road_b.
    const g = graphOf(s);
    expect(findRoute(g, 'road_a', 'road_b', 'shortest')).toMatchObject({ found: true, distanceM: 40 });
  });

  it('the same place clicked twice is one split; points on the road only draw nothing', () => {
    const { s, state } = setup();
    const plan = ok(planPath(state, s.ctx, [onRoad(10), onRoad(10.4), free(10, 12)], 'flat', OUTDOOR));
    runPlan(s.history, plan);
    expect(added(state, s.history.current()).nodes).toHaveLength(2);
    const only = planPath(state, s.ctx, [onRoad(10), onRoad(30)], 'flat', OUTDOOR);
    expect(only && isError(only) ? only.error : '').toMatch(/기존 구간 위만/);
  });

  it('a point within 1 m of an end of the edge is that end node: no split', () => {
    const { s, state } = setup();
    runPlan(s.history, ok(planPath(state, s.ctx, [free(-5, 10), onRoad(0.6)], 'flat', OUTDOOR)));
    const made = added(state, s.history.current());
    expect(made.nodes).toHaveLength(1);
    expect(made.edges).toHaveLength(1);
    expect(made.edges[0]!.props.to).toBe('road_a');
  });

  it('곡선: a control point on the edge splits it the same way, and the curve ends exactly on the split node', () => {
    const { s, state } = setup();
    runPlan(s.history, ok(planCurvePath(state, s.ctx, [free(0, 20), free(10, 25), onRoad(20)], 'flat', OUTDOOR)));
    const after = s.history.current();
    const made = added(state, after);
    const split = made.nodes.find((n) => metres(n.coord, P(X + 20, 0)) < 0.01)!;
    const last = made.edges.find((e) => e.props.to === split.id && e.props.step_free === null)!; // the curve, not the road piece
    expect(last.vertices.length).toBeGreaterThan(0);
    const g = graphOf(s);
    expect(findRoute(g, 'road_b', made.nodes.find((n) => metres(n.coord, P(X, 20)) < 0.01)!.id, 'shortest').found).toBe(true);
  });

  it('planDrawnPath (what the map calls) and an edge of another scope', () => {
    const { s, state } = setup();
    expect(runPlan(s.history, ok(planDrawnPath(state, s.ctx, [free(20, 15), onRoad(20)], 'flat', OUTDOOR))).ok).toBe(true);
    const indoor = { kind: 'building' as const, buildingId: 'nope', level: 1 };
    const r = planPath(state, s.ctx, [free(20, 15), onRoad(20)], 'flat', indoor);
    expect(r && isError(r)).toBe(true);
  });
});
