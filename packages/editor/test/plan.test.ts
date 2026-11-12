import { describe, expect, it } from 'vitest';
import { deleteNodes, type EditState } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { buildingsToDelete, classify, nextSelection, planDelete, planMerge, planSetProps, propsPatch } from '../src/model/ops.ts';
import { isError, planReason, runPlan, type Plan, type PlanResult } from '../src/model/plan.ts';
import {
  planBridge, planConnect, planElevator, planIndoorNode, planOutdoorNode, planOutdoorPath, planPortal, planStairs,
} from '../src/model/tools.ts';

const ok = (r: PlanResult | null): Plan => {
  if (!r || isError(r)) throw new Error(r ? r.error : 'no plan');
  return r;
};
const nodeCount = (s: EditState) => Object.keys(s.nodes).length;
const edgeCount = (s: EditState) => Object.keys(s.edges).length;

describe('바깥 길 (planOutdoorPath)', () => {
  it('turns 4 clicks into 4 outdoor nodes and 3 edges, as one history entry', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const plan = ok(planOutdoorPath(before, s.ctx, [
      { position: [127.01, 37.01] }, { position: [127.011, 37.01] }, { position: [127.012, 37.01] }, { position: [127.013, 37.01] },
    ], 'steps'));
    expect(runPlan(s.history, plan)).toEqual({ ok: true, warnings: [] });
    const after = s.history.current();
    expect(nodeCount(after) - nodeCount(before)).toBe(4);
    expect(edgeCount(after) - edgeCount(before)).toBe(3);
    const created = Object.values(after.edges).filter((e) => !(e.id in before.edges));
    expect(created.every((e) => /^e_out_[0-9a-z]{6}$/.test(e.id) && e.props.step_free === false && e.props.rev === 1)).toBe(true);
    expect(Object.values(after.nodes).filter((n) => !(n.id in before.nodes)).every((n) => /^n_out_[0-9a-z]{6}$/.test(n.id))).toBe(true);
    expect(s.history.size()).toBe(1);
    s.history.undo(); // one Ctrl+Z takes the whole path back
    expect(s.history.current()).toEqual(before);
    expect(s.history.canUndo()).toBe(false);
  });

  it('attaches to an existing node, closes a loop on the first new node, ignores repeated clicks, and draws nothing for one click', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const a = ok(planOutdoorPath(st, s.ctx, [{ nodeId: 'n_out_0003' }, { position: [127.05, 37.05] }, { position: [127.05, 37.05] }], 'flat'));
    runPlan(s.history, a);
    expect(nodeCount(s.history.current()) - nodeCount(st)).toBe(1);
    expect(edgeCount(s.history.current()) - edgeCount(st)).toBe(1);

    const s2 = fixtureSession(2);
    const loop = ok(planOutdoorPath(s2.history.current(), s2.ctx, [{ position: [127.1, 37.1] }, { position: [127.1, 37.2] }, { position: [127.2, 37.2] }, { position: [127.1, 37.1] }], 'flat'));
    runPlan(s2.history, loop);
    expect(nodeCount(s2.history.current()) - nodeCount(st)).toBe(3);
    expect(edgeCount(s2.history.current()) - edgeCount(st)).toBe(3);
    expect(planOutdoorPath(st, s.ctx, [{ position: [127, 37.5] }], 'flat')).toBeNull();
  });
});

