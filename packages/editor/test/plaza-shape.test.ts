// 평지 도형 수정·합치기·출입구 연결 in the editor: the shape draft (outer ring and holes), the two-side merge,
// the foot of the perpendicular from an entrance onto a plaza edge, and the save path a new plaza goes through.
import { describe, expect, it } from 'vitest';
import {
  addPlaza,
  createHistory,
  emptyState,
  locateInPlaza,
  nearestOnPlazaBoundary,
  plazaAreaM2,
  plazaTouchesNetwork,
  validateCampus,
  type EditState,
  type Position,
} from '@campo/core';
import { readFolder, FIXTURE } from './fixture.ts';
import { createSession, stateToCampus, type Session } from '../src/model/session.ts';
import { draftPolygon, draftProblem, insertPlazaCorner, movePlazaCorner, planPlazaShape, redoPlazaEdit, removePlazaCorner, startPlazaEdit, undoPlazaEdit, type PlazaEditDraft } from '../src/model/plazaEdit.ts';
import { edgePickLabel, planMergePlazas, type PlazaEdgePick } from '../src/model/plazaMerge.ts';
import { planPortal, planPortalToPlaza } from '../src/model/tools.ts';
import { planPlaza } from '../src/model/plaza.ts';
import { isError, runPlan, type Plan } from '../src/model/plan.ts';

const PLAZA_FIXTURE = FIXTURE.replace(/campus-basic$/, 'campus-plaza');
const plazaSession = (): Session => createSession('fixture-plaza', readFolder(PLAZA_FIXTURE), 3);
const basicSession = (): Session => createSession('fixture', readFolder(FIXTURE), 5);

const draftOf = (r: PlazaEditDraft | { error: string }): PlazaEditDraft => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

