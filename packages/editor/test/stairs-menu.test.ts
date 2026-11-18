// 길 우클릭 메뉴: 계단으로 바꾸기 / 일반 길로 바꾸기 (menuFields.stairs, planMenuEdit edits.stairs).
import { describe, expect, it } from 'vitest';
import { validateCampus } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { planElevationFlag } from '../src/model/elevation.ts';
import { menuFields, planMenuEdit } from '../src/model/menu.ts';
import { isError, runPlan, type Plan, type PlanResult } from '../src/model/plan.ts';
import { stateToCampus } from '../src/model/session.ts';
import { planOutdoorPath } from '../src/model/tools.ts';

const ok = (r: PlanResult | null): Plan => {
  if (!r || isError(r)) throw new Error(r ? r.error : 'no plan');
  return r;
};
const errorOf = (r: PlanResult): string => {
  if (!isError(r)) throw new Error('expected an error');
  return r.error;
};

const FLAT = 'e_out_0001__out_0002'; // footway, outdoor
const RAMP = 'e_out_0004__out_0005'; // ramp, outdoor
const STEPS = 'e_out_0002__out_0003'; // steps, outdoor
const ESCALATOR = 'e_out_0002__out_0003_esc'; // steps + conveying, outdoor
const PORTAL = 'e_portal_A_1_main';
const INDOOR = 'e_A_1_hall__A_1_stair'; // corridor, indoor
const INDOOR_STEPS = 'e_B_1_stair__B_2_stair'; // steps, indoor
const BRIDGE = 'e_A_3_bridge__B_2_bridge';
const ELEVATOR = 'e_A_elevA_L1__A_elevA_L2';

describe('menuFields.stairs: the item and why it is blocked', () => {
  const state = fixtureSession().history.current();
  const stairs = (...ids: string[]) => menuFields(state, ids).stairs;

  it('a plain way, a ramp, or a mix of ways and steps is offered "계단으로 바꾸기"', () => {
    expect(stairs(FLAT)).toEqual({ to: 'steps', label: '계단으로 바꾸기', blocked: false });
    expect(stairs(RAMP)).toMatchObject({ to: 'steps', blocked: false });
    expect(stairs(FLAT, STEPS)).toMatchObject({ to: 'steps', label: '계단으로 바꾸기', blocked: false });
  });

  it('only steps: "일반 길로 바꾸기"', () => {
    expect(stairs(STEPS)).toEqual({ to: 'footway', label: '일반 길로 바꾸기', blocked: false });
  });

  it('is not shown without an edge in the selection', () => {
    expect(menuFields(state, ['n_out_0001']).stairs).toBeNull();
    expect(menuFields(state, []).stairs).toBeNull();
  });

  it('portal: blocked (a portal can only be a footway), with the reason', () => {
    expect(stairs(PORTAL)?.blocked).toMatch(/portal/);
    expect(stairs(FLAT, PORTAL)?.blocked).toMatch(/portal/);
  });

  it('indoor, bridge, elevator and conveying (escalator) edges: blocked, steps included', () => {
    for (const id of [INDOOR, INDOOR_STEPS, BRIDGE, ELEVATOR, ESCALATOR]) {
      expect(stairs(id)?.blocked, id).toMatch(/건물 안|같은 층/);
    }
    expect(stairs(FLAT, INDOOR)?.blocked).toBeTruthy();
  });

  it('edges mixed with points (or rooms, buildings, plazas) are blocked with the reason', () => {
    expect(stairs(FLAT, 'n_out_0001')?.blocked).toMatch(/구간만/);
    expect(stairs(FLAT, 'bldg_A')?.blocked).toMatch(/구간만/);
  });
});