describe('지점 추가, 엘리베이터, 계단', () => {
  it('adds outdoor points and named poi, refusing an empty name', () => {
    const s = fixtureSession();
    expect(isError(planOutdoorNode(s.history.current(), s.ctx, [127.2, 37.2], ' '))).toBe(true);
    runPlan(s.history, ok(planOutdoorNode(s.history.current(), s.ctx, [127.2, 37.2], '후문')));
    const poi = Object.values(s.history.current().nodes).find((n) => n.props.name === '후문')!;
    expect(poi.props).toMatchObject({ node_type: 'poi', building_id: null, level: null, rev: 1 });
  });

  it('classroom door: validates the number, names it, and needs a level of the building', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(isError(planIndoorNode(st, s.ctx, { buildingId: 'bldg_A', level: 1, kind: 'classroom', position: [127.0005, 37.0004], ref: '4 08' }))).toBe(true);
    expect(isError(planIndoorNode(st, s.ctx, { buildingId: 'bldg_A', level: 9, kind: 'corridor', position: [127.0005, 37.0004] }))).toBe(true);
    runPlan(s.history, ok(planIndoorNode(st, s.ctx, { buildingId: 'bldg_A', level: 1, kind: 'classroom', position: [127.0005, 37.0004], ref: '408' })));
    const door = Object.values(s.history.current().nodes).find((n) => n.props.ref === '408' && !(n.id in st.nodes))!;
    expect(door.id).toMatch(/^n_A_1_door_[0-9a-z]{6}$/);
    expect(door.props).toMatchObject({ node_type: 'door', space_name: '408호 강의실', building_id: 'bldg_A', level: 1 });
  });

  it('elevator: one stop per checked level at one spot, joined stop to stop, next shaft letter', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(isError(planElevator(st, s.ctx, { buildingId: 'bldg_A', position: [127.0005, 37.0005], levels: [2] }))).toBe(true);
    runPlan(s.history, ok(planElevator(st, s.ctx, { buildingId: 'bldg_A', position: [127.0005, 37.0005], levels: [1, 2, 4] })));
    const after = s.history.current();
    const stops = Object.values(after.nodes).filter((n) => n.props.elevator_id === 'A_elevB');
    expect(stops.map((n) => n.props.level).sort()).toEqual([1, 2, 4]);
    expect(new Set(stops.map((n) => n.coord.join(','))).size).toBe(1);
    const edges = Object.values(after.edges).filter((e) => !(e.id in st.edges));
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.props.highway === 'elevator' && e.props.step_free === true)).toBe(true);
    expect(s.history.size()).toBe(1);
  });

  it('stairs: a landing per level and one steps edge per floor, either direction', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(isError(planStairs(st, s.ctx, { buildingId: 'bldg_A', position: [127.0005, 37.0005], from: 2, to: 2 }))).toBe(true);
    runPlan(s.history, ok(planStairs(st, s.ctx, { buildingId: 'bldg_A', position: [127.0005, 37.0005], from: 3, to: 1 })));
    const after = s.history.current();
    expect(nodeCount(after) - nodeCount(st)).toBe(3);
    const edges = Object.values(after.edges).filter((e) => !(e.id in st.edges));
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.props.highway === 'steps' && e.props.step_free === false && e.props.level_from !== undefined)).toBe(true);
  });
});

describe('잇기, 포탈, 연결통로', () => {
  it('connect: corridor on one floor, footway outdoors, and refuses jumps and duplicates', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(isError(planConnect(st, s.ctx, 'n_A_1_main', 'n_out_0001'))).toBe(true);
    expect(isError(planConnect(st, s.ctx, 'n_A_1_main', 'n_A_2_hall'))).toBe(true);
    expect(isError(planConnect(st, s.ctx, 'n_A_1_hall', 'n_A_1_main'))).toBe(true); // already joined
    runPlan(s.history, ok(planConnect(st, s.ctx, 'n_A_1_main', 'n_A_1_stair')));
    runPlan(s.history, ok(planConnect(s.history.current(), s.ctx, 'n_out_0007', 'n_out_0001')));
    const made = Object.values(s.history.current().edges).filter((e) => !(e.id in st.edges));
    expect(made.map((e) => [e.props.highway, e.props.edge_type, e.props.step_free]).sort()).toEqual([['corridor', 'indoor', null], ['footway', 'outdoor', null]]);
  });

  it('portal and bridge carry what the schema needs', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(isError(planPortal(st, s.ctx, 'n_A_1_hall', 'n_out_0007'))).toBe(true); // not an entrance
    runPlan(s.history, ok(planPortal(st, s.ctx, 'n_A_1_main', 'n_out_0007')));
    const portal = Object.values(s.history.current().edges).find((e) => !(e.id in st.edges))!;
    expect(portal.props).toMatchObject({ edge_type: 'portal', step_free: null, from: 'n_A_1_main', to: 'n_out_0007' });
    expect(isError(planBridge(st, s.ctx, 'n_A_1_hall', 'n_A_1_main'))).toBe(true); // same building
    runPlan(s.history, ok(planBridge(st, s.ctx, 'n_A_1_hall', 'n_B_1_main')));
    const made = Object.values(s.history.current().edges).filter((e) => e.props.edge_type === 'bridge' && !(e.id in st.edges));
    expect(made[0]!.props).toMatchObject({ building_from: 'bldg_A', building_to: 'bldg_B', level_from: 1, level_to: 1 });
  });
});