function run(history: ReturnType<typeof createHistory>, plan: Plan | { error: string }) {
  if (isError(plan)) throw new Error(plan.error);
  const r = runPlan(history, plan);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe('평지 모양 수정 (plazaEdit.ts)', () => {
  it('starts from the outer ring and the holes, and each corner change is one draft step', () => {
    const s = plazaSession();
    const state = s.history.current();
    const plaza = state.plazas['plaza_ring']!;
    const d0 = draftOf(startPlazaEdit(state, 'plaza_ring'));
    expect(d0.rings).toHaveLength(2); // the outer ring and the hole
    expect(d0.rings[0]).toHaveLength(4);
    expect(d0.rings[1]).toHaveLength(4);

    const moved = movePlazaCorner(d0, 0, 1, [127.0005, 37.0]);
    expect(moved.past).toHaveLength(1);
    const inserted = insertPlazaCorner(moved, 1, 0, [127.0002, 37.0001]);
    expect(inserted.rings[1]).toHaveLength(5);
    const back = undoPlazaEdit(inserted);
    expect(back.rings[1]).toHaveLength(4);
    expect(redoPlazaEdit(back).rings[1]).toHaveLength(5);
    // Removing keeps at least three corners on every ring, the hole included.
    let small = inserted;
    while (small.rings[1]!.length > 3) small = draftOf(removePlazaCorner(small, 1, 0) as PlazaEditDraft);
    expect(removePlazaCorner(small, 1, 0)).toMatchObject({ error: expect.stringContaining('3개 이상') });
  });

  it('완료 writes the shape as one history entry with rev + 1, holes kept; one undo restores it', () => {
    const s = plazaSession();
    const h = s.history;
    const before = h.current();
    const original = before.plazas['plaza_ring']!;
    const d = movePlazaCorner(draftOf(startPlazaEdit(before, 'plaza_ring')), 0, 2, [127.0003, 37.00024]);
    const plan = planPlazaShape(before, d);
    if ('error' in plan) throw new Error(plan.error);
    expect(runPlan(h, plan).ok).toBe(true);
    const after = h.current().plazas['plaza_ring']!;
    expect(after.polygon).toHaveLength(2);
    expect(after.polygon[0]).toEqual(draftPolygon(d)[0]);
    expect(after.props.rev).toBe(original.props.rev + 1);
    expect(plazaAreaM2(after.polygon)).not.toBeCloseTo(plazaAreaM2(original.polygon), 3);
    h.undo();
    expect(h.current()).toEqual(before);
  });

  it('a shape that crosses itself is reported before 완료 is pressed', () => {
    const state = plazaSession().history.current();
    const d = draftOf(startPlazaEdit(state, 'plaza_ring'));
    // The second corner pushed across the fourth side: the ring crosses itself.
    const crossed = movePlazaCorner(d, 0, 1, [126.9999, 37.00035]);
    expect(draftProblem(crossed)).toMatch(/겹칩니다|바깥으로 나갑니다/);
    expect(draftProblem(d)).toBe(false);
  });
});

describe('평지 합치기 (plazaMerge.ts)', () => {
  const ringEast = (at: Position): PlazaEdgePick => ({ plazaId: 'plaza_ring', ring: 0, segment: 1, at });
  const lawnWest = (at: Position): PlazaEdgePick => ({ plazaId: 'plaza_lawn', ring: 0, segment: 3, at });

  it('joins two facing plazas into the first one, filling the space between the sides', () => {
    const s = plazaSession();
    const h = s.history;
    const before = h.current();
    const a = before.plazas['plaza_ring']!;
    const b = before.plazas['plaza_lawn']!;
    const plan = planMergePlazas(before, ringEast([127.00045, 37.0001]), lawnWest([127.000675, 37.0001]));
    if ('error' in plan) throw new Error(plan.error);
    expect(runPlan(h, plan).ok).toBe(true);
    const after = h.current();
    expect(Object.keys(after.plazas)).toEqual(['plaza_ring']);
    expect(after.plazas['plaza_lawn']).toBeUndefined();
    const merged = after.plazas['plaza_ring']!;
    expect(merged.props.name).toBe(a.props.name);
    expect(merged.props.rev).toBe(a.props.rev + 1);
    // The gap between the two facing sides is now plaza, and the hole of the first plaza is still a hole.
    expect(locateInPlaza(merged.polygon, [127.00056, 37.00009])).toBe('solid');
    expect(merged.polygon).toHaveLength(2);
    expect(plazaAreaM2(merged.polygon)).toBeGreaterThan(plazaAreaM2(a.polygon) + plazaAreaM2(b.polygon));
    h.undo();
    expect(h.current()).toEqual(before);
  });

  it('says what to click instead for the same plaza twice, and names the sides for the status line', () => {
    const state = plazaSession().history.current();
    expect(planMergePlazas(state, ringEast([127.00045, 37.0001]), { plazaId: 'plaza_ring', ring: 0, segment: 2, at: [127.0002, 37.00027] }))
      .toMatchObject({ error: expect.stringContaining('다른 평지') });
    expect(edgePickLabel(state, ringEast([127.00045, 37.0001]))).toMatch(/분수 광장.*바깥 2번째 변/);
    expect(edgePickLabel(state, { plazaId: 'plaza_ring', ring: 1, segment: 0, at: [127.0002, 37.0001] })).toMatch(/구멍 1/);
  });
});

describe('출입구 → 평지 수선의 발 연결 (planPortalToPlaza)', () => {
  /** Campus-basic plus a plaza west of building A, its east side a few metres from A's main entrance. */
  function withPlazaNearEntrance(): { session: Session; state: EditState; plazaId: string } {
    const session = basicSession();
    const ring: Position[] = [[127.00015, 37.00035], [127.00035, 37.00035], [127.00035, 37.0005], [127.00015, 37.0005], [127.00015, 37.00035]];
    const made = planPlaza(session.history.current(), session.ctx, ring);
    if (isError(made.plan)) throw new Error(made.plan.error);
    run(session.history, made.plan);
    return { session, state: session.history.current(), plazaId: made.plazaId! };
  }

  it('puts an outdoor point on the plaza edge nearest the door and joins the two with a portal edge', () => {
    const { session, state, plazaId } = withPlazaNearEntrance();
    const entrance = state.nodes['n_A_1_main']!;
    expect(entrance.props.node_type).toBe('entrance');
    const foot = nearestOnPlazaBoundary(state.plazas[plazaId]!.polygon, entrance.coord)!;
    const before = Object.keys(state.nodes);
    const plan = planPortalToPlaza(state, session.ctx, 'n_A_1_main', plazaId);
    if ('error' in plan) throw new Error(plan.error);
    expect(runPlan(session.history, plan).ok).toBe(true);
    const after = session.history.current();
    const added = Object.values(after.nodes).find((n) => !before.includes(n.id))!;
    expect(added.props).toMatchObject({ kind: 'node', node_type: 'outdoor', building_id: null, level: null });
    expect(Math.hypot(added.coord[0] - foot.position[0], added.coord[1] - foot.position[1])).toBeLessThan(1e-9);
    const edge = Object.values(after.edges).find((e) => e.props.edge_type === 'portal' &&
      ((e.props.from === 'n_A_1_main' && e.props.to === added.id) || (e.props.to === 'n_A_1_main' && e.props.from === added.id)))!;
    expect(edge).toBeDefined();
    // The plaza now touches the walkable network, so W17 has nothing to say about it.
    const nodes = Object.values(after.nodes).map((n) => n.coord);
    const lines = Object.values(after.edges).map((e) => [after.nodes[e.props.from]!.coord, after.nodes[e.props.to]!.coord]);
    expect(plazaTouchesNetwork(after.plazas[plazaId]!.polygon, nodes, lines)).toBe(true);
    expect(session.history.undo()).toEqual(state);
  });

  it('says so when the door is already joined to that edge, and before anything else when the target is no entrance', () => {
    const { session, plazaId } = withPlazaNearEntrance();
    run(session.history, planPortalToPlaza(session.history.current(), session.ctx, 'n_A_1_main', plazaId));
    const again = planPortalToPlaza(session.history.current(), session.ctx, 'n_A_1_main', plazaId);
    expect(again).toMatchObject({ error: expect.stringContaining('이미') });
    expect(planPortalToPlaza(session.history.current(), session.ctx, 'n_A_4_408door', plazaId)).toMatchObject({ error: expect.stringContaining('출입구') });
    expect(planPortal(session.history.current(), session.ctx, 'n_A_1_main', 'n_A_1_main')).toMatchObject({ error: expect.any(String) });
  });
});

describe('평지 저장 경로 (스키마)', () => {
  it('a plaza the editor draws passes the schema check: no /properties/kind error', () => {
    const session = basicSession();
    const ring: Position[] = [[127.0002, 37.0001], [127.0003, 37.0001], [127.0003, 37.0002], [127.0002, 37.0002], [127.0002, 37.0001]];
    const made = planPlaza(session.history.current(), session.ctx, ring);
    if (isError(made.plan)) throw new Error(made.plan.error);
    run(session.history, made.plan);
    const state = session.history.current();
    const files = stateToCampus(state, session.meta, session.passthrough, session.extras);
    const result = validateCampus(files);
    expect(result.errors.filter((e) => e.code === 'schema').map((e) => e.message)).toEqual([]);
    expect(result.errors.filter((e) => e.message.includes('properties/kind'))).toEqual([]);
  });

  it('a plaza merged into another still passes the schema check', () => {
    const s = plazaSession();
    const plan = planMergePlazas(s.history.current(), { plazaId: 'plaza_ring', ring: 0, segment: 1, at: [127.00045, 37.0001] }, { plazaId: 'plaza_lawn', ring: 0, segment: 3, at: [127.000675, 37.0001] });
    if ('error' in plan) throw new Error(plan.error);
    run(s.history, plan);
    const campus = stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras);
    expect(validateCampus(campus).errors.filter((e) => e.code === 'schema')).toEqual([]);
  });
});

describe('평지 도형 수정과 저장', () => {
  it('a shape edit of a plaza with a hole keeps the hole in the saved file', () => {
    const s = plazaSession();
    const d = movePlazaCorner(draftOf(startPlazaEdit(s.history.current(), 'plaza_ring')), 1, 0, [127.00019, 37.00012]);
    const plan = planPlazaShape(s.history.current(), d);
    if ('error' in plan) throw new Error(plan.error);
    run(s.history, plan);
    const campus = stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras);
    expect(validateCampus(campus).errors.filter((e) => e.code === 'schema')).toEqual([]);
    const saved = Object.values(s.history.current().plazas['plaza_ring']!.polygon);
    expect(saved).toHaveLength(2);
  });
});
