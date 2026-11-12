// Working in any order (SPEC-v0.2 6.5): elevators, doors and restrooms before or after the corridor give the same walkable result.
import { describe, expect, it } from 'vitest';
import { buildGraph, findRoute, validateCampus, type EditState, type Position } from '@campo/core';
import { planAddBuilding } from '../src/model/building.ts';
import { NOT_CONNECTED_NOTICE, planAttachUnattached, planDrawnPath, unattachedNodes } from '../src/model/connect.ts';
import { planDoor, planRestroom } from '../src/model/doors.ts';
import { planElevator, planElevatorEdit, stopsOf } from '../src/model/elevator.ts';
import { isError, runPlan, type Plan, type PlanResult } from '../src/model/plan.ts';
import { OUTDOOR, scopeAt, type Scope } from '../src/model/scope.ts';
import { createSession, defaultMeta, stateToCampus, type Session } from '../src/model/session.ts';
import { planIndoorNode, planPath } from '../src/model/tools.ts';

const ok = (r: PlanResult | null): Plan => {
  if (!r || isError(r)) throw new Error(r ? r.error : 'no plan');
  return r;
};

/** A 4-floor building "T", 80 m by 55 m, nothing in it yet. */
function emptyBuilding(seed = 11): Session {
  const s = createSession('x', [{ path: 'campus.json', text: JSON.stringify(defaultMeta('x')) }], seed);
  const ring: Position[] = [[127, 37], [127.001, 37], [127.001, 37.0005], [127, 37.0005], [127, 37]];
  expect(runPlan(s.history, ok(planAddBuilding(ring, { name: '테스트관', code: 'T', levels: [1, 2, 3, 4], groundLevels: [1] }))).ok).toBe(true);
  return s;
}

const floor = (level: number): Scope => ({ kind: 'building', buildingId: 'bldg_T', level });
const LOBBY: Position = [127.0005, 37.00021];
const CORRIDOR: Position[] = [[127.0001, 37.0002], [127.0009, 37.0002]];

const drawCorridor = (s: Session, level: number) =>
  runPlan(s.history, ok(planDrawnPath(s.history.current(), s.ctx, CORRIDOR.map((position) => ({ position })), 'flat', floor(level))));
const addElevator = (s: Session, at: Position = LOBBY, levels = [1, 2, 3, 4]) =>
  runPlan(s.history, ok(planElevator(s.history.current(), s.ctx, { buildingId: 'bldg_T', position: at, levels })));

/** The corridor end node of `level` at `coord`. */
const endAt = (st: EditState, level: number, coord: Position) =>
  Object.values(st.nodes).find((n) => n.props.level === level && n.props.node_type === 'corridor' && n.coord[0] === coord[0] && n.coord[1] === coord[1])!.id;

function route(s: Session, from: Position, fromLevel: number, to: Position, toLevel: number) {
  const st = s.history.current();
  const graph = buildGraph(stateToCampus(st, s.meta, [], []));
  return findRoute(graph, endAt(st, fromLevel, from), endAt(st, toLevel, to), 'shortest');
}

describe('엘리베이터 먼저, 복도 나중', () => {
  it('leaves the stops unattached, then the corridor attaches them in the same entry', () => {
    const s = emptyBuilding();
    const placed = addElevator(s);
    expect(placed).toEqual({ ok: true, warnings: [] });
    expect(unattachedNodes(s.history.current())).toHaveLength(4);
    // The plan says so (the screen shows it as a warning).
    const again = ok(planElevator(s.history.current(), s.ctx, { buildingId: 'bldg_T', position: [127.0007, 37.00031], levels: [1, 2] }));
    expect(again.notices).toEqual([NOT_CONNECTED_NOTICE]);

    const sizeBefore = s.history.size();
    const plan = ok(planDrawnPath(s.history.current(), s.ctx, CORRIDOR.map((position) => ({ position })), 'flat', floor(2)));
    expect(plan.notices).toEqual(['지점 1개를 복도에 이었어요']);
    runPlan(s.history, plan);
    expect(s.history.size()).toBe(sizeBefore + 1);
    expect(unattachedNodes(s.history.current()).map((n) => n.props.level).sort()).toEqual([1, 3, 4]);
    for (const level of [1, 3, 4]) drawCorridor(s, level);
    expect(unattachedNodes(s.history.current())).toHaveLength(0);
  });

  it('Ctrl+Z once takes the corridor and the connection away together', () => {
    const s = emptyBuilding();
    addElevator(s);
    const before = s.history.current();
    const size = s.history.size();
    drawCorridor(s, 1);
    expect(s.history.size()).toBe(size + 1);
    expect(unattachedNodes(s.history.current())).toHaveLength(3);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
    expect(unattachedNodes(s.history.current())).toHaveLength(4);
  });

  it('does not attach a point farther than 8 m from the new corridor', () => {
    const s = emptyBuilding();
    runPlan(s.history, ok(planRestroom(s.history.current(), s.ctx, { position: [127.0005, 37.00045], scope: floor(1), form: { gender: 'male', wheelchair: 'unknown', changingTable: null } })));
    expect(unattachedNodes(s.history.current())).toHaveLength(1); // 25 m from where the corridor will be
    drawCorridor(s, 1);
    expect(unattachedNodes(s.history.current())).toHaveLength(1);
    const all = planAttachUnattached(s.history.current(), s.ctx, floor(1));
    expect(all.plan).toBeNull();
    expect(all.failed).toHaveLength(1);
    expect(all.failed[0]!.reason).toMatch(/복도 구간이 없습니다/);
  });
});