describe('삭제, heal 삭제, 합치기 (5.3)', () => {
  /** a - b - c on one kind of outdoor path, so b can be healed. */
  const chain = () => {
    const s = fixtureSession();
    runPlan(s.history, ok(planOutdoorPath(s.history.current(), s.ctx, [{ position: [127.3, 37.3] }, { position: [127.3, 37.301] }, { position: [127.3, 37.302] }], 'flat')));
    const st = s.history.current();
    const ids = Object.keys(st.nodes).filter((id) => st.nodes[id]!.coord[0] === 127.3).sort((x, y) => st.nodes[x]!.coord[1] - st.nodes[y]!.coord[1]);
    return { s, ids };
  };

  it('Delete removes the selected nodes with their edges; undo brings it all back', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const plan = ok(planDelete(before, s.ctx, ['n_out_0002'], false));
    expect(plan.annotation).toBe('지점 1개 삭제');
    expect(runPlan(s.history, plan).ok).toBe(true);
    const after = s.history.current();
    expect('n_out_0002' in after.nodes).toBe(false);
    expect(Object.values(after.edges).some((e) => e.props.from === 'n_out_0002' || e.props.to === 'n_out_0002')).toBe(false);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
    s.history.redo();
    expect(s.history.current()).toEqual(after);
  });

  it('deleting a node and an edge it carries together does not fail on the missing edge', () => {
    const s = fixtureSession();
    const plan = ok(planDelete(s.history.current(), s.ctx, ['n_out_0002', 'e_out_0002__out_0004', 'e_out_0005__out_0003'], false));
    expect(runPlan(s.history, plan).ok).toBe(true);
    expect('e_out_0005__out_0003' in s.history.current().edges).toBe(false);
    expect(s.history.size()).toBe(1);
  });

  it('Delete on an edge keeps its nodes that still have edges', () => {
    const s = fixtureSession();
    runPlan(s.history, ok(planDelete(s.history.current(), s.ctx, ['e_out_0004__out_0005'], false)));
    expect('e_out_0004__out_0005' in s.history.current().edges).toBe(false);
    expect('n_out_0004' in s.history.current().nodes).toBe(true);
  });

  it('Shift+Delete joins the two edges of the middle node; plain Delete drops both', () => {
    const { s, ids } = chain();
    const before = s.history.current();
    runPlan(s.history, ok(planDelete(before, s.ctx, [ids[1]!], true)));
    const healed = s.history.current();
    expect(ids[1]! in healed.nodes).toBe(false);
    expect(edgeCount(healed) - edgeCount(before)).toBe(-1);
    const joined = Object.values(healed.edges).find((e) => [e.props.from, e.props.to].includes(ids[0]!))!;
    expect([joined.props.from, joined.props.to].sort()).toEqual([ids[0], ids[2]].sort());
    expect(joined.vertices).toHaveLength(1); // the deleted node became a bend
    s.history.undo();
    runPlan(s.history, ok(planDelete(s.history.current(), s.ctx, [ids[1]!], false)));
    expect(edgeCount(s.history.current()) - edgeCount(before)).toBe(-2);
  });

  it('M merges the selected nodes, the last picked one stays', () => {
    const { s, ids } = chain();
    const plan = ok(planMerge(s.history.current(), s.ctx, [ids[0]!, ids[2]!]));
    expect(plan.annotation).toBe('지점 2개 합치기');
    runPlan(s.history, plan);
    const st = s.history.current();
    expect(ids[0]! in st.nodes).toBe(false);
    expect(ids[2]! in st.nodes).toBe(true);
    expect(isError(planMerge(st, s.ctx, [ids[2]!]))).toBe(true);
  });

  it('says why a merge is refused: nodes of different scopes', () => {
    const s = fixtureSession();
    const plan = ok(planMerge(s.history.current(), s.ctx, ['n_out_0007', 'n_A_1_hall']));
    expect(planReason(s.history.current(), plan)).toContain('범위');
    const r = runPlan(s.history, plan);
    expect(r.ok).toBe(false);
    expect(s.history.canUndo()).toBe(false); // nothing left behind
  });

  it('a failing step leaves no entry behind', () => {
    const s = fixtureSession();
    const before = s.history.current();
    const plan: Plan = { annotation: 'x', steps: [() => deleteNodes(['n_out_0002']), () => deleteNodes(['n_gone'])] };
    expect(runPlan(s.history, plan).ok).toBe(false);
    expect(s.history.current()).toEqual(before);
    expect(s.history.canUndo()).toBe(false);
    expect(s.history.canRedo()).toBe(false);
  });

  it('warns when something deleted has an override (W14)', () => {
    const s = fixtureSession();
    s.ctx.overrideIds = new Set(['n_out_0002']);
    const r = runPlan(s.history, ok(planDelete(s.history.current(), s.ctx, ['n_out_0002'], false)));
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.warnings[0]).toContain('overrides.json');
  });

  it('a building goes with everything in it, and the dialog counts are core previews', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const [b] = buildingsToDelete(st, ['bldg_B']);
    const inside = Object.values(st.nodes).filter((n) => n.props.building_id === 'bldg_B').length;
    expect(b).toMatchObject({ code: 'B', name: expect.any(String), preview: { nodes: inside } });
    expect(b!.preview.edges).toBeGreaterThan(0); // portals and bridges count too
    const plan = ok(planDelete(st, s.ctx, ['bldg_B'], false));
    expect(plan.annotation).toContain('건물 B 삭제');
    runPlan(s.history, plan);
    const after = s.history.current();
    expect('B' in after.buildings).toBe(false);
    expect(Object.values(after.nodes).some((n) => n.props.building_id === 'bldg_B')).toBe(false);
    s.history.undo();
    expect(s.history.current()).toEqual(st);
  });

  it('nothing selected says what to do', () => {
    const s = fixtureSession();
    expect(planDelete(s.history.current(), s.ctx, [], false)).toEqual({ error: '먼저 지울 지점이나 구간을 골라 주세요.' });
    expect(classify(s.history.current(), ['n_out_0001', 'e_out_0001__out_0002', 'bldg_A', 'gone'])).toEqual({
      nodes: ['n_out_0001'], edges: ['e_out_0001__out_0002'], rooms: [], buildings: ['A'],
    });
  });
});