describe('planMenuEdit edits.stairs', () => {
  const edge = (s: ReturnType<typeof fixtureSession>, id: string) => s.history.current().edges[id]!.props;
  const valid = (s: ReturnType<typeof fixtureSession>) => validateCampus(stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras)).errors;

  it('to steps: highway steps, step_free false, flat_exact removed, is_breakline kept; the document stays valid; one Ctrl+Z', () => {
    const s = fixtureSession();
    runPlan(s.history, ok(planElevationFlag(s.history.current(), FLAT, 'flat_exact', true)));
    const before = s.history.current();
    expect(edge(s, FLAT).flat_exact).toBe(true);
    const size = s.history.size();
    expect(runPlan(s.history, ok(planMenuEdit(before, [FLAT, RAMP], { stairs: 'steps' })))).toEqual({ ok: true, warnings: [] });
    for (const id of [FLAT, RAMP]) expect(edge(s, id)).toMatchObject({ highway: 'steps', step_free: false, edge_type: 'outdoor' });
    expect(edge(s, FLAT).flat_exact).toBeUndefined();
    expect(valid(s)).toEqual([]);
    expect(s.history.size()).toBe(size + 1);
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('keeps is_breakline (the schema allows it on steps too)', () => {
    const s = fixtureSession();
    runPlan(s.history, ok(planElevationFlag(s.history.current(), FLAT, 'is_breakline', true)));
    runPlan(s.history, ok(planMenuEdit(s.history.current(), [FLAT], { stairs: 'steps' })));
    expect(edge(s, FLAT)).toMatchObject({ highway: 'steps', is_breakline: true });
    expect(valid(s)).toEqual([]);
  });

  it('to a plain way: highway footway, step_free null (not known), no flat_exact added, is_breakline kept', () => {
    const s = fixtureSession();
    const breakline = edge(s, STEPS).is_breakline; // the fixture's outdoor steps may already be a break line: whatever it was stays
    runPlan(s.history, ok(planMenuEdit(s.history.current(), [STEPS], { stairs: 'footway' })));
    expect(edge(s, STEPS)).toMatchObject({ highway: 'footway', step_free: null });
    expect(edge(s, STEPS).is_breakline).toBe(breakline);
    expect(edge(s, STEPS).flat_exact).toBeUndefined();
    expect(valid(s)).toEqual([]);
  });

  it('a drawn steps edge goes back to what a plain drawn way is, and back again (undo, redo)', () => {
    const s = fixtureSession();
    const st = s.history.current();
    runPlan(s.history, ok(planOutdoorPath(st, s.ctx, [{ position: [127.05, 37.05] }, { position: [127.0505, 37.05] }], 'steps')));
    const id = Object.keys(s.history.current().edges).find((k) => !(k in st.edges))!;
    runPlan(s.history, ok(planMenuEdit(s.history.current(), [id], { stairs: 'footway' })));
    expect(edge(s, id)).toMatchObject({ highway: 'footway', step_free: null });
    s.history.undo();
    expect(edge(s, id)).toMatchObject({ highway: 'steps', step_free: false });
    s.history.redo();
    expect(edge(s, id).highway).toBe('footway');
  });

  it('with a mix, only the edges that change are touched', () => {
    const s = fixtureSession();
    const before = s.history.current();
    runPlan(s.history, ok(planMenuEdit(before, [FLAT, STEPS], { stairs: 'steps' })));
    expect(s.history.current().edges[STEPS]).toEqual(before.edges[STEPS]); // already steps: same object, same rev
    expect(edge(s, FLAT).highway).toBe('steps');
  });

  it('errors for what the menu blocks (portal, indoor, bridge, elevator, escalator, mixed with points) and changes nothing', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(errorOf(planMenuEdit(st, [PORTAL], { stairs: 'steps' }))).toMatch(/portal/);
    for (const id of [INDOOR, INDOOR_STEPS, BRIDGE, ELEVATOR, ESCALATOR]) expect(isError(planMenuEdit(st, [id], { stairs: 'steps' })), id).toBe(true);
    expect(errorOf(planMenuEdit(st, [FLAT, 'n_out_0001'], { stairs: 'steps' }))).toMatch(/구간만/);
    expect(isError(planMenuEdit(st, ['n_out_0001'], { stairs: 'steps' }))).toBe(true);
    expect(s.history.current()).toEqual(st);
  });

  it('errors when nothing would change (already the target)', () => {
    const st = fixtureSession().history.current();
    expect(errorOf(planMenuEdit(st, [STEPS], { stairs: 'steps' }))).toMatch(/이미/);
    expect(errorOf(planMenuEdit(st, [FLAT], { stairs: 'footway' }))).toMatch(/이미/);
  });
});