describe('복도 먼저, 엘리베이터 나중', () => {
  it('joins the corridor right away and says nothing about waiting', () => {
    const s = emptyBuilding();
    for (const level of [1, 2, 3, 4]) drawCorridor(s, level);
    const plan = ok(planElevator(s.history.current(), s.ctx, { buildingId: 'bldg_T', position: LOBBY, levels: [1, 2, 3, 4] }));
    expect(plan.notices).toBeUndefined();
    runPlan(s.history, plan);
    expect(unattachedNodes(s.history.current())).toHaveLength(0);
  });

  it('both orders give the same route (cost, distance and steps; ids differ)', () => {
    const late = emptyBuilding(1);
    addElevator(late);
    for (const level of [1, 2, 3, 4]) drawCorridor(late, level);

    const early = emptyBuilding(2);
    for (const level of [1, 2, 3, 4]) drawCorridor(early, level);
    addElevator(early);

    const a = route(late, CORRIDOR[0]!, 1, CORRIDOR[1]!, 4);
    const b = route(early, CORRIDOR[0]!, 1, CORRIDOR[1]!, 4);
    expect(a.found && b.found).toBe(true);
    if (!a.found || !b.found) return;
    expect(a.cost).toBeCloseTo(b.cost, 6);
    expect(a.distanceM).toBeCloseTo(b.distanceM, 6);
    expect(a.steps.map((st) => st.kind)).toEqual(b.steps.map((st) => st.kind));
    expect(a.steps.filter((st) => st.kind === 'elevator')).toHaveLength(1);
  });
});

describe('엘리베이터 도구', () => {
  it('two elevators in one lobby get different elevator_id; 1F to 4F rides once', () => {
    const s = emptyBuilding();
    for (const level of [1, 2, 3, 4]) drawCorridor(s, level);
    addElevator(s, [127.0005, 37.00021]);
    addElevator(s, [127.00053, 37.00021]);
    const ids = new Set(Object.values(s.history.current().nodes).map((n) => n.props.elevator_id).filter(Boolean));
    expect([...ids].sort()).toEqual(['T_elevA', 'T_elevB']);
    expect(stopsOf(s.history.current(), 'T_elevA')).toHaveLength(4);
    expect(stopsOf(s.history.current(), 'T_elevB')).toHaveLength(4);

    const r = route(s, CORRIDOR[0]!, 1, CORRIDOR[1]!, 4);
    expect(r.found).toBe(true);
    if (!r.found) return;
    const rides = r.steps.filter((st) => st.kind === 'elevator');
    expect(rides).toHaveLength(1); // one board, one alight: not four separate rides
    expect(rides[0]).toMatchObject({ fromLevel: 1, toLevel: 4 });
    // What the editor saves is valid.
    const campus = stateToCampus(s.history.current(), s.meta, [], []);
    // (the empty test building has no entrance, which is not what this test is about)
    expect(validateCampus(campus).errors.filter((e) => e.code !== 'ground-level-without-entrance')).toEqual([]);
  });

  it('editing the floors: a middle stop goes and its neighbours are joined by a new elevator edge', () => {
    const s = emptyBuilding();
    for (const level of [1, 2, 3, 4]) drawCorridor(s, level);
    addElevator(s);
    const size = s.history.size();
    runPlan(s.history, ok(planElevatorEdit(s.history.current(), s.ctx, 'T_elevA', [1, 3, 4])));
    expect(s.history.size()).toBe(size + 1);
    const st = s.history.current();
    expect(stopsOf(st, 'T_elevA').map((n) => n.props.level)).toEqual([1, 3, 4]);
    const rides = Object.values(st.edges).filter((e) => e.props.highway === 'elevator').map((e) => [e.props.level_from, e.props.level_to].sort());
    expect(rides.sort()).toEqual([[1, 3], [3, 4]]);
    const r = route(s, CORRIDOR[0]!, 1, CORRIDOR[1]!, 4);
    expect(r.found).toBe(true);
    // adding a floor back makes one more stop, joined to its corridor
    runPlan(s.history, ok(planElevatorEdit(s.history.current(), s.ctx, 'T_elevA', [1, 2, 3, 4])));
    expect(stopsOf(s.history.current(), 'T_elevA')).toHaveLength(4);
    expect(unattachedNodes(s.history.current())).toHaveLength(0);
    expect(isError(planElevatorEdit(s.history.current(), s.ctx, 'T_elevA', [2]))).toBe(true);
  });
});