describe('선택과 속성', () => {
  it('click selects one, Shift+click adds or removes, empty ground clears', () => {
    expect(nextSelection([], 'a', false)).toEqual(['a']);
    expect(nextSelection(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(nextSelection(['a', 'b'], 'a', true)).toEqual(['b']);
    expect(nextSelection(['a', 'b'], 'c', false)).toEqual(['c']);
    expect(nextSelection(['a', 'b'], null, false)).toEqual([]);
    expect(nextSelection(['a', 'b'], null, true)).toEqual(['a', 'b']);
  });

  it('property edits go through setProps: rev +1 once, no entry for a change that changes nothing', () => {
    const s = fixtureSession();
    const st = s.history.current();
    const edge = st.edges['e_A_1_hall__A_1_stair']!;
    expect(propsPatch(edge.props, { step_free: edge.props.step_free })).toBeNull();
    const patch = propsPatch(edge.props, { step_free: null, needs_check: true })!;
    expect(patch).toEqual({ step_free: null, needs_check: true });
    runPlan(s.history, ok(planSetProps(st, edge.id, patch)));
    const now = s.history.current().edges[edge.id]!.props;
    expect(now).toMatchObject({ step_free: null, needs_check: true, rev: edge.props.rev + 1 });
    runPlan(s.history, ok(planSetProps(s.history.current(), edge.id, propsPatch(now, { needs_check: false })!)));
    expect('needs_check' in s.history.current().edges[edge.id]!.props).toBe(false);
  });

  it('keeps the climb time of an indoor flight within 0-30 s', () => {
    const s = fixtureSession();
    const flight = s.history.current().edges['e_A_1_stair__A_2_stair']!;
    expect(propsPatch(flight.props, { flight_sec: 99 })).toEqual({ flight_sec: 30 });
    expect(propsPatch(flight.props, { flight_sec: -4 })).toEqual({ flight_sec: 0 });
  });
});
