// 복원 (redo), the 30-minute pressure window, 화장실, and the sill set in the point's own sheet.
import { beforeAll, describe, expect, it } from 'vitest';
import { checkInvariants, createIdGen, setProps, type EditState, type LoadedCampus, type Position } from '@campo/core';
import { OUTDOOR, type Scope } from '../src/model/scope.ts';
import { planFloorChange, planLink, planRestroom, planStart, type Plan, type PlanOk } from '../src/survey/plans.ts';
import { MAX_PRESSURE_AGE_MS, relativeHeight, withinPressureWindow } from '../src/survey/readings.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, SOURCE, campusErrors, fixture } from './helpers.ts';

let start: EditState;
let loaded: LoadedCampus;
beforeAll(async () => {
  ({ state: start, loaded } = await fixture());
});

const later = (min: number): string => new Date(Date.parse(AT) + min * 60_000).toISOString().replace('Z', '+00:00');
const ok = (plan: Plan): PlanOk => {
  if ('error' in plan) throw new Error(plan.error);
  return plan;
};
const newSession = () => new SurveySession({ campus: CAMPUS, base: start, ids: createIdGen(7), startedAt: AT });
const at = (s: SurveySession, coord: Position, scope: Scope = s.scope) => ({ state: s.state, ctx: s.ctx, scope, coord, anchorId: s.anchorId, source: SOURCE });
const reading = (min: number, hpa: number | null) => ({ at: later(min), pressureHpa: hpa, headingDeg: null });

describe('복원', () => {
  it('brings back what 되돌리기 took, readings included, and a new change drops it', () => {
    const s = newSession();
    s.record(ok(planStart(at(s, [126.9998, 37.0008]))), reading(0, 1012.5));
    s.record(ok(planLink(at(s, [126.9997, 37.0009]))), reading(2, 1012.0));
    const done = { state: s.state, vertical: s.vertical, anchor: s.anchorId };
    expect(s.vertical).toHaveLength(1);
    expect(s.canRedo).toBe(false);
    s.undo();
    expect(s.vertical).toHaveLength(0);
    expect(s.canRedo).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.state).toStrictEqual(done.state);
    expect(s.vertical).toEqual(done.vertical);
    expect(s.anchorId).toBe(done.anchor);
    s.undo();
    s.moveTo(OUTDOOR);
    expect(s.canRedo).toBe(false);
    expect(s.redo()).toBe(false);
  });

  it('redoes a move by hand (no map change) without touching the map history', () => {
    const s = newSession();
    s.record(ok(planStart(at(s, [126.9998, 37.0008]))), reading(0, null));
    const state = s.state;
    s.moveTo({ kind: 'building', buildingId: 'bldg_A', level: 1 });
    s.undo();
    expect(s.scope).toEqual(OUTDOOR);
    s.redo();
    expect(s.scope).toEqual({ kind: 'building', buildingId: 'bldg_A', level: 1 });
    expect(s.state).toBe(state);
  });
});

describe('기압 30분 창', () => {
  it('compares two pressures only when read within half an hour, in order', () => {
    expect(MAX_PRESSURE_AGE_MS).toBe(30 * 60_000);
    expect(withinPressureWindow(AT, later(30))).toBe(true);
    expect(withinPressureWindow(AT, later(31))).toBe(false);
    expect(withinPressureWindow(later(5), AT)).toBe(false);
    expect(relativeHeight({ hpa: 1012, at: AT }, 1011.5, later(20))).toBeCloseTo(4.2, 0);
    expect(relativeHeight({ hpa: 1012, at: AT }, 1011.5, later(40))).toBeNull();
    expect(relativeHeight(null, 1011.5, later(1))).toBeNull();
  });

  it('a stretch walked within 30 minutes gets a height; a floor trip that took longer does not', () => {
    const s = newSession();
    s.record(ok(planStart(at(s, [126.9998, 37.0008]))), reading(0, 1012.5));
    s.record(ok(planLink(at(s, [126.9997, 37.0009]))), reading(25, 1012.0));
    expect(s.vertical).toHaveLength(1);

    const t = newSession();
    t.moveTo({ kind: 'building', buildingId: 'bldg_B', level: 1 });
    const stairs = () => ok(planFloorChange(at(t, [127.0013, 37.0004]), { kind: 'stairs', toLevel: 2 }));
    t.record(stairs(), { ...reading(45, 1011.9), trip: { startHpa: 1012.4, endHpa: 1011.9, startAt: later(0) } });
    expect(t.vertical).toEqual([]);
    t.undo();
    t.record(stairs(), { ...reading(20, 1011.9), trip: { startHpa: 1012.4, endHpa: 1011.9, startAt: later(0) } });
    expect(t.vertical).toHaveLength(1);
  });
});

describe('화장실', () => {
  it('records a restroom with who it is for and the wheelchair answer, joined to the nearest corridor', () => {
    const s = newSession();
    const A1: Scope = { kind: 'building', buildingId: 'bldg_A', level: 1 };
    s.moveTo(A1);
    const plan = ok(planRestroom(at(s, [127.00072, 37.00052], A1), { gender: 'female', wheelchair: 'unknown', changingTable: null }));
    s.run(plan);
    const node = s.state.nodes[plan.featureId]!;
    expect(node.props).toMatchObject({ node_type: 'restroom', restroom_gender: 'female', wheelchair: 'unknown', changing_table: null });
    expect(Object.values(s.state.edges).some((e) => e.props.from === node.id || e.props.to === node.id)).toBe(true);
    expect(checkInvariants(s.state)).toEqual([]);
    expect(campusErrors(loaded, s.state)).toEqual([]);
    expect('error' in planRestroom(at(s, [126.9998, 37.0008], OUTDOOR), { gender: 'male', wheelchair: 'no', changingTable: false })).toBe(true);
  });
});

describe('지점 속성의 턱', () => {
  it('the sill of the edges at a point is saved with the point information, one 되돌리기', () => {
    const s = newSession();
    const edge = 'e_A_1_main__A_1_hall';
    const done = s.annotate('n_A_1_main', { access: { hours: '07:00-22:00' }, extra: setProps([edge], { step_free: true }) }, AT);
    expect('error' in done).toBe(false);
    expect(s.state.edges[edge]!.props.step_free).toBe(true);
    expect(s.state.nodes['n_A_1_main']!.props.hours).toBe('07:00-22:00');
    s.undo();
    expect(s.state.edges[edge]!.props.step_free).toBe(start.edges[edge]!.props.step_free);
    expect(s.state.nodes['n_A_1_main']!.props.hours).toBe(start.nodes['n_A_1_main']!.props.hours);
  });
});