describe('문, 화장실, 범위', () => {
  it('a door before its corridor waits; a refused scope is an error, not a waiting point', () => {
    const s = emptyBuilding();
    const door = ok(planDoor(s.history.current(), s.ctx, { position: [127.0004, 37.00023], scope: floor(3), ref: '301', back: false }));
    expect(door.notices).toEqual([NOT_CONNECTED_NOTICE]);
    runPlan(s.history, door);
    expect(unattachedNodes(s.history.current())).toHaveLength(1);
    expect(isError(planDoor(s.history.current(), s.ctx, { position: [127.0004, 37.00023], scope: OUTDOOR, ref: '301', back: false }))).toBe(true);
    expect(isError(planDoor(s.history.current(), s.ctx, { position: [127.0004, 37.00023], scope: floor(9), ref: '301', back: false }))).toBe(true);
    drawCorridor(s, 3);
    expect(unattachedNodes(s.history.current())).toHaveLength(0);
  });

  it('a restroom next to a corridor is joined by one entry (addNode + attachDoor)', () => {
    const s = emptyBuilding();
    drawCorridor(s, 2);
    const size = s.history.size();
    runPlan(s.history, ok(planRestroom(s.history.current(), s.ctx, { position: [127.0003, 37.00024], scope: floor(2), form: { gender: 'female', wheelchair: 'yes', changingTable: true } })));
    expect(s.history.size()).toBe(size + 1);
    const wc = Object.values(s.history.current().nodes).find((n) => n.props.node_type === 'restroom')!;
    expect(wc.props).toMatchObject({ restroom_gender: 'female', wheelchair: 'yes', changing_table: true, level: 2 });
    expect(unattachedNodes(s.history.current())).toHaveLength(0);
  });

  it('scopeAt: inside an outline is that floor, outside is the outdoors, O forces the outdoors', () => {
    const s = emptyBuilding();
    const st = s.history.current();
    expect(scopeAt(st, [127.0005, 37.00025], OUTDOOR)).toEqual({ kind: 'building', buildingId: 'bldg_T', level: 1 });
    expect(scopeAt(st, [127.0005, 37.00025], floor(3))).toEqual(floor(3));
    expect(scopeAt(st, [127.002, 37.00025], floor(3))).toEqual(OUTDOOR);
    expect(scopeAt(st, [127.0005, 37.00025], floor(3), true)).toEqual(OUTDOOR);
  });

  it('an outdoor path that reaches an entrance makes that edge a portal; stairs are not drawn on a floor', () => {
    const s = emptyBuilding();
    runPlan(s.history, ok(planIndoorNode(s.history.current(), s.ctx, { buildingId: 'bldg_T', level: 1, kind: 'entrance', position: [127.0005, 37.00005] })));
    const entrance = Object.values(s.history.current().nodes).find((n) => n.props.node_type === 'entrance')!;
    const plan = ok(planPath(s.history.current(), s.ctx, [{ position: [127.0005, 36.9999] }, { position: [127.0005, 36.99995] }, { nodeId: entrance.id }], 'flat', OUTDOOR));
    runPlan(s.history, plan);
    const edges = Object.values(s.history.current().edges);
    expect(edges.map((e) => e.props.edge_type).sort()).toEqual(['outdoor', 'portal']);
    expect(edges.find((e) => e.props.edge_type === 'portal')!.props).toMatchObject({ highway: 'footway', to: entrance.id });
    // a floor's node cannot be attached from another floor
    expect(isError(planPath(s.history.current(), s.ctx, [{ position: [127.0002, 37.0002] }, { nodeId: entrance.id }], 'flat', floor(2))!)).toBe(true);
    expect(isError(planPath(s.history.current(), s.ctx, [{ position: [127.0002, 37.0002] }, { position: [127.0003, 37.0002] }], 'steps', floor(2))!)).toBe(true);
  });
});
